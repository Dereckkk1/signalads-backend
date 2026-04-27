import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listGoals,
  getGoalsAnalytics,
  createGoal,
  updateGoal,
  deleteGoal,
} from '../controllers/broadcasterGoalsController';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('goals'));

router.get('/goals', listGoals);
router.get('/goals/analytics', getGoalsAnalytics);
router.post('/goals', createGoal);
router.put('/goals/:id', updateGoal);
router.delete('/goals/:id', deleteGoal);

export default router;
