import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { getMetricsSummary, getGlobalStats } from '../middleware/metrics';

const router = Router();

// ─────────────────────────────────────────────────────────────
// GET /api/health — Health check público
// ─────────────────────────────────────────────────────────────
router.get('/health', async (_req: Request, res: Response) => {
    const dbState = mongoose.connection.readyState;
    const dbStatusMap: Record<number, string> = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting',
    };
    const dbStatus = dbStatusMap[dbState] ?? 'unknown';

    const isHealthy = dbState === 1;
    const stats = getGlobalStats();

    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        database: {
            status: dbStatus,
            host: mongoose.connection.host || 'N/A',
        },
        ...stats,
    });
});

// ─────────────────────────────────────────────────────────────
// GET /api/metrics — Métricas por rota (últimas 1h)
// Proteger com auth de admin em produção — por ora interno
// ─────────────────────────────────────────────────────────────
router.get('/metrics', (_req: Request, res: Response) => {
    const windowMs = 3_600_000; // 1 hora
    const routes = getMetricsSummary(windowMs);
    const global = getGlobalStats();

    // Classificação de saúde por rota
    const classified = routes.map(r => ({
        ...r,
        health:
            r.p95 < 500 && parseFloat(r.errorRate) < 1
                ? 'good'
                : r.p95 < 2000 && parseFloat(r.errorRate) < 5
                    ? 'warning'
                    : 'critical',
    }));

    res.json({
        timestamp: new Date().toISOString(),
        windowHours: 1,
        global,
        routes: classified,
        summary: {
            totalRoutes: routes.length,
            criticalRoutes: classified.filter(r => r.health === 'critical').length,
            warningRoutes: classified.filter(r => r.health === 'warning').length,
            goodRoutes: classified.filter(r => r.health === 'good').length,
        },
    });
});

// ─────────────────────────────────────────────────────────────
// POST /api/vitals — Recebe Web Vitals do frontend
// ─────────────────────────────────────────────────────────────
router.post('/vitals', (req: Request, res: Response) => {
    try {
        const { name, value, rating, id, page, navigationType } = req.body;

        if (!name || value === undefined) {
            res.status(400).json({ error: 'Campos obrigatórios: name, value' });
            return;
        }

        const vital = {
            name,
            value: Math.round(value),
            rating: rating || 'unknown',
            id: id || 'N/A',
            page: page || 'unknown',
            navigationType: navigationType || 'navigate',
            receivedAt: new Date().toISOString(),
        };

        // Log estruturado — base para evolução futura (MongoDB/Datadog)
        if (rating === 'poor') {
            console.warn(`⚠️  [VITAL_POOR]  ${name}=${vital.value}ms | página: ${page}`);
        } else if (rating === 'needs-improvement') {
            console.log(`🟡 [VITAL_WARN]  ${name}=${vital.value}ms | página: ${page}`);
        } else {
            console.log(`✅ [VITAL_GOOD]  ${name}=${vital.value}ms | página: ${page}`);
        }

        res.status(204).send();
    } catch (err) {
        console.error('Erro ao registrar vital:', err);
        res.status(500).json({ error: 'Erro ao registrar vital' });
    }
});

export default router;
