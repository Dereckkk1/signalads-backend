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

// Middlewares de Segurança
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
// import mongoSanitize from 'express-mongo-sanitize'; // Incompatible with Express 5
import hpp from 'hpp';
import { mongoSanitize } from './middleware/security';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000; // v2

// Habilita confiança no proxy (Nginx/Cloudflare) para pegar IP real do usuário (necessário para rate-limit)
app.set('trust proxy', 1);

// Configuração de Segurança
app.use(cors({
  origin: '*', // Permite todas as origens (dev) ou especifique ex: 'http://localhost:3000'
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
})); // Define headers HTTP seguros e permite recursos cross-origin (imagens)

// Rate Limit Global - 60 requisições por minuto (Solicitado pelo cliente)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 3000,
  message: 'Muitas requisições deste IP, por favor tente novamente em um minuto.',
});
app.use(limiter);

// Middlewares Padrão
// app.use(cors()); // Moved up
app.use(express.json({ limit: '50mb' })); // Limita o tamanho do body para evitar DoS (Aumentado para 50mb para uploads)
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Proteção contra NoSQL Injection e XSS
app.use(mongoSanitize); // Previne injeção de operadores MongoDB (Custom Implementation)
// app.use(xss()); // Sanitiza o input do usuário (XSS) - DISABLING: Incompatible with Express 5 (CRASH)
app.use(hpp()); // Previne poluição de parâmetros HTTP

// Servir arquivos estáticos (uploads locais para desenvolvimento)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
app.use('/api/images', imageRoutes); // Rotas de proxy de imagens
app.use('/api/recommendations', recommendationRoutes); // Rotas de recomendação IA (NEW)

// Rota de teste
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: '🚀 E-rádios Backend API está rodando!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Rota de health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
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
  } catch (error) {
    console.error('Erro ao iniciar servidor:', error);
    process.exit(1);
  }
};

startServer();

export default app;
