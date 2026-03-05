import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
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
router.get('/count-pending', authenticateToken, countPendingProfileRequests);
router.get('/', authenticateToken, getAllProfileRequests);
router.post('/:id/approve', authenticateToken, approveProfileRequest);
router.post('/:id/reject', authenticateToken, rejectProfileRequest);

export default router;
