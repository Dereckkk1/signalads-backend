import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
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
router.get('/', authenticateToken, getBlockedDomains);
router.get('/defaults', authenticateToken, getDefaultDomains);
router.post('/', authenticateToken, addBlockedDomain);
router.delete('/:id', authenticateToken, removeBlockedDomain);

export default router;
