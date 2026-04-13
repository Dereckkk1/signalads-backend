import { Router } from 'express';
import {
  getMyProducts,
  exportProducts,
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
import { setCacheHeaders } from '../middleware/cacheControl';

const router = Router();

// Rotas protegidas - broadcaster
router.get('/my-products', authenticateToken, getMyProducts);
router.get('/my-products/export', authenticateToken, exportProducts);
router.post('/', authenticateToken, createProduct);
router.put('/:productId', authenticateToken, updateProduct);
router.delete('/:productId', authenticateToken, deleteProduct);

// Rotas publicas de marketplace — Cache-Control habilitado para CDN/browser
router.get('/map', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getMapProducts);
router.get('/compare/search', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), searchBroadcastersForCompare);
router.get('/marketplace/cities', optionalAuthenticateToken, setCacheHeaders('public', 60, 120), getMarketplaceCities);
router.get('/marketplace/broadcaster/:broadcasterId', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getMarketplaceBroadcasterDetails);
router.get('/marketplace', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getAllActiveProducts);

export default router;
