import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import {
  getBlockedDomains,
  getDefaultDomains,
  addBlockedDomain,
  removeBlockedDomain,
  checkEmail,
} from '../controllers/blockedDomainController';

const router = Router();

// Endpoint público — usado pelo frontend no cadastro para validar email em tempo real
router.post('/check', checkEmail);

// Rotas protegidas (admin only)
router.get('/', authenticateToken, requireAdmin, getBlockedDomains);
router.get('/defaults', authenticateToken, requireAdmin, getDefaultDomains);
router.post('/', authenticateToken, requireAdmin, addBlockedDomain);
router.delete('/:id', authenticateToken, requireAdmin, removeBlockedDomain);

export default router;
