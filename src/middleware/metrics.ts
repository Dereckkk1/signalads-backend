import { Request, Response, NextFunction } from 'express';
import SystemMetric from '../models/SystemMetric';
import BlockedIP from '../models/BlockedIP';
import { blockedIPsSet } from '../utils/ipBlockList';

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
const MAX_BATCH_BUFFER = 10_000;

let metricsBatch: Array<{
    route: string;
    method: string;
    statusCode: number;
    duration: number;
    isError: boolean;
    isSlow: boolean;
    ip: string;
    userId?: string;
    userEmail?: string;
    timestamp: Date;
}> = [];

// ─────────────────────────────────────────────────────────────
// Auto-block: tracker em memória por IP (janela deslizante de 1h)
// Detecta bots varrendo rotas inexistentes sem precisar de DB
// ─────────────────────────────────────────────────────────────
const LOCALHOST_IPS_AUTO = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);
const AUTO_BLOCK_WINDOW_MS = 60 * 60 * 1000;       // janela: 1h
const AUTO_BLOCK_MIN_REQUESTS = 10;                  // mínimo para avaliar
const AUTO_BLOCK_NOT_FOUND_THRESHOLD = 0.7;          // 70% de 404s → bloqueia
const AUTO_BLOCK_ROUTE_RATIO_THRESHOLD = 0.85;       // 85% rotas únicas (anônimo)
const AUTO_BLOCK_ROUTE_MIN_REQUESTS = 15;            // mínimo para checar ratio

interface IpTracker {
    requestCount: number;
    notFoundCount: number;
    uniqueRoutes: Set<string>;
    windowStart: number;
    hasAuth: boolean;
}

const ipTrackers = new Map<string, IpTracker>();

function getOrResetTracker(ip: string, now: number): IpTracker {
    let tracker = ipTrackers.get(ip);
    if (!tracker || now - tracker.windowStart > AUTO_BLOCK_WINDOW_MS) {
        tracker = { requestCount: 0, notFoundCount: 0, uniqueRoutes: new Set(), windowStart: now, hasAuth: false };
        ipTrackers.set(ip, tracker);
    }
    return tracker;
}

async function runAutoBlock(batch: typeof metricsBatch): Promise<void> {
    const ipsToCheck = new Set<string>();

    for (const metric of batch) {
        const { ip } = metric;
        if (!ip || LOCALHOST_IPS_AUTO.has(ip) || blockedIPsSet.has(ip)) continue;

        const tracker = getOrResetTracker(ip, metric.timestamp.getTime());
        tracker.requestCount++;
        tracker.uniqueRoutes.add(metric.route);
        if (metric.statusCode === 404) tracker.notFoundCount++;
        if (metric.userId) tracker.hasAuth = true;
        ipsToCheck.add(ip);
    }

    for (const ip of ipsToCheck) {
        if (blockedIPsSet.has(ip)) continue;
        const tracker = ipTrackers.get(ip);
        if (!tracker || tracker.requestCount < AUTO_BLOCK_MIN_REQUESTS) continue;

        const notFoundRate = tracker.notFoundCount / tracker.requestCount;
        const routeRatio = tracker.uniqueRoutes.size / tracker.requestCount;

        const isBot =
            notFoundRate >= AUTO_BLOCK_NOT_FOUND_THRESHOLD ||
            (!tracker.hasAuth &&
                routeRatio >= AUTO_BLOCK_ROUTE_RATIO_THRESHOLD &&
                tracker.requestCount >= AUTO_BLOCK_ROUTE_MIN_REQUESTS);

        if (!isBot) continue;

        const notFoundPct = Math.round(notFoundRate * 100);
        const routePct = Math.round(routeRatio * 100);
        const reason = `Auto-bloqueado: ${notFoundPct}% 404s, ${routePct}% diversidade de rotas em ${tracker.requestCount} requests`;

        try {
            await BlockedIP.findOneAndUpdate(
                { ip },
                { ip, reason, blockedAt: new Date(), blockedById: 'system', blockedByEmail: 'auto-block@sistema' },
                { upsert: true }
            );
            blockedIPsSet.add(ip);
            ipTrackers.delete(ip);
            console.log(`[auto-block] ${ip} bloqueado — ${reason}`);
        } catch {
            // Silencioso — monitoramento nunca quebra a aplicação
        }
    }
}

async function flushMetricsBatch(): Promise<void> {
    if (metricsBatch.length === 0) return;
    const toInsert = metricsBatch.splice(0);
    try {
        await SystemMetric.insertMany(toInsert, { ordered: false });
    } catch {
        // Falha silenciosa — monitoramento nunca deve quebrar a aplicação
    }
    // Roda auto-block sem bloquear o flush (falha silenciosa)
    runAutoBlock(toInsert).catch(() => {});
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
        const userId = (req as any).userId?.toString() || undefined;
        const userEmail = (req as any).user?.email || undefined;

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

        // Protecao contra buffer overflow (se MongoDB estiver lento/fora)
        if (metricsBatch.length >= MAX_BATCH_BUFFER) {
            metricsBatch.splice(0, metricsBatch.length - MAX_BATCH_BUFFER / 2);
            console.warn('[metrics] Buffer overflow — dropped oldest metrics');
        }

        // Batch write assíncrono para MongoDB
        metricsBatch.push({
            route: routeKey,
            method: req.method,
            statusCode: res.statusCode,
            duration,
            isError,
            isSlow,
            ip,
            userId,
            userEmail,
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

// ─────────────────────────────────────────────────────────────
// Middleware de bloqueio de IP
// Rejeita IPs na lista de bloqueio antes de qualquer processamento.
// Admin routes ficam isentas para o admin não se auto-trancar.
// ─────────────────────────────────────────────────────────────
export const checkBlockedIP = (req: Request, res: Response, next: NextFunction): void => {
    if (req.path.startsWith('/api/admin/')) {
        next();
        return;
    }
    const ip = req.ip || req.socket.remoteAddress || '';
    if (blockedIPsSet.has(ip)) {
        res.status(403).json({ error: 'Acesso bloqueado' });
        return;
    }
    next();
};

// Exporta store para testes
export { metricsStore };
