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
  getTwoFactorStatus,
  refreshTokenHandler,
  logoutHandler
} from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Rate Limit para Auth — Anti Brute Force
// 25 tentativas por 15 minutos por IP (todas contam, inclusive sucesso)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  skipSuccessfulRequests: false,
  message: 'Muitas tentativas de autenticação deste IP, por favor tente novamente em 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
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

// Refresh token — rotaciona par access+refresh
router.post('/refresh', refreshTokenHandler);

// Logout — revoga tokens e limpa cookies
router.post('/logout', authenticateToken, logoutHandler);

export default router;
