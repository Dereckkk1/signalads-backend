import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { generatePlan } from '../controllers/recommendationController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Rate limit especifico para recomendacoes IA (endpoint pesado)
const recommendationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                   // 10 requisicoes por janela
  message: 'Muitas solicitações de recomendação. Tente novamente em 15 minutos.',
});

// POST /api/recommendations/plan — requer autenticacao + rate limit
router.post('/plan', authenticateToken, recommendationLimiter, generatePlan);

export default router;
