import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getSummary,
  getBreakdown,
  getGoalsReport,
} from '../controllers/broadcasterReportsController';

const router = Router();

router.use(authenticateToken);

router.get('/reports/summary', getSummary);
router.get('/reports/breakdown', getBreakdown);
router.get('/reports/goals', getGoalsReport);

export default router;
