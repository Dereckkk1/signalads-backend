import { Router } from 'express';
import { generatePlan } from '../controllers/recommendationController';

const router = Router();

// POST /api/recommendations/plan
router.post('/plan', generatePlan);

export default router;
