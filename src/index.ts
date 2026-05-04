import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
import proposalRoutes from './routes/proposalRoutes';
import broadcasterProposalRoutes from './routes/broadcasterProposalRoutes';
import broadcasterSubUserRoutes from './routes/broadcasterSubUserRoutes';
import broadcasterGroupRoutes from './routes/broadcasterGroupRoutes';
import broadcasterGoalsRoutes from './routes/broadcasterGoalsRoutes';
import broadcasterReportsRoutes from './routes/broadcasterReportsRoutes';
import broadcasterCalendarRoutes from './routes/broadcasterCalendarRoutes';
import testReportRoutes from './routes/testReportRoutes';
import sponsorshipRoutes from './routes/sponsorshipRoutes';
import insertionTimeSlotRoutes from './routes/insertionTimeSlotRoutes';
import kanbanRoutes from './routes/kanbanRoutes';
import broadcasterComboRoutes from './routes/broadcasterComboRoutes';
import { startBackupCron } from './cron/backupCron';
import { startExpireProposalsCron } from './cron/expireProposals';
import { startProposalAlertsCron } from './cron/proposalAlerts';
// Middlewares de Segurança
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
// import mongoSanitize from 'express-mongo-sanitize'; // Incompatible with Express 5
// import hpp from 'hpp'; // Incompatible com Express 5 (req.query e read-only). Substituido por dedupeQuery local.
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { redis } from './config/redis';
import { createRedisStore } from './config/rateLimitStore';
import { mongoSanitize, xssSanitize, dedupeQuery } from './middleware/security';
import { csrfProtection } from './middleware/csrf';
import { metricsMiddleware, checkBlockedIP } from './middleware/metrics';
import { checkSuspiciousPath } from './middleware/suspiciousPath';
import { loadBlockedIPs } from './utils/ipBlockList';
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

// Permissions-Policy: desabilita APIs sensiveis nao usadas pela aplicacao (defesa em profundidade)
app.use((req: Request, res: Response, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), fullscreen=(self), interest-cohort=()'
  );
  next();
});

// ─────────────────────────────────────────────────────────────
// Rate Limiting dual: por IP + por userId autenticado
//
// Por quê dual?
//   - IP sozinho fode CGNAT: empresa inteira cai junto
//   - userId sozinho deixa ataques anônimos passarem
//   - Dois limiters em série cobre os dois vetores
//
// Limiter 1 — por IP (300 req/min)
//   Protege contra anonimos e é CGNAT-friendly (limite mais alto)
//
// Limiter 2 — por userId (150 req/min)
//   Só dispara quando há JWT válido. Usa jwt.decode() sem verificar
//   (verificação real continua na auth middleware) — apenas para
//   extrair a chave de rate limit. Forjar userId só queima a cota
//   de outra chave, não ajuda o atacante.
//
// Headers retornados (RFC 6585 + draft-ietf-httpapi-ratelimit):
//   RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After
// ─────────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';

const isHealthCheck = (req: Request) =>
  req.path === '/api/health' || req.path === '/health';

const getUserIdFromToken = (req: Request): string | null => {
  try {
    const token = (req as any).cookies?.access_token;
    if (!token) return null;
    const decoded = jwt.decode(token) as { userId?: string } | null;
    return decoded?.userId || null;
  } catch {
    return null;
  }
};

// Limiter 1: por IP — 300 req/min
const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isHealthCheck,
  store: createRedisStore('ip'),
  keyGenerator: (req) => ipKeyGenerator(req.ip || 'unknown'),
  message: { error: 'Muitas requisições deste IP. Tente novamente em um minuto.' },
});

// Limiter 2: por userId — 150 req/min (só para autenticados)
const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isHealthCheck(req) || !getUserIdFromToken(req),
  store: createRedisStore('user'),
  keyGenerator: (req) => `user:${getUserIdFromToken(req)}`,
  message: { error: 'Limite de requisições por conta atingido. Tente novamente em um minuto.' },
});

// IMPORTANTE: cookieParser DEVE rodar antes dos rate limiters — userLimiter
// le req.cookies.access_token para extrair o userId. Se cookieParser rodar depois,
// req.cookies fica undefined e o limiter por usuario nunca dispara.
app.use(cookieParser());

app.use(ipLimiter);
app.use(userLimiter);

// Compressao de respostas (gzip/brotli) — reduz 70-80% do tamanho de JSONs grandes
app.use(compression());

// Middlewares Padrao
// Body limit reduzido para 5mb (seguranca contra DoS). Uploads de audio usam multipart com limite proprio no multer.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Protecao contra NoSQL Injection, XSS, HPP e CSRF
app.use(mongoSanitize); // Previne injecao de operadores MongoDB (Custom + prototype pollution)
app.use(xssSanitize);   // Sanitiza input contra XSS (substitui xss-clean incompativel com Express 5)
app.use(dedupeQuery);   // Previne poluicao de parametros HTTP (substitui hpp@0.2.3 incompativel com Express 5)
app.use(csrfProtection); // CSRF double-submit cookie (verifica X-CSRF-Token header)

// Static /uploads removido (Agent 6): uploads locais nao sao mais usados em producao,
// arquivos vao para Google Cloud Storage. Servir uploads/ localmente expoe arquivos
// fora do controle de auth da aplicacao.

// Bloqueio instantaneo de paths suspeitos (.env, wp-admin, .git, etc.)
// Vem ANTES do checkBlockedIP para tambem registrar o IP na blocklist na primeira tentativa.
app.use(checkSuspiciousPath);

// Bloqueio de IPs (antes das rotas, admin routes isentas — ver checkBlockedIP)
app.use(checkBlockedIP);

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
app.use('/api/proposals', proposalRoutes); // Propostas comerciais de agências
app.use('/api/broadcaster-proposals', broadcasterProposalRoutes); // Propostas comerciais de emissoras
app.use('/api/broadcaster', broadcasterSubUserRoutes); // Sub-usuarios de emissoras
app.use('/api/broadcaster', broadcasterGroupRoutes);   // Grupos de permissoes de emissoras
app.use('/api/broadcaster', broadcasterGoalsRoutes);  // Metas comerciais de emissoras
app.use('/api/broadcaster', broadcasterReportsRoutes); // Central de relatórios de emissoras
app.use('/api/broadcaster', broadcasterCalendarRoutes); // Calendário da emissora
app.use('/api/test-reports', testReportRoutes); // Dashboard de testes (admin only)
app.use('/api/sponsorships', sponsorshipRoutes); // Patrocínios de programas (emissoras)
app.use('/api/insertion-time-slots', insertionTimeSlotRoutes); // Faixas horárias reutilizáveis (emissoras)
app.use('/api/kanban', kanbanRoutes); // Colunas customizadas + drag-n-drop de propostas/pedidos
app.use('/api/broadcaster-combos', broadcasterComboRoutes); // Combos pré-definidos de produtos/patrocínios (emissoras)

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

    // Carrega IPs bloqueados em memória para checagem rápida
    await loadBlockedIPs();

    // Inicia crons
    startBackupCron();
    startExpireProposalsCron();
    startProposalAlertsCron();
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
