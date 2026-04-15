import { Router } from 'express';
import { authenticateToken, requireBroadcasterManager } from '../middleware/auth';
import {
  listSubUsers,
  createSubUser,
  updateSubUser,
  deleteSubUser,
  resendInvite,
  getSubUserStats,
  getSubUserDashboard
} from '../controllers/broadcasterSubUserController';

const router = Router();

// Todas as rotas exigem autenticacao + ser manager da emissora
router.use(authenticateToken);

router.get('/sub-users', listSubUsers);
router.get('/sub-users/stats', getSubUserStats);
router.get('/sub-users/dashboard', getSubUserDashboard);
router.post('/sub-users', createSubUser);
router.put('/sub-users/:id', updateSubUser);
router.delete('/sub-users/:id', deleteSubUser);
router.post('/sub-users/:id/resend-invite', resendInvite);

export default router;
