import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

// Diretorio base dos reports de teste
const REPORTS_DIR = path.resolve(__dirname, '../../test-reports');
const COVERAGE_DIR = path.resolve(__dirname, '../../coverage');

// ─────────────────────────────────────────────────────────────
// GET /api/test-reports/summary — Resumo JSON dos testes
// Protegido: apenas admin
// ─────────────────────────────────────────────────────────────
router.get('/summary', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
    try {
        const summary: any = {
            timestamp: new Date().toISOString(),
            backend: null,
            frontend: null,
        };

        // Backend coverage summary
        const backendCoveragePath = path.resolve(COVERAGE_DIR, 'coverage-summary.json');
        if (fs.existsSync(backendCoveragePath)) {
            const raw = fs.readFileSync(backendCoveragePath, 'utf-8');
            const data = JSON.parse(raw);
            summary.backend = {
                coverage: data.total,
                reportUrl: '/api/test-reports/backend/coverage',
                htmlReportUrl: '/api/test-reports/backend/html',
                lastRun: fs.statSync(backendCoveragePath).mtime.toISOString(),
            };
        }

        // Frontend coverage summary
        const frontendCoveragePath = path.resolve(__dirname, '../../../signalads-frontend/coverage/coverage-summary.json');
        if (fs.existsSync(frontendCoveragePath)) {
            const raw = fs.readFileSync(frontendCoveragePath, 'utf-8');
            const data = JSON.parse(raw);
            summary.frontend = {
                coverage: data.total,
                reportUrl: '/api/test-reports/frontend/coverage',
                lastRun: fs.statSync(frontendCoveragePath).mtime.toISOString(),
            };
        }

        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao carregar resumo dos testes' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/test-reports/backend/html — HTML report do Jest
// ─────────────────────────────────────────────────────────────
router.get('/backend/html', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
    const htmlPath = path.resolve(REPORTS_DIR, 'backend-report.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).json({ error: 'Report não encontrado. Execute npm run test:report primeiro.' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/test-reports/backend/coverage — Coverage HTML
// ─────────────────────────────────────────────────────────────
router.get('/backend/coverage', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
    const htmlPath = path.resolve(COVERAGE_DIR, 'lcov-report/index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).json({ error: 'Coverage report não encontrado. Execute npm run test:coverage primeiro.' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/test-reports/frontend/coverage — Frontend coverage HTML
// ─────────────────────────────────────────────────────────────
router.get('/frontend/coverage', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
    const htmlPath = path.resolve(__dirname, '../../../signalads-frontend/coverage/lcov-report/index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).json({ error: 'Coverage report do frontend não encontrado.' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /api/test-reports/dashboard — Dashboard HTML completo
// ─────────────────────────────────────────────────────────────
router.get('/dashboard', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
    const dashboardPath = path.resolve(REPORTS_DIR, 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
    } else {
        res.status(404).json({ error: 'Dashboard não encontrado. Execute npm run test:all primeiro.' });
    }
});

export default router;
