import './setup'; // Configura MongoDB em memória (necessário pelo app importado indiretamente)
import { metricsMiddleware, getMetricsSummary, getGlobalStats, metricsStore } from '../middleware/metrics';
import { Request, Response } from 'express';

// ─────────────────────────────────────────────────────────────
// Mocks de req e res para testar o middleware sem servidor
// ─────────────────────────────────────────────────────────────
const createMockReq = (overrides = {}): Partial<Request> => ({
    method: 'GET',
    path: '/api/test',
    route: { path: '/test' } as any,
    ...overrides,
});

const createMockRes = (statusCode = 200): Partial<Response> & { _listeners: Record<string, Function[]> } => {
    const listeners: Record<string, Function[]> = {};
    return {
        statusCode,
        _listeners: listeners,
        on(event: string, cb: Function) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
            return this as any;
        },
    } as any;
};

const triggerFinish = (mockRes: ReturnType<typeof createMockRes>) => {
    const cbs = mockRes._listeners['finish'] || [];
    cbs.forEach(cb => cb());
};

// ─────────────────────────────────────────────────────────────
// Testes do middleware
// ─────────────────────────────────────────────────────────────
describe('metricsMiddleware', () => {
    beforeEach(() => {
        metricsStore.length = 0; // Limpa store antes de cada teste
    });

    it('deve registrar uma métrica após a resposta', () => {
        const req = createMockReq();
        const res = createMockRes(200);
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next);
        expect(next).toHaveBeenCalled();

        triggerFinish(res);
        expect(metricsStore.length).toBe(1);
        expect(metricsStore[0].statusCode).toBe(200);
        expect(metricsStore[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('deve registrar método e rota corretamente', () => {
        const req = createMockReq({ method: 'POST', path: '/api/auth/login' });
        const res = createMockRes(200);
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next);
        triggerFinish(res);

        expect(metricsStore[0].method).toBe('POST');
    });

    it('deve manter circular buffer — não ultrapassar MAX_STORE', () => {
        for (let i = 0; i < 2010; i++) {
            const req = createMockReq();
            const res = createMockRes(200);
            const next = jest.fn();
            metricsMiddleware(req as Request, res as Response, next);
            triggerFinish(res);
        }
        expect(metricsStore.length).toBeLessThanOrEqual(2000);
    });
});

// ─────────────────────────────────────────────────────────────
// Testes de getMetricsSummary
// ─────────────────────────────────────────────────────────────
describe('getMetricsSummary', () => {
    beforeEach(() => {
        metricsStore.length = 0;
    });

    it('deve retornar array vazio sem métricas', () => {
        const summary = getMetricsSummary();
        expect(summary).toEqual([]);
    });

    it('deve calcular corretamente p50, p95, p99', () => {
        // Adicionar 10 requests com durações conhecidas
        const durations = [100, 120, 130, 150, 200, 250, 300, 400, 800, 1200];
        for (const d of durations) {
            metricsStore.push({
                route: 'GET /api/test',
                method: 'GET',
                duration: d,
                statusCode: 200,
                timestamp: new Date(),
                path: '/api/test',
            });
        }

        const summary = getMetricsSummary(3_600_000);
        expect(summary.length).toBe(1);

        const route = summary[0];
        expect(route.count).toBe(10);
        expect(route.p50).toBeGreaterThan(0);
        expect(route.p95).toBeGreaterThanOrEqual(route.p50);
        expect(route.p99).toBeGreaterThanOrEqual(route.p95);
        expect(route.errorCount).toBe(0);
        expect(route.errorRate).toBe('0.00%');
    });

    it('deve calcular taxa de erro corretamente', () => {
        // 9 requests ok + 1 erro 500
        for (let i = 0; i < 9; i++) {
            metricsStore.push({
                route: 'POST /api/auth/login',
                method: 'POST',
                duration: 200,
                statusCode: 200,
                timestamp: new Date(),
                path: '/api/auth/login',
            });
        }
        metricsStore.push({
            route: 'POST /api/auth/login',
            method: 'POST',
            duration: 500,
            statusCode: 500,
            timestamp: new Date(),
            path: '/api/auth/login',
        });

        const summary = getMetricsSummary(3_600_000);
        const route = summary[0];
        expect(route.errorCount).toBe(1);
        expect(route.errorRate).toBe('10.00%');
    });

    it('deve ignorar métricas fora da janela de tempo', () => {
        // Adicionar métrica de 2 horas atrás
        metricsStore.push({
            route: 'GET /api/old',
            method: 'GET',
            duration: 100,
            statusCode: 200,
            timestamp: new Date(Date.now() - 7_200_000), // 2h atrás
            path: '/api/old',
        });

        // Janela de 1 hora — não deve aparecer
        const summary = getMetricsSummary(3_600_000);
        expect(summary.length).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────
// Testes de getGlobalStats
// ─────────────────────────────────────────────────────────────
describe('getGlobalStats', () => {
    it('deve retornar estrutura correta de stats', () => {
        const stats = getGlobalStats();

        expect(stats).toHaveProperty('uptime');
        expect(stats).toHaveProperty('requests');
        expect(stats).toHaveProperty('memory');
        expect(stats).toHaveProperty('node');
        expect(stats).toHaveProperty('pid');
        expect(stats.memory).toHaveProperty('heapUsedMB');
        expect(stats.memory).toHaveProperty('heapTotalMB');
        expect(stats.memory.heapUsedMB).toBeGreaterThan(0);
    });

    it('uptime deve ser positivo', () => {
        const stats = getGlobalStats();
        expect(stats.uptime.seconds).toBeGreaterThanOrEqual(0);
    });
});
