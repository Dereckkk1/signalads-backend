import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { upload, uploadAudio, uploadScript, saveText, getStorageSignedUrl } from '../controllers/uploadController';
import { sanitizeMultipart } from '../middleware/security';
import { createRedisStore } from '../config/rateLimitStore';
import { getClientIp } from '../utils/clientIp';

const router = Router();

// Em ambiente de teste o rate limit fica inativo (varios testes disparam
// uploads em sequencia no mesmo usuario).
const isTest = process.env.NODE_ENV === 'test';

// SEGURANCA (item 4.6): as rotas de upload nao tinham limiter proprio —
// so o teto global de 200 req/min por IP. Combinado com `memoryStorage`,
// isso permitia empurrar gigabytes de heap por minuto a partir de um unico
// IP. Chaveia por usuario (authenticateToken ja rodou via router.use).
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('upload'),
  keyGenerator: (req) => {
    const userId = (req as AuthRequest).userId;
    return userId ? `user:${userId}` : ipKeyGenerator(getClientIp(req));
  },
  skip: () => isTest,
  message: { error: 'Muitos uploads. Aguarde um minuto.' },
});

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Upload de áudio (MP3/WAV)
router.post('/audio', uploadLimiter, upload.single('audio'), ...sanitizeMultipart, uploadAudio);

// Upload de roteiro (PDF/DOC/DOCX/TXT)
router.post('/script', uploadLimiter, upload.single('script'), ...sanitizeMultipart, uploadScript);

// Salvar texto
router.post('/text', saveText);

// Gera signed URL temporária para um objeto GCS privado.
// Frontend deve chamar este endpoint sempre que precisar exibir/baixar
// um arquivo armazenado (audio/script/logo/opec/etc).
// Query: ?objectKey=<url-ou-objectKey>  (URL completa do bucket também é aceita)
router.get('/signed-url', getStorageSignedUrl);

export default router;
