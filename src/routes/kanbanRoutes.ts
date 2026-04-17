import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getBoard,
  createColumn,
  updateColumn,
  deleteColumn,
  updateColumnOrder,
  setPlacement,
} from '../controllers/kanbanController';

const router = Router();

router.use(authenticateToken);

router.get('/:context/board', getBoard);
router.post('/:context/columns', createColumn);
router.patch('/:context/columns/:columnId', updateColumn);
router.delete('/:context/columns/:columnId', deleteColumn);
router.put('/:context/column-order', updateColumnOrder);
router.put('/:context/placements', setPlacement);

export default router;
