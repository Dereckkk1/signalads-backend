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
  getMyProducts
} from '../controllers/broadcasterProposalController';

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

// Nota: Rotas públicas (/public/:slug) continuam no proposalRoutes.ts
// pois são compartilhadas entre agência e emissora (usam slug, sem auth)

// ─── Rotas Autenticadas (broadcaster only) ──────────────────────────────
router.use(authenticateToken);

// Produtos da emissora (para seleção ao criar proposta)
router.get('/my-products', getMyProducts);

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
router.get('/:id/export', exportProposalXlsx);
router.post('/:id/comments', addComment);
router.post('/:id/protection', setProtection);

// Versionamento
router.get('/:id/versions', getVersions);
router.post('/:id/versions/:versionId/restore', restoreVersion);

export default router;
