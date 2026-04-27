import { Router } from 'express';
import {
  getMySponsorships,
  createSponsorship,
  updateSponsorship,
  deleteSponsorship,
  getMarketplaceSponsorships
} from '../controllers/sponsorshipController';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth';
import { setCacheHeaders } from '../middleware/cacheControl';
import { requirePermission } from '../middleware/requirePermission';

const router = Router();

// Rotas protegidas - broadcaster/admin
router.get('/my-sponsorships', authenticateToken, getMySponsorships);
// Mutacoes de patrocinio exigem permissao 'products' (manager passa, sales precisa do grupo)
router.post('/', authenticateToken, requirePermission('products'), createSponsorship);
router.put('/:id', authenticateToken, requirePermission('products'), updateSponsorship);
router.delete('/:id', authenticateToken, requirePermission('products'), deleteSponsorship);

// Rota pública de marketplace — Cache-Control habilitado
router.get('/marketplace', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getMarketplaceSponsorships);

export default router;
