import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import {
  getConversations,
  getOrCreateConversation,
  sendMessage,
  markAsRead,
  getMessages
} from '../controllers/chatController';

const router = express.Router();

// Configurar Multer para upload de anexos (áudio, imagem, documento)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'audio/mpeg',
      'audio/wav',
      'audio/mp3',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido'));
    }
  }
});

// Listar todas as conversas do usuário
router.get('/conversations', authenticateToken, getConversations);

// Buscar ou criar conversa com outro usuário
router.get('/conversations/:otherPartyId', authenticateToken, getOrCreateConversation);

// Enviar mensagem (com ou sem anexo)
router.post('/conversations/:conversationId/messages', authenticateToken, upload.single('attachment'), sendMessage);

// Marcar mensagens como lidas
router.put('/conversations/:conversationId/read', authenticateToken, markAsRead);

// Obter histórico de mensagens
router.get('/conversations/:conversationId/messages', authenticateToken, getMessages);

export default router;
