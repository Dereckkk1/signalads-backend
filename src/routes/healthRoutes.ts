import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { getMetricsSummary, getGlobalStats } from '../middleware/metrics';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import WebVital from '../models/WebVital';

// Rate limit especifico para vitals — 60 req/min por IP (sendBeacon fire-and-forget)
const vitalsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: '',
    standardHeaders: true,
    legacyHeaders: false,
});

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

    // Endpoint publico: apenas status minimo. Detalhes ficam em /api/metrics (admin)
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
    });
});

// ─────────────────────────────────────────────────────────────
// GET /api/metrics — Métricas por rota (últimas 1h)
// Protegido com autenticação de admin
// ─────────────────────────────────────────────────────────────
router.get('/metrics', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
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
// Sempre responde 204 — nunca deve retornar 500 ao cliente.
// Erros são logados internamente sem quebrar o ciclo de resposta.
// ─────────────────────────────────────────────────────────────
router.post('/vitals', vitalsLimiter, (req: Request, res: Response) => {
    // Responde IMEDIATAMENTE com 204 para não bloquear o sendBeacon
    res.status(204).send();

    // Processa o log de forma assíncrona após responder
    try {
        // Aceita body undefined, null, ou qualquer formato
        const body = req.body ?? {};
        const name = body.name as string | undefined;
        const value = body.value as number | undefined;
        const rating = (body.rating as string) || 'unknown';
        const page = (body.page as string) || 'unknown';

        // Sem name/value válidos → ignora silenciosamente
        if (!name || value === undefined || typeof value !== 'number') return;

        const rounded = Math.round(value);

        // Persiste no MongoDB (assíncrono, fire-and-forget)
        WebVital.create({
            name,
            value: rounded,
            rating,
            page,
            timestamp: new Date(),
        }).catch(() => {});

    } catch {
        // Falha silenciosa — log de vitals nunca deve afetar a aplicação
    }
});

export default router;
