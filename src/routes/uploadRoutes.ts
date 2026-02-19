import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { upload, uploadAudio, uploadScript, saveText } from '../controllers/uploadController';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Upload de áudio (MP3/WAV)
router.post('/audio', upload.single('audio'), uploadAudio);

// Upload de roteiro (PDF/DOC/DOCX/TXT)
router.post('/script', upload.single('script'), uploadScript);

// Salvar texto
router.post('/text', saveText);

export default router;
