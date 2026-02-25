import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  confirmEmail,
  login,
  getMe,
  updateProfile,
  changePassword,
  enableTwoFactor,
  confirmTwoFactorEnable,
  disableTwoFactor,
  validateTwoFactorLogin,
  verifyTwoFactorCode,
  getTwoFactorStatus
} from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Rate Limit específico para Auth (Login/Register/2FA) - Previne Brute Force
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // Limite de 5 tentativas por hora
  message: 'Muitas tentativas de login/registro deste IP, por favor tente novamente em uma hora.',
});

router.post('/register', authLimiter, register);
router.get('/confirm-email/:token', confirmEmail);
router.post('/login', authLimiter, login);
router.get('/me', authenticateToken, getMe);
router.put('/update-profile', authenticateToken, updateProfile);
router.put('/change-password', authenticateToken, changePassword);

// Rotas de autenticação em duas etapas (2FA)
router.post('/2fa/enable', authenticateToken, enableTwoFactor);
router.get('/2fa/confirm/:token', confirmTwoFactorEnable);
router.post('/2fa/disable', authenticateToken, disableTwoFactor);
router.post('/2fa/validate', authLimiter, validateTwoFactorLogin); // Antigo (link do email)
router.post('/2fa/verify-code', authLimiter, verifyTwoFactorCode); // Novo (código 6 dígitos)
router.get('/2fa/status', authenticateToken, getTwoFactorStatus);

export default router;
