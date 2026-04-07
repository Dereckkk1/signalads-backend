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

const router = Router();

// Rotas protegidas - broadcaster/admin
router.get('/my-sponsorships', authenticateToken, getMySponsorships);
router.post('/', authenticateToken, createSponsorship);
router.put('/:id', authenticateToken, updateSponsorship);
router.delete('/:id', authenticateToken, deleteSponsorship);

// Rota pública de marketplace — Cache-Control habilitado
router.get('/marketplace', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getMarketplaceSponsorships);

export default router;
