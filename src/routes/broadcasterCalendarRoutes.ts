import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getCalendarEvents } from '../controllers/broadcasterCalendarController';

const router = Router();

router.use(authenticateToken);

router.get('/calendar', getCalendarEvents);

export default router;
