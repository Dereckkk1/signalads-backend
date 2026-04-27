import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
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

// Produtos da emissora (para seleção ao criar proposta)
router.get('/my-products', getMyProducts);

// Clientes da emissora
router.get('/clients', getBroadcasterClients);
router.post('/clients', createBroadcasterClient);
router.put('/clients/:id', updateBroadcasterClient);
router.delete('/clients/:id', deleteBroadcasterClient);
router.post('/clients/:id/logo', upload.single('file'), uploadBroadcasterClientLogo);

// Tipos de cliente da emissora
router.get('/client-types', getBroadcasterClientTypes);
router.post('/client-types', createBroadcasterClientType);
router.put('/client-types/:id', updateBroadcasterClientType);
router.delete('/client-types/:id', deleteBroadcasterClientType);

// Origens de cliente da emissora
router.get('/client-origins', getBroadcasterClientOrigins);
router.post('/client-origins', createBroadcasterClientOrigin);
router.put('/client-origins/:id', updateBroadcasterClientOrigin);
router.delete('/client-origins/:id', deleteBroadcasterClientOrigin);

// Analytics (antes de /:id para não conflitar)
router.get('/analytics', getAnalytics);

// Tags de descricao de parcelas (contrato)
router.get('/payment-tags', getPaymentTags);
router.post('/payment-tags', createPaymentTag);
router.delete('/payment-tags/:id', deletePaymentTag);

// Preview das parcelas do contrato (nao persiste)
router.post('/contract/preview-installments', previewInstallments);

// Templates
router.route('/templates')
  .get(getTemplates)
  .post(createTemplate);

router.route('/templates/:id')
  .put(updateTemplate)
  .delete(deleteTemplate);

// Propostas — CRUD
router.route('/')
  .get(getProposals)
  .post(createProposal);

router.route('/:id')
  .get(getProposal)
  .put(updateProposal)
  .delete(deleteProposal);

// Ações
router.post('/:id/duplicate', duplicateProposal);
router.post('/:id/send', sendProposal);
router.post('/:id/reopen', reopenProposal);
router.put('/:id/customization', updateCustomization);
router.post('/:id/upload', upload.single('file'), uploadProposalImage);
router.get('/:id/export', exportProposalXlsx);
router.post('/:id/comments', addComment);
router.post('/:id/protection', setProtection);

// Versionamento
router.get('/:id/versions', getVersions);
router.post('/:id/versions/:versionId/restore', restoreVersion);

export default router;
