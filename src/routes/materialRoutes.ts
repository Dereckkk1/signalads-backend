import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import {
  sendMessage,
  uploadBroadcasterProduction,
  broadcasterRejectMaterial,
  broadcasterApproveMaterial,
  clientApproveMaterial,
  clientRejectMaterial,
  getChatHistory
} from '../controllers/materialController';

const router = express.Router();

// Configuração do Multer para upload de áudios
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'audio/mpeg' || file.mimetype === 'audio/wav') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .mp3 e .wav são permitidos'));
    }
  }
});

// Buscar histórico do chat
router.get('/:orderId/item/:itemIndex/chat', authenticateToken, getChatHistory);

// Enviar mensagem no chat
router.post('/:orderId/item/:itemIndex/message', authenticateToken, sendMessage);

// Emissora: Upload de produção própria
router.post(
  '/:orderId/item/:itemIndex/production',
  authenticateToken,
  upload.single('audio'),
  uploadBroadcasterProduction
);

// Emissora: Rejeitar material do cliente
router.post('/:orderId/item/:itemIndex/broadcaster/reject', authenticateToken, broadcasterRejectMaterial);

// Emissora: Aprovar material do cliente (áudio já pronto)
router.post('/:orderId/item/:itemIndex/broadcaster/approve', authenticateToken, broadcasterApproveMaterial);

// Cliente: Aprovar produção da emissora
router.post('/:orderId/item/:itemIndex/client/approve', authenticateToken, clientApproveMaterial);

// Cliente: Rejeitar produção da emissora
router.post('/:orderId/item/:itemIndex/client/reject', authenticateToken, clientRejectMaterial);

export default router;
