import { Router } from 'express';
import {
  createProductRequest,
  getMyRequests,
  getAllRequests,
  getPendingRequests,
  approveRequest,
  rejectRequest,
  countPendingRequests
} from '../controllers/productRequestController';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

// Emissora
router.post('/', authenticateToken, createProductRequest);
router.get('/my-requests', authenticateToken, getMyRequests);

// Admin
router.get('/pending', authenticateToken, requireAdmin, getPendingRequests);
router.get('/count-pending', authenticateToken, requireAdmin, countPendingRequests);
router.get('/', authenticateToken, requireAdmin, getAllRequests);
router.post('/:id/approve', authenticateToken, requireAdmin, approveRequest);
router.post('/:id/reject', authenticateToken, requireAdmin, rejectRequest);

export default router;
