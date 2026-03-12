import { Router } from 'express';
import multer from 'multer';
import {
  getPendingBroadcasters,
  approveBroadcaster,
  rejectBroadcaster,
  getAllBroadcasters,
  getBroadcastersForManagement,
  getOrCreateAdminConversation,
  getBroadcasterDetails,
  getBroadcasterWallet,
  getBroadcasterCampaigns,
  getFullOrdersForAdmin,
  adminApproveOrder,
  getPlatformWallet,
  updatePlatformBankAccount,
  requestPlatformWithdraw,
  confirmPlatformWithdraw,
  checkPendingTransfers,
  getPendingWithdrawRequests,
  processWithdrawRequest,
  rejectWithdrawRequest,
  updateOrderStatus,
  getAllUsers,
  getUserFullDetails,
  updateUserStatus,
  updateUserRole,
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
import { getDirectoryReport, updateDirectoryReportRecord, getDirectoryReportSpotTypes } from '../controllers/reportController';
import {
  getOverview,
  getRouteMetrics,
  getErrors,
  getVitals,
  getSlowRequests,
  getTimeline
} from '../controllers/monitoringController';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import AuditLog from '../models/AuditLog';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Configuração do Multer para upload de logo
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens são permitidas'));
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

// Middleware para verificar se é admin
const isAdmin = (req: any, res: any, next: any) => {
  if (req.user.userType !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }
  next();
};

// ========================
// ROTAS DE EMISSORAS (existentes)
// ========================
router.get('/broadcasters/pending', authenticateToken, isAdmin, getPendingBroadcasters);
router.get('/broadcasters', authenticateToken, isAdmin, getAllBroadcasters);
router.get('/broadcasters/management', authenticateToken, isAdmin, getBroadcastersForManagement);
router.get('/broadcasters/:id', authenticateToken, isAdmin, getBroadcasterDetails);
router.get('/broadcasters/:id/wallet', authenticateToken, isAdmin, getBroadcasterWallet);
router.get('/broadcasters/:id/campaigns', authenticateToken, isAdmin, getBroadcasterCampaigns);
router.post('/broadcasters/:broadcasterId/chat', authenticateToken, isAdmin, getOrCreateAdminConversation);
router.put('/broadcasters/:broadcasterId/approve', authenticateToken, isAdmin, auditLog('broadcaster.approve', 'broadcaster'), approveBroadcaster);
router.put('/broadcasters/:broadcasterId/reject', authenticateToken, isAdmin, auditLog('broadcaster.reject', 'broadcaster'), rejectBroadcaster);

// ========================
// ROTAS DE PEDIDOS (gestão completa)
// ========================
router.get('/orders/full', authenticateToken, isAdmin, getFullOrdersForAdmin);
router.post('/orders/:orderId/approve', authenticateToken, isAdmin, auditLog('order.approve', 'order'), adminApproveOrder);
router.put('/orders/:orderId/status', authenticateToken, isAdmin, auditLog('order.status_change', 'order'), updateOrderStatus);
router.post('/orders/:orderId/items/:itemIndex/upload-recording-audio', authenticateToken, isAdmin, uploadAudio.single('audio'), adminUploadRecordingAudio);
router.delete('/orders/:orderId/items/:itemIndex/recording-audio', authenticateToken, isAdmin, adminDeleteRecordingAudio);

// ========================
// ROTAS DA WALLET DA PLATAFORMA
// ========================
router.get('/platform-wallet', authenticateToken, isAdmin, getPlatformWallet);
router.put('/platform-wallet/bank-account', authenticateToken, isAdmin, updatePlatformBankAccount);
router.post('/platform-wallet/withdraw', authenticateToken, isAdmin, auditLog('wallet.withdraw', 'platform_wallet'), requestPlatformWithdraw);
router.post('/platform-wallet/confirm-withdraw', authenticateToken, isAdmin, confirmPlatformWithdraw);
router.get('/platform-wallet/check-transfers', authenticateToken, isAdmin, checkPendingTransfers);

// ========================
// ROTAS DE SOLICITAÇÕES DE SAQUE (Emissoras/Agências)
// ========================
router.get('/withdraw-requests', authenticateToken, isAdmin, getPendingWithdrawRequests);
router.post('/withdraw-requests/:walletId/:transactionId/process', authenticateToken, isAdmin, auditLog('withdraw.process', 'wallet'), processWithdrawRequest);
router.post('/withdraw-requests/:walletId/:transactionId/reject', authenticateToken, isAdmin, auditLog('withdraw.reject', 'wallet'), rejectWithdrawRequest);

// ========================
// ROTAS DE EMISSORAS CATÁLOGO (novas)
// ========================
// CRUD de emissoras catálogo
router.post('/catalog-broadcasters', authenticateToken, isAdmin, auditLog('catalog.create', 'broadcaster'), createCatalogBroadcaster);
router.get('/catalog-broadcasters', authenticateToken, isAdmin, getCatalogBroadcasters);
router.get('/catalog-broadcasters/:id', authenticateToken, isAdmin, getCatalogBroadcasterById);
router.put('/catalog-broadcasters/:id', authenticateToken, isAdmin, auditLog('catalog.update', 'broadcaster'), updateCatalogBroadcaster);
router.delete('/catalog-broadcasters/:id', authenticateToken, isAdmin, auditLog('catalog.delete', 'broadcaster'), deleteCatalogBroadcaster);
router.post('/catalog-broadcasters/:id/reactivate', authenticateToken, isAdmin, reactivateCatalogBroadcaster);

// Perfil completo e logo
router.post('/catalog-broadcasters/:id/complete-profile', authenticateToken, isAdmin, completeCatalogProfile);
router.post('/catalog-broadcasters/:id/upload-logo', authenticateToken, isAdmin, upload.single('logo'), uploadCatalogLogo);

// Produtos de emissoras catálogo
router.post('/catalog-broadcasters/:broadcasterId/products', authenticateToken, isAdmin, createCatalogProduct);
router.get('/catalog-broadcasters/:broadcasterId/products', authenticateToken, isAdmin, getCatalogProducts);
router.put('/catalog-products/:productId', authenticateToken, isAdmin, updateCatalogProduct);
router.delete('/catalog-products/:productId', authenticateToken, isAdmin, deleteCatalogProduct);

// ========================
// ROTAS DE OPEC (Comprovantes de Veiculação)
// ========================
router.get('/catalog-orders', authenticateToken, isAdmin, getCatalogOrders);
router.get('/orders/:orderId/opec', authenticateToken, isAdmin, getOrderOpecs);
router.post('/orders/:orderId/opec', authenticateToken, isAdmin, uploadOpecFile.single('opec'), uploadOpec);
router.delete('/orders/:orderId/opec/:opecId', authenticateToken, isAdmin, deleteOpec);

// ========================
// ROTAS DE GESTÃO DE USUÁRIOS
// ========================
router.get('/users', authenticateToken, isAdmin, getAllUsers);
router.get('/users/:userId', authenticateToken, isAdmin, getUserFullDetails);
router.put('/users/:userId/status', authenticateToken, isAdmin, auditLog('user.status_change', 'user'), updateUserStatus);
router.put('/users/:userId/role', authenticateToken, isAdmin, auditLog('user.role_change', 'user'), updateUserRole);
router.put('/users/:userId/reset-password', authenticateToken, isAdmin, auditLog('user.reset_password', 'user'), adminResetUserPassword);
router.delete('/users/:userId', authenticateToken, isAdmin, auditLog('user.delete', 'user'), deleteUser);

// ========================
// ROTAS DE RELATÓRIO DA DIRETORIA
// ========================
router.get('/directory-report', authenticateToken, isAdmin, getDirectoryReport);
router.get('/directory-report/spot-types', authenticateToken, isAdmin, getDirectoryReportSpotTypes);
router.put('/directory-report/:productId', authenticateToken, isAdmin, updateDirectoryReportRecord);

// ========================
// ROTAS DE MONITORAMENTO
// Query param: ?range=1h|24h|7d|30d (default: 24h)
// ========================
router.get('/monitoring/overview', authenticateToken, isAdmin, getOverview);
router.get('/monitoring/routes', authenticateToken, isAdmin, getRouteMetrics);
router.get('/monitoring/errors', authenticateToken, isAdmin, getErrors);
router.get('/monitoring/vitals', authenticateToken, isAdmin, getVitals);
router.get('/monitoring/slow', authenticateToken, isAdmin, getSlowRequests);
router.get('/monitoring/timeline', authenticateToken, isAdmin, getTimeline);

// ========================
// ROTAS DE AUDIT LOG
// ========================
router.get('/audit-logs', authenticateToken, isAdmin, async (req: AuthRequest, res: Response) => {
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
  } catch (error) {
    console.error('Erro ao buscar audit logs:', error);
    res.status(500).json({ error: 'Erro ao buscar audit logs' });
  }
});

export default router;
