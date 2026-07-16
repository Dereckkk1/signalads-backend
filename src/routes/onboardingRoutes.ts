import { Router } from 'express';
import { authenticateToken, requireBroadcasterManager } from '../middleware/auth';
import {
  getOnboardingProgress,
  saveOnboardingStep,
  updateBroadcasterProfile,
} from '../controllers/onboardingController';

const router = Router();

// Onboarding self-service — apenas o gerenciador da emissora (sub-usuarios sales nao passam)
router.get('/progress', authenticateToken, requireBroadcasterManager, getOnboardingProgress);
router.post('/step', authenticateToken, requireBroadcasterManager, saveOnboardingStep);
router.put('/broadcaster/:id', authenticateToken, requireBroadcasterManager, updateBroadcasterProfile);

export default router;
