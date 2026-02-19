import express from 'express';
import { 
  emitInvoiceManually, 
  getInvoiceByOrder,
  cancelInvoice 
} from '../controllers/invoiceController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// POST /api/invoices/emit/:orderId - Emite NF manualmente (admin)
router.post('/emit/:orderId', emitInvoiceManually);

// GET /api/invoices/:orderId - Consulta NF de um pedido
router.get('/:orderId', getInvoiceByOrder);

// POST /api/invoices/cancel/:orderId - Cancela NF (admin)
router.post('/cancel/:orderId', cancelInvoice);

export default router;
