import { Request, Response } from 'express';
import SystemMetric from '../models/SystemMetric';
import WebVital from '../models/WebVital';
import { getGlobalStats } from '../middleware/metrics';

// ─────────────────────────────────────────────────────────────
// Helper: converte range string em ms
// ─────────────────────────────────────────────────────────────
function parseRange(range?: string): number {
    switch (range) {
        case '1h': return 3_600_000;
        case '24h': return 86_400_000;
        case '7d': return 604_800_000;
        case '30d': return 2_592_000_000;
        default: return 86_400_000; // 24h padrão
    }
}

function sinceDate(range?: string): Date {
    return new Date(Date.now() - parseRange(range));
}

const LOCALHOST_IPS = ['::1', '127.0.0.1', '::ffff:127.0.0.1'];

function localhostFilter(hideLocalhost: boolean) {
    if (!hideLocalhost) return {};
    return { ip: { $nin: LOCALHOST_IPS } };
}

// ─────────────────────────────────────────────────────────────
// GET /api/admin/monitoring/overview
// Resumo geral: uptime, memória, total requests, taxa de erro
// ─────────────────────────────────────────────────────────────
export const getOverview = async (req: Request, res: Response) => {
    try {
        const since = sinceDate(req.query.range as string);
        const hideLocalhost = req.query.hideLocalhost === 'true';
        const global = getGlobalStats();
        const ipFilter = localhostFilter(hideLocalhost);

        const [totalRequests, totalErrors, totalSlow, avgDuration] = await Promise.all([
            SystemMetric.countDocuments({ timestamp: { $gte: since }, ...ipFilter }),
            SystemMetric.countDocuments({ timestamp: { $gte: since }, isError: true, ...ipFilter }),
            SystemMetric.countDocuments({ timestamp: { $gte: since }, isSlow: true, ...ipFilter }),
            SystemMetric.aggregate([
                { $match: { timestamp: { $gte: since }, ...ipFilter } },
                { $group: { _id: null, avg: { $avg: '$duration' } } },
            ]),
        ]);

        const errorRate = totalRequests > 0
            ? ((totalErrors / totalRequests) * 100).toFixed(2)
            : '0.00';

        res.json({
            server: global,
            period: {
                range: req.query.range || '24h',
                since: since.toISOString(),
                totalRequests,
                totalErrors,
                totalSlow,
                errorRate: `${errorRate}%`,
                avgDuration: Math.round(avgDuration[0]?.avg ?? 0),
            },
        });
    } catch (err) {
        console.error('❌ [MONITORING] overview error:', err);
        res.status(500).json({ error: 'Erro ao buscar overview de monitoramento' });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/monitoring/routes
// Latência por rota com p50, p95, p99
// ─────────────────────────────────────────────────────────────
export const getRouteMetrics = async (req: Request, res: Response) => {
    try {
        const since = sinceDate(req.query.range as string);
        const hideLocalhost = req.query.hideLocalhost === 'true';
        const ipFilter = localhostFilter(hideLocalhost);

        const routes = await SystemMetric.aggregate([
            { $match: { timestamp: { $gte: since }, ...ipFilter } },
            {
                $group: {
                    _id: '$route',
                    count: { $sum: 1 },
                    durations: { $push: '$duration' },
                    avgDuration: { $avg: '$duration' },
                    maxDuration: { $max: '$duration' },
                    errorCount: {
                        $sum: { $cond: ['$isError', 1, 0] },
                    },
                    slowCount: {
                        $sum: { $cond: ['$isSlow', 1, 0] },
                    },
                },
            },
            { $sort: { count: -1 } },
        ]);

        const result = routes.map((r) => {
            const sorted = r.durations.sort((a: number, b: number) => a - b);
            const count = sorted.length;
            const p50 = sorted[Math.floor(count * 0.5)] ?? 0;
            const p95 = sorted[Math.floor(count * 0.95)] ?? 0;
            const p99 = sorted[Math.floor(count * 0.99)] ?? 0;
            const errorRate = count > 0 ? ((r.errorCount / count) * 100) : 0;

            let health = 'good';
            if (p95 >= 2000 || errorRate >= 5) health = 'critical';
            else if (p95 >= 500 || errorRate >= 1) health = 'warning';

            return {
                route: r._id,
                count,
                p50: Math.round(p50),
                p95: Math.round(p95),
                p99: Math.round(p99),
                avg: Math.round(r.avgDuration),
                max: Math.round(r.maxDuration),
                errorCount: r.errorCount,
                slowCount: r.slowCount,
                errorRate: `${errorRate.toFixed(2)}%`,
                health,
            };
        });

        res.json({
            range: req.query.range || '24h',
            totalRoutes: result.length,
            routes: result,
        });
    } catch (err) {
        console.error('❌ [MONITORING] routes error:', err);
        res.status(500).json({ error: 'Erro ao buscar métricas de rotas' });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/monitoring/errors
// Rotas com mais erros 5xx
// ─────────────────────────────────────────────────────────────
export const getErrors = async (req: Request, res: Response) => {
    try {
        const since = sinceDate(req.query.range as string);
        const hideLocalhost = req.query.hideLocalhost === 'true';
        const ipFilter = localhostFilter(hideLocalhost);

        const errors = await SystemMetric.aggregate([
            { $match: { timestamp: { $gte: since }, isError: true, ...ipFilter } },
            {
                $group: {
                    _id: { route: '$route', statusCode: '$statusCode' },
                    count: { $sum: 1 },
                    lastOccurrence: { $max: '$timestamp' },
                    avgDuration: { $avg: '$duration' },
                },
            },
            { $sort: { count: -1 } },
            { $limit: 50 },
        ]);

        const result = errors.map((e) => ({
            route: e._id.route,
            statusCode: e._id.statusCode,
            count: e.count,
            lastOccurrence: e.lastOccurrence,
            avgDuration: Math.round(e.avgDuration),
        }));

        res.json({
            range: req.query.range || '24h',
            totalErrors: result.reduce((sum, e) => sum + e.count, 0),
            errors: result,
        });
    } catch (err) {
        console.error('❌ [MONITORING] errors error:', err);
        res.status(500).json({ error: 'Erro ao buscar erros' });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/monitoring/vitals
// Web Vitals agregados por nome e página
// ─────────────────────────────────────────────────────────────
export const getVitals = async (req: Request, res: Response) => {
    try {
        const since = sinceDate(req.query.range as string);
        const hideLocalhost = req.query.hideLocalhost === 'true';
        const vitalsMatch: Record<string, unknown> = { timestamp: { $gte: since } };
        if (hideLocalhost) vitalsMatch.page = { $not: /localhost/ };

        const vitals = await WebVital.aggregate([
            { $match: vitalsMatch },
            {
                $group: {
                    _id: { name: '$name', page: '$page' },
                    count: { $sum: 1 },
                    avg: { $avg: '$value' },
                    p75: { $push: '$value' },
                    poorCount: {
                        $sum: { $cond: [{ $eq: ['$rating', 'poor'] }, 1, 0] },
                    },
                    goodCount: {
                        $sum: { $cond: [{ $eq: ['$rating', 'good'] }, 1, 0] },
                    },
                    needsImprovementCount: {
                        $sum: { $cond: [{ $eq: ['$rating', 'needs-improvement'] }, 1, 0] },
                    },
                },
            },
            { $sort: { '_id.name': 1, count: -1 } },
        ]);

        const result = vitals.map((v) => {
            const sorted = v.p75.sort((a: number, b: number) => a - b);
            const count = sorted.length;
            const p75 = sorted[Math.floor(count * 0.75)] ?? 0;
            const total = v.poorCount + v.goodCount + v.needsImprovementCount;

            return {
                name: v._id.name,
                page: v._id.page,
                count,
                avg: Math.round(v.avg),
                p75: Math.round(p75),
                goodPercent: total > 0 ? `${((v.goodCount / total) * 100).toFixed(1)}%` : '0%',
                poorPercent: total > 0 ? `${((v.poorCount / total) * 100).toFixed(1)}%` : '0%',
                goodCount: v.goodCount,
                needsImprovementCount: v.needsImprovementCount,
                poorCount: v.poorCount,
            };
        });

        res.json({
            range: req.query.range || '24h',
            vitals: result,
        });
    } catch (err) {
        console.error('❌ [MONITORING] vitals error:', err);
        res.status(500).json({ error: 'Erro ao buscar Web Vitals' });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/monitoring/slow
// Requests lentos (> 2s)
// ─────────────────────────────────────────────────────────────
export const getSlowRequests = async (req: Request, res: Response) => {
    try {
        const since = sinceDate(req.query.range as string);
        const hideLocalhost = req.query.hideLocalhost === 'true';
        const ipFilter = localhostFilter(hideLocalhost);

        const slow = await SystemMetric.find({
            timestamp: { $gte: since },
            isSlow: true,
            ...ipFilter,
        })
            .sort({ duration: -1 })
            .limit(100)
            .select('route method statusCode duration timestamp')
            .lean();

        res.json({
            range: req.query.range || '24h',
            totalSlow: slow.length,
            requests: slow,
        });
    } catch (err) {
        console.error('❌ [MONITORING] slow error:', err);
        res.status(500).json({ error: 'Erro ao buscar requests lentos' });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/monitoring/timeline
// Volume de requests agrupado por hora
// ─────────────────────────────────────────────────────────────
export const getTimeline = async (req: Request, res: Response) => {
    try {
        const range = req.query.range as string;
        const since = sinceDate(range);
        const hideLocalhost = req.query.hideLocalhost === 'true';
        const ipFilter = localhostFilter(hideLocalhost);

        // Agrupa por hora para ranges curtos, por dia para ranges longos
        const groupByDay = range === '30d' || range === '7d';

        const dateFormat = groupByDay
            ? { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
            : { $dateToString: { format: '%Y-%m-%dT%H:00', date: '$timestamp' } };

        const timeline = await SystemMetric.aggregate([
            { $match: { timestamp: { $gte: since }, ...ipFilter } },
            {
                $group: {
                    _id: dateFormat,
                    totalRequests: { $sum: 1 },
                    totalErrors: { $sum: { $cond: ['$isError', 1, 0] } },
                    totalSlow: { $sum: { $cond: ['$isSlow', 1, 0] } },
                    avgDuration: { $avg: '$duration' },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const result = timeline.map((t) => ({
            period: t._id,
            totalRequests: t.totalRequests,
            totalErrors: t.totalErrors,
            totalSlow: t.totalSlow,
            avgDuration: Math.round(t.avgDuration),
        }));

        res.json({
            range: range || '24h',
            groupedBy: groupByDay ? 'day' : 'hour',
            timeline: result,
        });
    } catch (err) {
        console.error('❌ [MONITORING] timeline error:', err);
        res.status(500).json({ error: 'Erro ao buscar timeline' });
    }
};
