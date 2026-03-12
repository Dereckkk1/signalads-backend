import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '../middleware/auth';
import { createMessage, getMessages, getMessageById, countUnreadMessages, deleteMessage } from '../controllers/contactMessageController';

const router = Router();

// Rate limit para formulario de contato (previne spam)
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,                    // 5 mensagens por hora por IP
  message: 'Muitas mensagens enviadas. Tente novamente em 1 hora.',
});

// Publica com rate limit
router.post('/', contactLimiter, createMessage);

// Privadas (Admin)
router.get('/', authenticateToken, getMessages);
router.get('/unread-count', authenticateToken, countUnreadMessages);
router.get('/:id', authenticateToken, getMessageById);
router.delete('/:id', authenticateToken, deleteMessage);

export default router;
