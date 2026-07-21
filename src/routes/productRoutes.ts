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
  getStationBySlug,
  getMapProducts,
  searchBroadcastersForCompare
} from '../controllers/productController';
import { getShelves, getSimilar, getSuggestions, getMarketplaceRegions, getByGenre, getByIds } from '../controllers/shelvesController';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth';
import { setCacheHeaders } from '../middleware/cacheControl';
import { requirePermission } from '../middleware/requirePermission';

const router = Router();

// Rotas protegidas - broadcaster
// SEGURANCA (3.6): a LEITURA do catalogo tambem e dado sensivel — o export
// carrega o netPrice (preco liquido da emissora). So as mutacoes tinham
// requirePermission; um sub-usuario 'sales' sem permissao de produtos
// exportava a tabela de precos inteira.
router.get('/my-products', authenticateToken, requirePermission('products'), getMyProducts);
router.get('/my-products/export', authenticateToken, requirePermission('products'), exportProducts);
// Mutacoes de catalogo exigem permissao 'products' (manager passa, sales precisa do grupo)
router.post('/', authenticateToken, requirePermission('products'), createProduct);
router.put('/:productId', authenticateToken, requirePermission('products'), updateProduct);
router.delete('/:productId', authenticateToken, requirePermission('products'), deleteProduct);

// Rotas publicas de marketplace — Cache-Control habilitado para CDN/browser
router.get('/map', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getMapProducts);
router.get('/compare/search', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), searchBroadcastersForCompare);
router.get('/marketplace/cities', optionalAuthenticateToken, setCacheHeaders('public', 60, 120), getMarketplaceCities);
router.get('/marketplace/shelves', optionalAuthenticateToken, setCacheHeaders('public', 60, 120), getShelves);
router.get('/marketplace/similar', optionalAuthenticateToken, setCacheHeaders('public', 60, 120), getSimilar);
router.get('/marketplace/suggest', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getSuggestions);
router.get('/marketplace/regions', optionalAuthenticateToken, setCacheHeaders('public', 60, 120), getMarketplaceRegions);
router.get('/marketplace/by-genre', optionalAuthenticateToken, setCacheHeaders('public', 60, 120), getByGenre);
router.get('/marketplace/by-ids', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getByIds);
router.get('/marketplace/station/:slug', optionalAuthenticateToken, setCacheHeaders('public', 60, 120), getStationBySlug);
router.get('/marketplace/broadcaster/:broadcasterId', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getMarketplaceBroadcasterDetails);
router.get('/marketplace', optionalAuthenticateToken, setCacheHeaders('public', 30, 60), getAllActiveProducts);

export default router;
