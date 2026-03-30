import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import connectDB from './config/database';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import productRoutes from './routes/productRoutes';
import cartRoutes from './routes/cartRoutes';
import uploadRoutes from './routes/uploadRoutes';
import campaignRoutes from './routes/campaignRoutes';
import materialRoutes from './routes/materialRoutes';
import quoteRequestRoutes from './routes/quoteRequestRoutes';
import imageRoutes from './routes/imageRoutes';
import recommendationRoutes from './routes/recommendationRoutes';
import agencyRoutes from './routes/agencyRoutes';
import contactMessageRoutes from './routes/contactMessageRoutes';
import blockedDomainRoutes from './routes/blockedDomainRoutes';
import productRequestRoutes from './routes/productRequestRoutes';
import profileRequestRoutes from './routes/profileRequestRoutes';
import paymentRoutes from './routes/paymentRoutes';
import { startBackupCron } from './cron/backupCron';
// Middlewares de Segurança
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
// import mongoSanitize from 'express-mongo-sanitize'; // Incompatible with Express 5
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { redis } from './config/redis';
import { mongoSanitize, xssSanitize } from './middleware/security';
import { csrfProtection } from './middleware/csrf';
import { metricsMiddleware } from './middleware/metrics';
import healthRoutes from './routes/healthRoutes';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000; // v2

// Confiança no proxy: apenas em prod (atrás de Nginx/Cloudflare). Em dev, usa IP direto.
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

// Configuração de Segurança
const productionOrigins = [
  'https://eradios.com.br',
  'https://www.eradios.com.br',
  'https://api.eradios.com.br',
];
const devOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
];
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? productionOrigins
  : [...productionOrigins, ...devOrigins];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Origin',
    'X-Requested-With',
    'Accept',
    'x-access-token',
    'X-CSRF-Token',
    'Range'
  ],
  credentials: true,
  optionsSuccessStatus: 200
}));
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://storage.googleapis.com", "https://*.appsheet.com", "https://ui-avatars.com", "https://lh3.googleusercontent.com"],
      connectSrc: ["'self'", "https://api.eradios.com.br", "https://viacep.com.br", "https://*.tile.openstreetmap.org"],
      fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      mediaSrc: ["'self'", "https://storage.googleapis.com", "blob:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

// Rate Limit Global — 2000 req/min por IP (suporta 200+ usuarios simultaneos)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 2000,
  message: 'Muitas requisições deste IP, por favor tente novamente em um minuto.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health' || req.path === '/health',
});
app.use(limiter);

// Compressao de respostas (gzip/brotli) — reduz 70-80% do tamanho de JSONs grandes
app.use(compression());

// Middlewares Padrao
// Body limit reduzido para 5mb (seguranca contra DoS). Uploads de audio usam multipart com limite proprio no multer.
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Protecao contra NoSQL Injection, XSS, HPP e CSRF
app.use(mongoSanitize); // Previne injecao de operadores MongoDB (Custom + prototype pollution)
app.use(xssSanitize);   // Sanitiza input contra XSS (substitui xss-clean incompativel com Express 5)
app.use(hpp());          // Previne poluicao de parametros HTTP
app.use(csrfProtection); // CSRF double-submit cookie (verifica X-CSRF-Token header)

// Servir arquivos estáticos (uploads locais para desenvolvimento)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Coleta de métricas de performance (antes das rotas para capturar tudo)
app.use(metricsMiddleware);

// Rotas de infra (health, metrics, vitals) — sem auth
app.use('/api', healthRoutes);

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/quotes', quoteRequestRoutes); // Rotas de solicitações de contato (NEW)
app.use('/api/image', imageRoutes); // Rotas de proxy de imagens
app.use('/api/recommendations', recommendationRoutes); // Rotas de recomendação IA (NEW)
app.use('/api/agency', agencyRoutes); // Rotas de clientes de agência
app.use('/api/contact-messages', contactMessageRoutes); // Rotas para mensagens do footer
app.use('/api/blocked-domains', blockedDomainRoutes); // Rotas de domínios bloqueados (email corporativo)
app.use('/api/product-requests', productRequestRoutes); // Rotas de solicitações de produtos (emissoras)
app.use('/api/profile-requests', profileRequestRoutes); // Rotas de solicitações de perfil (emissoras)
app.use('/api/payment', paymentRoutes); // Checkout (criação de pedido)

// Rota de teste
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: '🚀 E-rádios Backend API está rodando!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Rota de health check legada (mantida para compatibilidade) — sem dados sensiveis
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error Handler Global
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('❌ Erro global capturado:', err);

  // Tratamento específico para erros do Multer (ex: arquivo muito grande)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'Arquivo muito grande. O limite é de 50MB.'
    });
  }

  const status = err.status || 500;

  // Stack traces NUNCA vao pro cliente — apenas logados server-side acima
  res.status(status).json({
    error: 'Erro interno do servidor'
  });
});

// Conectar ao banco, Redis e iniciar servidor
const startServer = async () => {
  try {
    await connectDB();

    // Conectar Redis (lazyConnect — so conecta quando chamamos .connect())
    try {
      await redis.connect();
    } catch (err) {
      console.warn('⚠️ Redis indisponivel — app funciona sem cache:', (err as Error).message);
    }

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
    });

    // Inicia cron de backup automatico (meia-noite)
    startBackupCron();
  } catch (error) {
    console.error('Erro ao iniciar servidor:', error);
    process.exit(1);
  }
};

// Em modo de teste (Jest), não inicia o servidor nem conecta ao Atlas
// O banco é gerenciado pelo mongodb-memory-server via setup.ts
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
