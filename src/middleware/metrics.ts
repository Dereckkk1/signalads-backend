import { Request, Response, NextFunction } from 'express';
import SystemMetric from '../models/SystemMetric';

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────
interface RouteMetric {
    route: string;
    method: string;
    duration: number;
    statusCode: number;
    timestamp: Date;
    path: string;
    ip: string;
}

interface RouteSummary {
    route: string;
    count: number;
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    errorCount: number;
    errorRate: string;
}

// ─────────────────────────────────────────────────────────────
// Store circular em memória (máx 2000 registros)
// ─────────────────────────────────────────────────────────────
const MAX_STORE = 2000;
const metricsStore: RouteMetric[] = [];

let totalRequests = 0;
let totalErrors = 0;
const serverStartTime = Date.now();

// ─────────────────────────────────────────────────────────────
// Batch write assíncrono para MongoDB
// Acumula métricas e persiste a cada 50 registros ou 5 segundos
// ─────────────────────────────────────────────────────────────
const BATCH_SIZE = 50;
const BATCH_INTERVAL_MS = 5_000;

let metricsBatch: Array<{
    route: string;
    method: string;
    statusCode: number;
    duration: number;
    isError: boolean;
    isSlow: boolean;
    ip: string;
    timestamp: Date;
}> = [];

async function flushMetricsBatch(): Promise<void> {
    if (metricsBatch.length === 0) return;
    const toInsert = metricsBatch.splice(0);
    try {
        await SystemMetric.insertMany(toInsert, { ordered: false });
    } catch {
        // Falha silenciosa — monitoramento nunca deve quebrar a aplicação
    }
}

// Timer que garante flush mesmo com pouco tráfego
setInterval(() => {
    flushMetricsBatch();
}, BATCH_INTERVAL_MS);

// ─────────────────────────────────────────────────────────────
// Middleware principal
// ─────────────────────────────────────────────────────────────
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const routePath = (req.route?.path as string) || req.path;
        const routeKey = `${req.method} ${routePath}`;
        const isError = res.statusCode >= 500;
        const isSlow = duration > 2000;
        const ip = req.ip || req.socket.remoteAddress || '';

        const metric: RouteMetric = {
            route: routeKey,
            method: req.method,
            duration,
            statusCode: res.statusCode,
            timestamp: new Date(),
            path: req.path,
            ip,
        };

        // Circular buffer (mantido para /api/metrics em tempo real)
        if (metricsStore.length >= MAX_STORE) {
            metricsStore.shift();
        }
        metricsStore.push(metric);

        totalRequests++;
        if (isError) totalErrors++;

        // Batch write assíncrono para MongoDB
        metricsBatch.push({
            route: routeKey,
            method: req.method,
            statusCode: res.statusCode,
            duration,
            isError,
            isSlow,
            ip,
            timestamp: metric.timestamp,
        });
        if (metricsBatch.length >= BATCH_SIZE) {
            flushMetricsBatch();
        }

    });

    next();
};

// ─────────────────────────────────────────────────────────────
// Percentil helper
// ─────────────────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Sumarização por rota (última 1h)
// ─────────────────────────────────────────────────────────────
export const getMetricsSummary = (windowMs = 3_600_000): RouteSummary[] => {
    const since = Date.now() - windowMs;
    const recent = metricsStore.filter(m => m.timestamp.getTime() > since);

    const byRoute = new Map<string, { durations: number[]; errors: number }>();

    for (const m of recent) {
        if (!byRoute.has(m.route)) byRoute.set(m.route, { durations: [], errors: 0 });
        const entry = byRoute.get(m.route)!;
        entry.durations.push(m.duration);
        if (m.statusCode >= 500) entry.errors++;
    }

    return Array.from(byRoute.entries())
        .map(([route, { durations, errors }]) => {
            const sorted = [...durations].sort((a, b) => a - b);
            const count = sorted.length;
            const avg = count > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / count) : 0;

            return {
                route,
                count,
                p50: percentile(sorted, 50),
                p95: percentile(sorted, 95),
                p99: percentile(sorted, 99),
                avg,
                errorCount: errors,
                errorRate: count > 0 ? `${((errors / count) * 100).toFixed(2)}%` : '0%',
            };
        })
        .sort((a, b) => b.p95 - a.p95); // Ordena pelos mais lentos no p95
};

// ─────────────────────────────────────────────────────────────
// Estatísticas globais do servidor
// ─────────────────────────────────────────────────────────────
export const getGlobalStats = () => {
    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

    return {
        uptime: {
            seconds: uptimeSeconds,
            human: formatUptime(uptimeSeconds),
        },
        requests: {
            total: totalRequests,
            errors: totalErrors,
            errorRate: totalRequests > 0
                ? `${((totalErrors / totalRequests) * 100).toFixed(2)}%`
                : '0%',
        },
        memory: {
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
            rssMB: Math.round(mem.rss / 1024 / 1024),
            externalMB: Math.round(mem.external / 1024 / 1024),
        },
        node: process.version,
        pid: process.pid,
    };
};

// ─────────────────────────────────────────────────────────────
// Helper de uptime legível
// ─────────────────────────────────────────────────────────────
function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

// Exporta store para testes
export { metricsStore };
