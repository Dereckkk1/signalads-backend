import express from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  listCombos,
  createCombo,
  updateCombo,
  deleteCombo
} from '../controllers/broadcasterComboController';

const router = express.Router();

router.use(authenticateToken);

router.route('/')
  .get(listCombos)
  .post(createCombo);

router.route('/:id')
  .put(updateCombo)
  .delete(deleteCombo);

export default router;
