import { Router } from 'express';
import {
  getMyTimeSlots,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot
} from '../controllers/insertionTimeSlotController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, getMyTimeSlots);
router.post('/', authenticateToken, createTimeSlot);
router.put('/:id', authenticateToken, updateTimeSlot);
router.delete('/:id', authenticateToken, deleteTimeSlot);

export default router;
