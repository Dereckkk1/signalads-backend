import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listCombos,
  createCombo,
  updateCombo,
  deleteCombo
} from '../controllers/broadcasterComboController';

const router = express.Router();

router.use(authenticateToken);

// Combos sao bundles de produtos/patrocinios — usam permissao 'products'
router.route('/')
  .get(listCombos)
  .post(requirePermission('products'), createCombo);

router.route('/:id')
  .put(requirePermission('products'), updateCombo)
  .delete(requirePermission('products'), deleteCombo);

export default router;
