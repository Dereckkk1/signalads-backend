import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  toggleFavorite,
  getFavorites,
  getFavoriteIds,
  checkIsFavorite
} from '../controllers/favoriteController';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// POST /api/favorites/toggle/:broadcasterId - Toggle favorito
router.post('/toggle/:broadcasterId', toggleFavorite);

// GET /api/favorites - Lista todas as emissoras favoritas (com detalhes)
router.get('/', getFavorites);

// GET /api/favorites/ids - Lista apenas os IDs das emissoras favoritas
router.get('/ids', getFavoriteIds);

// GET /api/favorites/check/:broadcasterId - Verifica se é favorito
router.get('/check/:broadcasterId', checkIsFavorite);

export default router;
