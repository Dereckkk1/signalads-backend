import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
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

// Rotas para Emissoras (Broadcaster) — exigem permissao 'campaigns' para sub-users
router.get('/broadcaster-orders', authenticateToken, requirePermission('campaigns'), getBroadcasterOrders);
router.get('/pending-approval', authenticateToken, requirePermission('campaigns'), getPendingApprovalOrders);
router.post('/:orderId/approve-broadcaster', authenticateToken, requirePermission('campaigns'), approveBroadcasterItems);
router.post('/:orderId/reject-broadcaster', authenticateToken, requirePermission('campaigns'), rejectBroadcasterItems);

// Rota compartilhada (comprador ou emissora) — middleware nao restringe nao-broadcasters
router.get('/:orderId', authenticateToken, getCampaignDetails);

export default router;
