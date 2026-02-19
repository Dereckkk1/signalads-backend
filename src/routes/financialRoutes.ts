import express from 'express';
import { 
  getAllTransactions, 
  getFinancialSummary,
  exportTransactions 
} from '../controllers/financialController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Todas as rotas requerem autenticação de admin
router.use(authenticateToken);

// GET /api/admin/financial/transactions - Lista todas as transações
router.get('/transactions', getAllTransactions);

// GET /api/admin/financial/summary - Resumo financeiro
router.get('/summary', getFinancialSummary);

// POST /api/admin/financial/export - Exporta transações em CSV
router.post('/export', exportTransactions);

export default router;
