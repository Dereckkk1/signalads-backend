import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup
} from '../controllers/broadcasterGroupController';

const router = Router();

router.use(authenticateToken);

router.get('/groups', listGroups);
router.post('/groups', createGroup);
router.put('/groups/:id', updateGroup);
router.delete('/groups/:id', deleteGroup);

export default router;
