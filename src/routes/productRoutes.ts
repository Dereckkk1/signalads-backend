import { Router } from 'express';
import {
  getMyProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getAllActiveProducts,
  getMarketplaceCities,
  getMarketplaceBroadcasterDetails,
  getMapProducts,
  searchBroadcastersForCompare
} from '../controllers/productController';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth';

const router = Router();

// Rotas protegidas - broadcaster
router.get('/my-products', authenticateToken, getMyProducts);
router.post('/', authenticateToken, createProduct);
router.put('/:productId', authenticateToken, updateProduct);
router.delete('/:productId', authenticateToken, deleteProduct);

// Rota pública para marketplace (mas precisa estar autenticado)
router.get('/map', optionalAuthenticateToken, getMapProducts); // Rota dedicada ao mapa
router.get('/compare/search', optionalAuthenticateToken, searchBroadcastersForCompare); // Busca para o Comparador
router.get('/marketplace/cities', optionalAuthenticateToken, getMarketplaceCities);
router.get('/marketplace/broadcaster/:broadcasterId', optionalAuthenticateToken, getMarketplaceBroadcasterDetails);
router.get('/marketplace', optionalAuthenticateToken, getAllActiveProducts);

export default router;
