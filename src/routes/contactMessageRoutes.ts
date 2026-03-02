import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { createMessage, getMessages, getMessageById, countUnreadMessages, deleteMessage } from '../controllers/contactMessageController';

const router = Router();

// Pública
router.post('/', createMessage);

// Privadas (Admin)
router.get('/', authenticateToken, getMessages);
router.get('/unread-count', authenticateToken, countUnreadMessages);
router.get('/:id', authenticateToken, getMessageById);
router.delete('/:id', authenticateToken, deleteMessage);

export default router;
