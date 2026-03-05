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
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Emissora
router.post('/', authenticateToken, createProductRequest);
router.get('/my-requests', authenticateToken, getMyRequests);

// Admin
router.get('/pending', authenticateToken, getPendingRequests);
router.get('/count-pending', authenticateToken, countPendingRequests);
router.get('/', authenticateToken, getAllRequests);
router.post('/:id/approve', authenticateToken, approveRequest);
router.post('/:id/reject', authenticateToken, rejectRequest);

export default router;
