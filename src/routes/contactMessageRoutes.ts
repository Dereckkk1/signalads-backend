import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { createMessage, getMessages, getMessageById, countUnreadMessages, deleteMessage } from '../controllers/contactMessageController';
import { createRedisStore } from '../config/rateLimitStore';

const router = Router();

// Rate limit para formulario de contato (previne spam — Redis store #7)
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,                    // 5 mensagens por hora por IP
  message: 'Muitas mensagens enviadas. Tente novamente em 1 hora.',
  store: createRedisStore('contact'),
});

// Publica com rate limit
router.post('/', contactLimiter, createMessage);

// Privadas (Admin) — defense-in-depth: requireAdmin no middleware + controller
router.get('/', authenticateToken, requireAdmin, getMessages);
router.get('/unread-count', authenticateToken, requireAdmin, countUnreadMessages);
router.get('/:id', authenticateToken, requireAdmin, getMessageById);
router.delete('/:id', authenticateToken, requireAdmin, deleteMessage);

export default router;
