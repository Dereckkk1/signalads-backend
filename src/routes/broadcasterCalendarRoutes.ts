import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { getCalendarEvents } from '../controllers/broadcasterCalendarController';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('calendar'));

router.get('/calendar', getCalendarEvents);

export default router;
