import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getMyCampaigns,
  getPendingApprovalOrders,
  getBroadcasterOrders,
  approveBroadcasterItems,
  rejectBroadcasterItems,
  getCampaignDetails
} from '../controllers/campaignController';

const router = Router();

// Rotas para Compradores (Advertiser/Agency)
router.get('/my-campaigns', authenticateToken, getMyCampaigns);

// Rotas para Emissoras (Broadcaster)
router.get('/broadcaster-orders', authenticateToken, getBroadcasterOrders);
router.get('/pending-approval', authenticateToken, getPendingApprovalOrders);
router.post('/:orderId/approve-broadcaster', authenticateToken, approveBroadcasterItems);
router.post('/:orderId/reject-broadcaster', authenticateToken, rejectBroadcasterItems);

// Rota compartilhada (comprador ou emissora)
router.get('/:orderId', authenticateToken, getCampaignDetails);

export default router;
