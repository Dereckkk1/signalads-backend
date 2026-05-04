import { Router } from 'express';
import multer from 'multer';
import {
  getPendingBroadcasters,
  approveBroadcaster,
  rejectBroadcaster,
  getAllBroadcasters,
  getBroadcastersForManagement,
  getBroadcasterDetails,
  getBroadcasterCampaigns,
  getFullOrdersForAdmin,
  adminApproveOrder,
  updateOrderStatus,
  getAllUsers,
  getUserFullDetails,
  updateUserStatus,
  updateUserRole,
  updateBroadcasterMaxSubUsers,
  adminResetUserPassword,
  deleteUser,
  adminUploadRecordingAudio,
  adminDeleteRecordingAudio
} from '../controllers/adminController';
import {
  createCatalogBroadcaster,
  getCatalogBroadcasters,
  getCatalogBroadcasterById,
  updateCatalogBroadcaster,
  deleteCatalogBroadcaster,
  reactivateCatalogBroadcaster,
  createCatalogProduct,
  getCatalogProducts,
  updateCatalogProduct,
  deleteCatalogProduct,
  completeCatalogProfile,
  uploadCatalogLogo,
  uploadOpec,
  getOrderOpecs,
  deleteOpec,
  getCatalogOrders
} from '../controllers/catalogBroadcasterController';
import { getDirectoryReport, updateDirectoryReportRecord, getDirectoryReportSpotTypes, getDirectoryReportNoProducts, updateBroadcasterPmm } from '../controllers/reportController';
import {
  getOverview,
  getRouteMetrics,
  getErrors,
  getVitals,
  getSlowRequests,
  getTimeline,
  getTopActors,
  getActorDetail,
  getBlockedIps,
  blockIp,
  unblockIp,
  blockUser,
  unblockUser,
} from '../controllers/monitoringController';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import AuditLog from '../models/AuditLog';
import { Response } from 'express';

const router = Router();

// Configuração do Multer para upload de logo.
// Whitelist explícita ao invés de `startsWith('image/')` — SVG (XSS), TIFF,
// BMP, x-icon, etc. ficam de fora. (#46, #48)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens JPEG, PNG ou WebP são permitidas'));
    }
  }
});

// Configuração do Multer para upload de áudio gravado (pelo admin)
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .mp3 e .wav são permitidos'));
    }
  }
});

// Configuração do Multer para upload de OPEC (PDF, imagens)
const uploadOpecFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Apenas PDF e imagens são permitidos'));
    }
  }
});


// ========================
// ROTAS DE EMISSORAS (existentes)
// ========================
router.get('/broadcasters/pending', authenticateToken, requireAdmin, getPendingBroadcasters);
router.get('/broadcasters', authenticateToken, requireAdmin, getAllBroadcasters);
router.get('/broadcasters/management', authenticateToken, requireAdmin, getBroadcastersForManagement);
router.get('/broadcasters/:id', authenticateToken, requireAdmin, getBroadcasterDetails);
router.get('/broadcasters/:id/campaigns', authenticateToken, requireAdmin, getBroadcasterCampaigns);
router.put('/broadcasters/:broadcasterId/approve', authenticateToken, requireAdmin, auditLog('broadcaster.approve', 'broadcaster'), approveBroadcaster);
router.put('/broadcasters/:broadcasterId/reject', authenticateToken, requireAdmin, auditLog('broadcaster.reject', 'broadcaster'), rejectBroadcaster);

// ========================
// ROTAS DE PEDIDOS (gestão completa)
// ========================
router.get('/orders/full', authenticateToken, requireAdmin, getFullOrdersForAdmin);
router.post('/orders/:orderId/approve', authenticateToken, requireAdmin, auditLog('order.approve', 'order'), adminApproveOrder);
router.put('/orders/:orderId/status', authenticateToken, requireAdmin, auditLog('order.status_change', 'order'), updateOrderStatus);
router.post('/orders/:orderId/items/:itemIndex/upload-recording-audio', authenticateToken, requireAdmin, uploadAudio.single('audio'), adminUploadRecordingAudio);
router.delete('/orders/:orderId/items/:itemIndex/recording-audio', authenticateToken, requireAdmin, adminDeleteRecordingAudio);

// ========================
// ROTAS DE EMISSORAS CATÁLOGO (novas)
// ========================
// CRUD de emissoras catálogo
router.post('/catalog-broadcasters', authenticateToken, requireAdmin, auditLog('catalog.create', 'broadcaster'), createCatalogBroadcaster);
router.get('/catalog-broadcasters', authenticateToken, requireAdmin, getCatalogBroadcasters);
router.get('/catalog-broadcasters/:id', authenticateToken, requireAdmin, getCatalogBroadcasterById);
router.put('/catalog-broadcasters/:id', authenticateToken, requireAdmin, auditLog('catalog.update', 'broadcaster'), updateCatalogBroadcaster);
router.delete('/catalog-broadcasters/:id', authenticateToken, requireAdmin, auditLog('catalog.delete', 'broadcaster'), deleteCatalogBroadcaster);
router.post('/catalog-broadcasters/:id/reactivate', authenticateToken, requireAdmin, reactivateCatalogBroadcaster);

// Perfil completo e logo
router.post('/catalog-broadcasters/:id/complete-profile', authenticateToken, requireAdmin, completeCatalogProfile);
router.post('/catalog-broadcasters/:id/upload-logo', authenticateToken, requireAdmin, upload.single('logo'), uploadCatalogLogo);

// Produtos de emissoras catálogo
router.post('/catalog-broadcasters/:broadcasterId/products', authenticateToken, requireAdmin, createCatalogProduct);
router.get('/catalog-broadcasters/:broadcasterId/products', authenticateToken, requireAdmin, getCatalogProducts);
router.put('/catalog-products/:productId', authenticateToken, requireAdmin, updateCatalogProduct);
router.delete('/catalog-products/:productId', authenticateToken, requireAdmin, deleteCatalogProduct);

// ========================
// ROTAS DE OPEC (Comprovantes de Veiculação)
// ========================
router.get('/catalog-orders', authenticateToken, requireAdmin, getCatalogOrders);
router.get('/orders/:orderId/opec', authenticateToken, requireAdmin, getOrderOpecs);
router.post('/orders/:orderId/opec', authenticateToken, requireAdmin, uploadOpecFile.single('opec'), uploadOpec);
router.delete('/orders/:orderId/opec/:opecId', authenticateToken, requireAdmin, deleteOpec);

// ========================
// ROTAS DE GESTÃO DE USUÁRIOS
// ========================
router.get('/users', authenticateToken, requireAdmin, getAllUsers);
router.get('/users/:userId', authenticateToken, requireAdmin, getUserFullDetails);
router.put('/users/:userId/status', authenticateToken, requireAdmin, auditLog('user.status_change', 'user'), updateUserStatus);
router.put('/users/:userId/role', authenticateToken, requireAdmin, auditLog('user.role_change', 'user'), updateUserRole);
router.put('/users/:userId/max-sub-users', authenticateToken, requireAdmin, auditLog('user.max_sub_users_change', 'user'), updateBroadcasterMaxSubUsers);
router.put('/users/:userId/reset-password', authenticateToken, requireAdmin, auditLog('user.reset_password', 'user'), adminResetUserPassword);
router.delete('/users/:userId', authenticateToken, requireAdmin, auditLog('user.delete', 'user'), deleteUser);

// ========================
// ROTAS DE RELATÓRIO DA DIRETORIA
// ========================
router.get('/directory-report', authenticateToken, requireAdmin, getDirectoryReport);
router.get('/directory-report/spot-types', authenticateToken, requireAdmin, getDirectoryReportSpotTypes);
router.get('/directory-report/no-products', authenticateToken, requireAdmin, getDirectoryReportNoProducts);
router.put('/directory-report/broadcaster/:broadcasterId/pmm', authenticateToken, requireAdmin, updateBroadcasterPmm);
router.put('/directory-report/:productId', authenticateToken, requireAdmin, updateDirectoryReportRecord);

// ========================
// ROTAS DE MONITORAMENTO
// Query param: ?range=1h|24h|7d|30d (default: 24h)
// ========================
router.get('/monitoring/overview', authenticateToken, requireAdmin, getOverview);
router.get('/monitoring/routes', authenticateToken, requireAdmin, getRouteMetrics);
router.get('/monitoring/errors', authenticateToken, requireAdmin, getErrors);
router.get('/monitoring/vitals', authenticateToken, requireAdmin, getVitals);
router.get('/monitoring/slow', authenticateToken, requireAdmin, getSlowRequests);
router.get('/monitoring/timeline', authenticateToken, requireAdmin, getTimeline);
router.get('/monitoring/top-actors', authenticateToken, requireAdmin, getTopActors);
router.get('/monitoring/actor-detail', authenticateToken, requireAdmin, getActorDetail);
router.get('/monitoring/blocked-ips', authenticateToken, requireAdmin, getBlockedIps);
router.post('/monitoring/block-ip', authenticateToken, requireAdmin, blockIp);
router.delete('/monitoring/block-ip/:ip', authenticateToken, requireAdmin, unblockIp);
router.post('/monitoring/block-user/:userId', authenticateToken, requireAdmin, blockUser);
router.post('/monitoring/unblock-user/:userId', authenticateToken, requireAdmin, unblockUser);

// ========================
// ROTAS DE AUDIT LOG
// ========================
router.get('/audit-logs', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { action, resource, userId, startDate, endDate, page = '1', limit = '50' } = req.query;

    const filter: any = {};
    if (action) filter.action = action;
    if (resource) filter.resource = resource;
    if (userId) filter.userId = userId;
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate as string);
      if (endDate) filter.timestamp.$lte = new Date(endDate as string);
    }

    const pageNum = parseInt(page as string, 10);
    const limitNum = Math.min(parseInt(limit as string, 10), 100);

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('userId', 'email companyName userType')
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
  } catch {
    res.status(500).json({ error: 'Erro ao buscar audit logs' });
  }
});

export default router;
