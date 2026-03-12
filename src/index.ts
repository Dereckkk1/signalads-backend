import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import connectDB from './config/database';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
// import onboardingRoutes from './routes/onboardingRoutes'; // DESABILITADO - Broadcasters gerenciados pelo admin
import productRoutes from './routes/productRoutes';
import cartRoutes from './routes/cartRoutes';
import uploadRoutes from './routes/uploadRoutes';
import paymentRoutes from './routes/paymentRoutes';
import walletRoutes from './routes/walletRoutes';
import campaignRoutes from './routes/campaignRoutes';
import materialRoutes from './routes/materialRoutes';
import chatRoutes from './routes/chatRoutes';
import billingRoutes from './routes/billingRoutes';
import financialRoutes from './routes/financialRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import favoriteRoutes from './routes/favoriteRoutes';
import broadcasterWalletRoutes from './routes/broadcasterWalletRoutes';
import quoteRequestRoutes from './routes/quoteRequestRoutes';
import imageRoutes from './routes/imageRoutes';
import recommendationRoutes from './routes/recommendationRoutes';
import agencyRoutes from './routes/agencyRoutes';
import contactMessageRoutes from './routes/contactMessageRoutes';
import blockedDomainRoutes from './routes/blockedDomainRoutes';
import productRequestRoutes from './routes/productRequestRoutes';
import profileRequestRoutes from './routes/profileRequestRoutes';
import { startBackupCron } from './cron/backupCron';
// Middlewares de Segurança
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
// import mongoSanitize from 'express-mongo-sanitize'; // Incompatible with Express 5
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import { mongoSanitize, xssSanitize } from './middleware/security';
import { csrfProtection } from './middleware/csrf';
import { metricsMiddleware } from './middleware/metrics';
import healthRoutes from './routes/healthRoutes';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000; // v2

// Habilita confiança no proxy (Nginx/Cloudflare) para pegar IP real do usuário (necessário para rate-limit)
app.set('trust proxy', 1);

// Configuração de Segurança
const allowedOrigins = [
  'https://eradios.com.br',
  'https://www.eradios.com.br',
  'https://api.eradios.com.br',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000'
];

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

// Rate Limit Global — 500 req/min por IP (seguranca contra abuso/DDoS)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  message: 'Muitas requisições deste IP, por favor tente novamente em um minuto.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

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
// app.use('/api/onboarding', onboardingRoutes); // DESABILITADO - Broadcasters gerenciados pelo admin
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/billing', billingRoutes); // Rotas gerais de billing (cliente + admin)
app.use('/api/admin/billing', billingRoutes); // Mantém compatibilidade com rotas admin
app.use('/api/admin/financial', financialRoutes); // Rotas do painel financeiro admin
app.use('/api/invoices', invoiceRoutes); // Rotas de notas fiscais
app.use('/api/favorites', favoriteRoutes); // Rotas de favoritos
app.use('/api/broadcaster', broadcasterWalletRoutes); // Rotas de wallet da emissora
app.use('/api/quotes', quoteRequestRoutes); // Rotas de solicitações de contato (NEW)
app.use('/api/image', imageRoutes); // Rotas de proxy de imagens
app.use('/api/recommendations', recommendationRoutes); // Rotas de recomendação IA (NEW)
app.use('/api/agency', agencyRoutes); // Rotas de clientes de agência
app.use('/api/contact-messages', contactMessageRoutes); // Rotas para mensagens do footer
app.use('/api/blocked-domains', blockedDomainRoutes); // Rotas de domínios bloqueados (email corporativo)
app.use('/api/product-requests', productRequestRoutes); // Rotas de solicitações de produtos (emissoras)
app.use('/api/profile-requests', profileRequestRoutes); // Rotas de solicitações de perfil (emissoras)

// Rota de teste
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: '🚀 E-rádios Backend API está rodando!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Rota de health check legada (mantida para compatibilidade)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
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
  const message = err.message || 'Erro interno do servidor';

  res.status(status).json({
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Conectar ao banco e iniciar servidor
const startServer = async () => {
  try {
    await connectDB();

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
