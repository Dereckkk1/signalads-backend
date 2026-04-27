import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { upload, uploadAudio, uploadScript, saveText, getStorageSignedUrl } from '../controllers/uploadController';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Upload de áudio (MP3/WAV)
router.post('/audio', upload.single('audio'), uploadAudio);

// Upload de roteiro (PDF/DOC/DOCX/TXT)
router.post('/script', upload.single('script'), uploadScript);

// Salvar texto
router.post('/text', saveText);

// Gera signed URL temporária para um objeto GCS privado.
// Frontend deve chamar este endpoint sempre que precisar exibir/baixar
// um arquivo armazenado (audio/script/logo/opec/etc).
// Query: ?objectKey=<url-ou-objectKey>  (URL completa do bucket também é aceita)
router.get('/signed-url', getStorageSignedUrl);

export default router;
