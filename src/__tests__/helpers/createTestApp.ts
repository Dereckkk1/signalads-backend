/**
 * Test App Factory
 *
 * Creates a minimal Express app that mirrors the main app's middleware and routes
 * WITHOUT Redis, rate limiting, cron jobs, or external services.
 * Supertest drives the HTTP layer — the app never calls .listen().
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';

// Routes
import authRoutes from '../../routes/authRoutes';
import adminRoutes from '../../routes/adminRoutes';
import productRoutes from '../../routes/productRoutes';
import cartRoutes from '../../routes/cartRoutes';
import healthRoutes from '../../routes/healthRoutes';

export function createTestApp(): Application {
  const app = express();

  // --- Core middleware (same order as index.ts) ---
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Security middleware
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);

  // --- Routes ---
  app.use('/api', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/cart', cartRoutes);

  // Root test route
  app.get('/', (_req: Request, res: Response) => {
    res.json({ message: 'Test app running' });
  });

  // 404 Handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  // Global error handler (Express requires all 4 params for error middleware)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || 500;
    res.status(status).json({ error: 'Erro interno do servidor' });
  });

  return app;
}
