/**
 * Unit tests para metrics middleware.
 * Testa metricsMiddleware, getMetricsSummary e getGlobalStats.
 *
 * Nota: O modulo metrics.ts usa setInterval e stores em memoria.
 * Mockamos SystemMetric.insertMany para evitar escrita em banco.
 */

import { Request, Response, NextFunction } from 'express';

// ── Mock SystemMetric model BEFORE importing metrics ──
jest.mock('../../../models/SystemMetric', () => ({
    __esModule: true,
    default: {
        insertMany: jest.fn().mockResolvedValue([]),
    },
}));

// ── Mock setInterval to prevent real timers ──
jest.useFakeTimers();

import { metricsMiddleware, getMetricsSummary, getGlobalStats, metricsStore } from '../../../middleware/metrics';

// ── Helper: create a minimal mock request ──
function createMetricsRequest(overrides: Partial<Request> = {}): Partial<Request> {
    return {
        method: 'GET',
        path: '/api/test',
        route: { path: '/test' },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' } as any,
        ...overrides,
    };
}

// ── Helper: create a mock response with EventEmitter-like 'on' for 'finish' ──
function createMetricsResponse(statusCode: number = 200): any {
    const listeners: Record<string, Function[]> = {};
    return {
        statusCode,
        on(event: string, cb: Function) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
        },
        emit(event: string) {
            (listeners[event] || []).forEach(cb => cb());
        },
    };
}

// ─── Setup ─────────────────────────────────────────────────────
beforeEach(() => {
    // Clear the metrics store between tests
    metricsStore.length = 0;
});

// ═══════════════════════════════════════════════════════════════
// metricsMiddleware — basico
// ═══════════════════════════════════════════════════════════════
describe('metricsMiddleware — basico', () => {
    it('deve chamar next() imediatamente', () => {
        const req = createMetricsRequest();
        const res = createMetricsResponse();
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve registrar listener para evento finish na response', () => {
        const req = createMetricsRequest();
        const res = createMetricsResponse();
        const onSpy = jest.spyOn(res, 'on');
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next as NextFunction);

        expect(onSpy).toHaveBeenCalledWith('finish', expect.any(Function));
    });
});

// ═══════════════════════════════════════════════════════════════
// metricsMiddleware — captura metricas ao finish
// ═══════════════════════════════════════════════════════════════
describe('metricsMiddleware — captura metricas', () => {
    it('deve adicionar metrica ao store quando response termina', () => {
        const req = createMetricsRequest({ method: 'POST', path: '/api/orders' });
        const res = createMetricsResponse(201);
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next as NextFunction);
        res.emit('finish');

        expect(metricsStore.length).toBe(1);
        expect(metricsStore[0]!.method).toBe('POST');
        expect(metricsStore[0]!.statusCode).toBe(201);
        expect(metricsStore[0]!.path).toBe('/api/orders');
    });

    it('deve registrar route como "METHOD path"', () => {
        const req = createMetricsRequest({
            method: 'GET',
            path: '/api/products',
            route: { path: '/products' },
        });
        const res = createMetricsResponse(200);
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next as NextFunction);
        res.emit('finish');

        expect(metricsStore[0]!.route).toBe('GET /products');
    });

    it('deve usar req.path como fallback quando route nao existe', () => {
        const req = createMetricsRequest({
            method: 'GET',
            path: '/api/fallback',
            route: undefined,
        });
        const res = createMetricsResponse(200);
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next as NextFunction);
        res.emit('finish');

        expect(metricsStore[0]!.route).toBe('GET /api/fallback');
    });

    it('deve registrar IP do request', () => {
        const req = createMetricsRequest({ ip: '10.0.0.1' });
        const res = createMetricsResponse();
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next as NextFunction);
        res.emit('finish');

        expect(metricsStore[0]!.ip).toBe('10.0.0.1');
    });

    it('deve registrar timestamp como Date', () => {
        const req = createMetricsRequest();
        const res = createMetricsResponse();
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next as NextFunction);
        res.emit('finish');

        expect(metricsStore[0]!.timestamp).toBeInstanceOf(Date);
    });

    it('deve registrar duration >= 0', () => {
        const req = createMetricsRequest();
        const res = createMetricsResponse();
        const next = jest.fn();

        metricsMiddleware(req as Request, res as Response, next as NextFunction);
        res.emit('finish');

        expect(metricsStore[0]!.duration).toBeGreaterThanOrEqual(0);
    });
});

// ═══════════════════════════════════════════════════════════════
// getMetricsSummary
// ═══════════════════════════════════════════════════════════════
describe('getMetricsSummary', () => {
    it('deve retornar array vazio quando nao ha metricas', () => {
        const summary = getMetricsSummary();
        expect(summary).toEqual([]);
    });

    it('deve agrupar metricas por rota', () => {
        // Add metrics manually
        metricsStore.push(
            { route: 'GET /api/a', method: 'GET', duration: 100, statusCode: 200, timestamp: new Date(), path: '/api/a', ip: '1.1.1.1' },
            { route: 'GET /api/a', method: 'GET', duration: 200, statusCode: 200, timestamp: new Date(), path: '/api/a', ip: '1.1.1.1' },
            { route: 'POST /api/b', method: 'POST', duration: 50, statusCode: 201, timestamp: new Date(), path: '/api/b', ip: '1.1.1.1' },
        );

        const summary = getMetricsSummary();
        expect(summary).toHaveLength(2);

        const routeA = summary.find(s => s.route === 'GET /api/a');
        expect(routeA).toBeDefined();
        expect(routeA!.count).toBe(2);
        expect(routeA!.avg).toBe(150); // (100+200)/2

        const routeB = summary.find(s => s.route === 'POST /api/b');
        expect(routeB).toBeDefined();
        expect(routeB!.count).toBe(1);
    });

    it('deve calcular percentis corretamente', () => {
        // Add 10 metrics with known durations
        for (let i = 1; i <= 10; i++) {
            metricsStore.push({
                route: 'GET /api/perc',
                method: 'GET',
                duration: i * 10, // 10, 20, 30, ..., 100
                statusCode: 200,
                timestamp: new Date(),
                path: '/api/perc',
                ip: '1.1.1.1',
            });
        }

        const summary = getMetricsSummary();
        const route = summary.find(s => s.route === 'GET /api/perc');
        expect(route).toBeDefined();
        expect(route!.p50).toBe(50); // 5th element
        expect(route!.p95).toBe(100); // 10th element
        expect(route!.p99).toBe(100); // 10th element
    });

    it('deve contar erros 5xx corretamente', () => {
        metricsStore.push(
            { route: 'GET /api/errors', method: 'GET', duration: 50, statusCode: 200, timestamp: new Date(), path: '/api/errors', ip: '1.1.1.1' },
            { route: 'GET /api/errors', method: 'GET', duration: 50, statusCode: 500, timestamp: new Date(), path: '/api/errors', ip: '1.1.1.1' },
            { route: 'GET /api/errors', method: 'GET', duration: 50, statusCode: 503, timestamp: new Date(), path: '/api/errors', ip: '1.1.1.1' },
        );

        const summary = getMetricsSummary();
        const route = summary.find(s => s.route === 'GET /api/errors');
        expect(route!.errorCount).toBe(2);
        expect(route!.errorRate).toBe('66.67%');
    });

    it('deve respeitar window de tempo', () => {
        // Old metric (2 hours ago)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        metricsStore.push({
            route: 'GET /api/old',
            method: 'GET',
            duration: 50,
            statusCode: 200,
            timestamp: twoHoursAgo,
            path: '/api/old',
            ip: '1.1.1.1',
        });

        // Recent metric
        metricsStore.push({
            route: 'GET /api/recent',
            method: 'GET',
            duration: 30,
            statusCode: 200,
            timestamp: new Date(),
            path: '/api/recent',
            ip: '1.1.1.1',
        });

        // Default window is 1h — old metric should be excluded
        const summary = getMetricsSummary();
        expect(summary).toHaveLength(1);
        expect(summary[0]!.route).toBe('GET /api/recent');
    });

    it('deve ordenar por p95 descendente', () => {
        metricsStore.push(
            { route: 'GET /slow', method: 'GET', duration: 500, statusCode: 200, timestamp: new Date(), path: '/slow', ip: '1.1.1.1' },
            { route: 'GET /fast', method: 'GET', duration: 10, statusCode: 200, timestamp: new Date(), path: '/fast', ip: '1.1.1.1' },
        );

        const summary = getMetricsSummary();
        expect(summary[0]!.route).toBe('GET /slow');
        expect(summary[1]!.route).toBe('GET /fast');
    });
});

// ═══════════════════════════════════════════════════════════════
// getGlobalStats
// ═══════════════════════════════════════════════════════════════
describe('getGlobalStats', () => {
    it('deve retornar objeto com uptime, requests, memory, node e pid', () => {
        const stats = getGlobalStats();

        expect(stats).toHaveProperty('uptime');
        expect(stats).toHaveProperty('requests');
        expect(stats).toHaveProperty('memory');
        expect(stats).toHaveProperty('node');
        expect(stats).toHaveProperty('pid');
    });

    it('deve retornar uptime com seconds e human', () => {
        const stats = getGlobalStats();

        expect(typeof stats.uptime.seconds).toBe('number');
        expect(stats.uptime.seconds).toBeGreaterThanOrEqual(0);
        expect(typeof stats.uptime.human).toBe('string');
        expect(stats.uptime.human).toMatch(/\d+s/); // Must contain seconds
    });

    it('deve retornar informacoes de memoria em MB', () => {
        const stats = getGlobalStats();

        expect(typeof stats.memory.heapUsedMB).toBe('number');
        expect(typeof stats.memory.heapTotalMB).toBe('number');
        expect(typeof stats.memory.rssMB).toBe('number');
        expect(typeof stats.memory.externalMB).toBe('number');
        expect(stats.memory.heapUsedMB).toBeGreaterThan(0);
    });

    it('deve retornar versao do Node.js', () => {
        const stats = getGlobalStats();
        expect(stats.node).toBe(process.version);
    });

    it('deve retornar PID do processo', () => {
        const stats = getGlobalStats();
        expect(stats.pid).toBe(process.pid);
    });

    it('deve retornar error rate como string com percentual', () => {
        const stats = getGlobalStats();
        expect(stats.requests.errorRate).toMatch(/^\d+\.\d+%$/);
    });
});
