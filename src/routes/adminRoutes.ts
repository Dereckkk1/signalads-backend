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
router.put('/broadcasters/:broadcasterId/approve', authenticateToken, isAdmin, approveBroadcaster);
router.put('/broadcasters/:broadcasterId/reject', authenticateToken, isAdmin, rejectBroadcaster);

// ========================
// ROTAS DE PEDIDOS (gestão completa)
// ========================
router.get('/orders/full', authenticateToken, isAdmin, getFullOrdersForAdmin);
router.post('/orders/:orderId/approve', authenticateToken, isAdmin, adminApproveOrder);
router.put('/orders/:orderId/status', authenticateToken, isAdmin, updateOrderStatus);
router.post('/orders/:orderId/items/:itemIndex/upload-recording-audio', authenticateToken, isAdmin, uploadAudio.single('audio'), adminUploadRecordingAudio);
router.delete('/orders/:orderId/items/:itemIndex/recording-audio', authenticateToken, isAdmin, adminDeleteRecordingAudio);

// ========================
// ROTAS DA WALLET DA PLATAFORMA
// ========================
router.get('/platform-wallet', authenticateToken, isAdmin, getPlatformWallet);
router.put('/platform-wallet/bank-account', authenticateToken, isAdmin, updatePlatformBankAccount);
router.post('/platform-wallet/withdraw', authenticateToken, isAdmin, requestPlatformWithdraw);
router.post('/platform-wallet/confirm-withdraw', authenticateToken, isAdmin, confirmPlatformWithdraw);
router.get('/platform-wallet/check-transfers', authenticateToken, isAdmin, checkPendingTransfers);

// ========================
// ROTAS DE SOLICITAÇÕES DE SAQUE (Emissoras/Agências)
// ========================
router.get('/withdraw-requests', authenticateToken, isAdmin, getPendingWithdrawRequests);
router.post('/withdraw-requests/:walletId/:transactionId/process', authenticateToken, isAdmin, processWithdrawRequest);
router.post('/withdraw-requests/:walletId/:transactionId/reject', authenticateToken, isAdmin, rejectWithdrawRequest);

// ========================
// ROTAS DE EMISSORAS CATÁLOGO (novas)
// ========================
// CRUD de emissoras catálogo
router.post('/catalog-broadcasters', authenticateToken, isAdmin, createCatalogBroadcaster);
router.get('/catalog-broadcasters', authenticateToken, isAdmin, getCatalogBroadcasters);
router.get('/catalog-broadcasters/:id', authenticateToken, isAdmin, getCatalogBroadcasterById);
router.put('/catalog-broadcasters/:id', authenticateToken, isAdmin, updateCatalogBroadcaster);
router.delete('/catalog-broadcasters/:id', authenticateToken, isAdmin, deleteCatalogBroadcaster);
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
router.put('/users/:userId/status', authenticateToken, isAdmin, updateUserStatus);
router.put('/users/:userId/role', authenticateToken, isAdmin, updateUserRole);
router.put('/users/:userId/reset-password', authenticateToken, isAdmin, adminResetUserPassword);
router.delete('/users/:userId', authenticateToken, isAdmin, deleteUser);

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

export default router;
