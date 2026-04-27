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
import { requirePermission } from '../middleware/requirePermission';

const router = Router();

// Rotas protegidas - broadcaster
router.get('/my-products', authenticateToken, getMyProducts);
router.get('/my-products/export', authenticateToken, exportProducts);
// Mutacoes de catalogo exigem permissao 'products' (manager passa, sales precisa do grupo)
router.post('/', authenticateToken, requirePermission('products'), createProduct);
router.put('/:productId', authenticateToken, requirePermission('products'), updateProduct);
router.delete('/:productId', authenticateToken, requirePermission('products'), deleteProduct);

// Rotas publicas de marketplace — Cache-Control habilitado para CDN/browser
router.get('/map', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getMapProducts);
router.get('/compare/search', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), searchBroadcastersForCompare);
router.get('/marketplace/cities', optionalAuthenticateToken, setCacheHeaders('public', 60, 120), getMarketplaceCities);
router.get('/marketplace/broadcaster/:broadcasterId', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getMarketplaceBroadcasterDetails);
router.get('/marketplace', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getAllActiveProducts);

export default router;
