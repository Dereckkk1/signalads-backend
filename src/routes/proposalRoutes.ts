import express from 'express';
import multer from 'multer';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth';
import {
  createProposal,
  getProposals,
  getProposal,
  updateProposal,
  updateCustomization,
  deleteProposal,
  duplicateProposal,
  sendProposal,
  uploadProposalImage,
  getPublicProposal,
  trackProposalView,
  respondToProposal,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  // Novos endpoints
  convertToOrder,
  exportProposalXlsx,
  exportPublicProposalXlsx,
  addComment,
  addPublicComment,
  getVersions,
  restoreVersion,
  getAnalytics,
  trackViewSession,
  setProtection,
  verifyPin
} from '../controllers/proposalController';

const router = express.Router();

// Multer para upload de imagens (logo/cover)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de imagem não suportado. Use JPEG, PNG, WebP ou SVG.'));
    }
  }
});

// ─── Rotas Públicas (sem auth) ────────────────────────────────────────────
router.get('/public/:slug', getPublicProposal);
router.post('/public/:slug/view', trackProposalView);
router.post('/public/:slug/respond', respondToProposal);
router.post('/public/:slug/comments', addPublicComment);
router.post('/public/:slug/session', trackViewSession);
router.post('/public/:slug/verify-pin', verifyPin);
router.get('/public/:slug/export', exportPublicProposalXlsx);

// ─── Rotas Autenticadas (agency only) ─────────────────────────────────────
router.use(authenticateToken);

// Analytics (antes de /:id para não conflitar)
router.get('/analytics', getAnalytics);

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
router.put('/:id/customization', updateCustomization);
router.post('/:id/upload', upload.single('file'), uploadProposalImage);
router.post('/:id/convert', convertToOrder);
router.get('/:id/export', exportProposalXlsx);
router.post('/:id/comments', addComment);
router.post('/:id/protection', setProtection);

// Versionamento
router.get('/:id/versions', getVersions);
router.post('/:id/versions/:versionId/restore', restoreVersion);

export default router;
