import { Router } from 'express';
import { 
  getBroadcasterDetails,
  updateBroadcasterProfile,
  getOnboardingProgress, 
  saveOnboardingStep,
  completeOnboarding
} from '../controllers/onboardingController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Rota pública - obter detalhes de emissora
router.get('/broadcaster/:broadcasterId', authenticateToken, getBroadcasterDetails);

// Rota para atualizar perfil da emissora
router.put('/broadcaster/:broadcasterId', authenticateToken, updateBroadcasterProfile);

// Rotas protegidas - requer autenticação
router.get('/progress', authenticateToken, getOnboardingProgress);
router.post('/step', authenticateToken, saveOnboardingStep);
router.post('/complete', authenticateToken, completeOnboarding);

export default router;
