import { Router } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import * as billingController from '../controllers/billingController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Rotas para CLIENTES visualizarem suas NFs
/**
 * GET /api/billing/my-invoices
 * Cliente visualiza NFs emitidas pela plataforma
 */
router.get('/my-invoices', authenticateToken, billingController.getMyInvoices);

// Rotas para EMISSORAS enviarem suas NFs
/**
 * POST /api/billing/broadcaster/upload-invoice/:orderId
 * Emissora faz upload da NF que emitiu CONTRA a plataforma
 * Body: multipart/form-data { description?, file }
 */
router.post('/broadcaster/upload-invoice/:orderId', authenticateToken, upload.single('file'), billingController.uploadBroadcasterInvoice);

/**
 * GET /api/billing/broadcaster/my-invoices
 * Lista NFs que a emissora enviou (seus próprios pedidos)
 */
router.get('/broadcaster/my-invoices', authenticateToken, billingController.getBroadcasterInvoices);

// Todas as rotas ADMIN exigem autenticação de admin
// TODO: Adicionar middleware para verificar se user.userType === 'admin'

/**
 * GET /api/admin/billing/pending
 * Lista pedidos "A Faturar" aguardando validação
 */
router.get('/pending', authenticateToken, billingController.getPendingBillingOrders);

/**
 * GET /api/admin/billing/awaiting-payment
 * Lista pedidos "A Faturar" aguardando pagamento do cliente
 */
router.get('/awaiting-payment', authenticateToken, billingController.getAwaitingPayment);

/**
 * POST /api/admin/billing/:orderId/approve
 * Aprova pedido "A Faturar"
 */
router.post('/:orderId/approve', authenticateToken, billingController.approveBillingOrder);

/**
 * POST /api/admin/billing/:orderId/reject
 * Recusa pedido "A Faturar"
 * Body: { reason: string }
 */
router.post('/:orderId/reject', authenticateToken, billingController.rejectBillingOrder);

/**
 * POST /api/admin/billing/:orderId/mark-client-paid
 * Marca NF do cliente como paga e credita wallets
 * Body: { paidAt?: string }
 */
router.post('/:orderId/mark-client-paid', authenticateToken, billingController.markClientInvoiceAsPaid);

/**
 * POST /api/admin/billing/:orderId/upload-document
 * Upload de documento de faturamento (NF, comprovante, boleto)
 * Body: multipart/form-data { type, description, file }
 */
router.post('/:orderId/upload-document', authenticateToken, upload.single('file'), billingController.uploadBillingDocument);

/**
 * POST /api/admin/billing/:orderId/documents/:documentId/approve
 * Aprova documento de faturamento
 */
router.post('/:orderId/documents/:documentId/approve', authenticateToken, billingController.approveBillingDocument);

/**
 * POST /api/admin/billing/:orderId/documents/:documentId/reject
 * Recusa documento de faturamento
 * Body: { reason: string }
 */
router.post('/:orderId/documents/:documentId/reject', authenticateToken, billingController.rejectBillingDocument);

/**
 * GET /api/admin/billing/receivables
 * Lista faturas a receber (clientes)
 */
router.get('/receivables', authenticateToken, billingController.getAccountsReceivable);

/**
 * GET /api/admin/billing/payables
 * Lista faturas a pagar (emissoras)
 */
router.get('/payables', authenticateToken, billingController.getAccountsPayable);

export default router;
