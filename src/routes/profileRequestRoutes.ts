import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import {
    createProfileRequest,
    getMyProfileRequests,
    getAllProfileRequests,
    approveProfileRequest,
    rejectProfileRequest,
    countPendingProfileRequests
} from '../controllers/profileRequestController';

const router = Router();

// Rotas para as Emissoras (Broadcasters)
router.post('/', authenticateToken, createProfileRequest);
router.get('/my-requests', authenticateToken, getMyProfileRequests);

// Rotas para o Administrador
router.get('/count-pending', authenticateToken, requireAdmin, countPendingProfileRequests);
router.get('/', authenticateToken, requireAdmin, getAllProfileRequests);
router.post('/:id/approve', authenticateToken, requireAdmin, approveProfileRequest);
router.post('/:id/reject', authenticateToken, requireAdmin, rejectProfileRequest);

export default router;
