import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth';
import { createRedisStore } from '../config/rateLimitStore';
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

// Rate limiters para endpoints publicos de proposta (Redis store #7)
const publicRespondLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: 'Muitas respostas. Tente novamente em 1 hora.', store: createRedisStore('proposal:respond') });
const publicCommentLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Muitos comentários. Tente novamente em 1 hora.', store: createRedisStore('proposal:comment') });
const publicPinLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: 'Muitas tentativas. Tente novamente em 1 minuto.', store: createRedisStore('proposal:pin') });
const publicExportLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: 'Muitas exportações. Tente novamente em 1 minuto.', store: createRedisStore('proposal:export') });
const publicViewLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Muitas requisições.', store: createRedisStore('proposal:view') });

// ─── Rotas Públicas (sem auth) ────────────────────────────────────────────
router.get('/public/:slug', publicViewLimiter, getPublicProposal);
router.post('/public/:slug/view', publicViewLimiter, trackProposalView);
router.post('/public/:slug/respond', publicRespondLimiter, respondToProposal);
router.post('/public/:slug/comments', publicCommentLimiter, addPublicComment);
router.post('/public/:slug/session', publicViewLimiter, trackViewSession);
router.post('/public/:slug/verify-pin', publicPinLimiter, verifyPin);
router.get('/public/:slug/export', publicExportLimiter, exportPublicProposalXlsx);

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
