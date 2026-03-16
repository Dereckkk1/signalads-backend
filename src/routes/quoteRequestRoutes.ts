import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import {
  createQuoteRequest,
  getMyQuoteRequests,
  getQuoteRequestDetails,
  getAllQuoteRequests,
  updateQuoteRequestStatus,
  updateAdminNotes,
  getQuoteRequestStats
} from '../controllers/quoteRequestController';

const router = express.Router();

/**
 * Rotas de Solicitações de Contato (Quote Requests)
 * Sistema simplificado sem pagamento - Cliente solicita, admin processa manualmente
 */

// ===================================
// ROTAS DO CLIENTE
// ===================================

/**
 * POST /api/quotes/create
 * Cria nova solicitação a partir do carrinho
 */
router.post('/create', authenticateToken, createQuoteRequest);

/**
 * GET /api/quotes/my-requests
 * Lista solicitações do cliente logado
 */
router.get('/my-requests', authenticateToken, getMyQuoteRequests);

/**
 * GET /api/quotes/:requestNumber
 * Detalhes de uma solicitação específica
 */
router.get('/:requestNumber', authenticateToken, getQuoteRequestDetails);

// ===================================
// ROTAS DO ADMIN
// ===================================

/**
 * GET /api/admin/quotes
 * Lista TODAS as solicitações (com filtros)
 */
router.get('/admin/all', authenticateToken, requireAdmin, getAllQuoteRequests);

/**
 * GET /api/admin/quotes/stats
 * Estatísticas para dashboard
 */
router.get('/admin/stats', authenticateToken, requireAdmin, getQuoteRequestStats);

/**
 * PATCH /api/admin/quotes/:requestNumber/status
 * Atualiza status da solicitação
 */
router.patch('/admin/:requestNumber/status', authenticateToken, requireAdmin, updateQuoteRequestStatus);

/**
 * PATCH /api/admin/quotes/:requestNumber/notes
 * Adiciona/atualiza notas internas
 */
router.patch('/admin/:requestNumber/notes', authenticateToken, requireAdmin, updateAdminNotes);

export default router;
