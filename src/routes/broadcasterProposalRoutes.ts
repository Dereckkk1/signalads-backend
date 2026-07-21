import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { sanitizeMultipart } from '../middleware/security';
import {
  createProposal,
  getProposals,
  getProposal,
  updateProposal,
  updateCustomization,
  deleteProposal,
  duplicateProposal,
  sendProposal,
  reopenProposal,
  uploadProposalImage,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  exportProposalXlsx,
  addComment,
  getVersions,
  restoreVersion,
  getAnalytics,
  setProtection,
  getMyProducts,
  getBroadcasterClients,
  createBroadcasterClient,
  updateBroadcasterClient,
  deleteBroadcasterClient,
  uploadBroadcasterClientLogo,
  getBroadcasterClientTypes,
  createBroadcasterClientType,
  updateBroadcasterClientType,
  deleteBroadcasterClientType,
  getBroadcasterClientOrigins,
  createBroadcasterClientOrigin,
  updateBroadcasterClientOrigin,
  deleteBroadcasterClientOrigin,
  getPaymentTags,
  createPaymentTag,
  deletePaymentTag,
  previewInstallments
} from '../controllers/broadcasterProposalController';

const router = express.Router();

// Multer para upload de imagens (logo/cover).
// SVG removido propositalmente: aceita <script>/onerror e seria servido via
// storage com Content-Type que browsers podem executar (XSS stored). (#46)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de imagem não suportado. Use JPEG, PNG ou WebP.'));
    }
  }
});

// Nota: Rotas públicas (/public/:slug) continuam no proposalRoutes.ts
// pois são compartilhadas entre agência e emissora (usam slug, sem auth)

// ─── Rotas Autenticadas (broadcaster only) ──────────────────────────────
router.use(authenticateToken);

// SEGURANCA (item 3.6 do plano 2026-07-20): ate entao as permissoes de
// sub-usuario para 'proposals' e 'clients' existiam APENAS no frontend
// (Header/index.js escondia o menu). Via API, um sub-usuario 'sales'
// restrito a outra area mantinha CRUD completo — incluindo EXCLUIR
// propostas de outros vendedores e ler a base de clientes com
// documentNumber. O menu sumia da tela; o endpoint continuava aberto.
//
// requirePermission e default-deny e ignora userType != 'broadcaster',
// entao aplicar no router nao afeta admin/agency.

// Produtos da emissora (para seleção ao criar proposta)
router.get('/my-products', requirePermission('products'), getMyProducts);

// Clientes da emissora
router.get('/clients', requirePermission('clients'), getBroadcasterClients);
router.post('/clients', requirePermission('clients'), createBroadcasterClient);
router.put('/clients/:id', requirePermission('clients'), updateBroadcasterClient);
router.delete('/clients/:id', requirePermission('clients'), deleteBroadcasterClient);
router.post('/clients/:id/logo', requirePermission('clients'), upload.single('file'), ...sanitizeMultipart, uploadBroadcasterClientLogo);

// Tipos de cliente da emissora
router.get('/client-types', requirePermission('clients'), getBroadcasterClientTypes);
router.post('/client-types', requirePermission('clients'), createBroadcasterClientType);
router.put('/client-types/:id', requirePermission('clients'), updateBroadcasterClientType);
router.delete('/client-types/:id', requirePermission('clients'), deleteBroadcasterClientType);

// Origens de cliente da emissora
router.get('/client-origins', requirePermission('clients'), getBroadcasterClientOrigins);
router.post('/client-origins', requirePermission('clients'), createBroadcasterClientOrigin);
router.put('/client-origins/:id', requirePermission('clients'), updateBroadcasterClientOrigin);
router.delete('/client-origins/:id', requirePermission('clients'), deleteBroadcasterClientOrigin);

// Analytics (antes de /:id para não conflitar)
router.get('/analytics', requirePermission('proposals'), getAnalytics);

// Tags de descricao de parcelas (contrato)
router.get('/payment-tags', requirePermission('proposals'), getPaymentTags);
router.post('/payment-tags', requirePermission('proposals'), createPaymentTag);
router.delete('/payment-tags/:id', requirePermission('proposals'), deletePaymentTag);

// Preview das parcelas do contrato (nao persiste)
router.post('/contract/preview-installments', requirePermission('proposals'), previewInstallments);

// Templates
router.route('/templates')
  .get(requirePermission('proposals'), getTemplates)
  .post(requirePermission('proposals'), createTemplate);

router.route('/templates/:id')
  .put(requirePermission('proposals'), updateTemplate)
  .delete(requirePermission('proposals'), deleteTemplate);

// Propostas — CRUD
router.route('/')
  .get(requirePermission('proposals'), getProposals)
  .post(requirePermission('proposals'), createProposal);

router.route('/:id')
  .get(requirePermission('proposals'), getProposal)
  .put(requirePermission('proposals'), updateProposal)
  .delete(requirePermission('proposals'), deleteProposal);

// Ações
router.post('/:id/duplicate', requirePermission('proposals'), duplicateProposal);
router.post('/:id/send', requirePermission('proposals'), sendProposal);
router.post('/:id/reopen', requirePermission('proposals'), reopenProposal);
router.put('/:id/customization', requirePermission('proposals'), updateCustomization);
router.post('/:id/upload', requirePermission('proposals'), upload.single('file'), ...sanitizeMultipart, uploadProposalImage);
router.get('/:id/export', requirePermission('proposals'), exportProposalXlsx);
router.post('/:id/comments', requirePermission('proposals'), addComment);
router.post('/:id/protection', requirePermission('proposals'), setProtection);

// Versionamento
router.get('/:id/versions', requirePermission('proposals'), getVersions);
router.post('/:id/versions/:versionId/restore', requirePermission('proposals'), restoreVersion);

export default router;
