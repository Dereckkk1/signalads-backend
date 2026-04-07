import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  confirmEmail,
  login,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  enableTwoFactor,
  confirmTwoFactorEnable,
  disableTwoFactor,
  verifyTwoFactorCode,
  getTwoFactorStatus,
  refreshTokenHandler,
  logoutHandler
} from '../controllers/authController';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth';
import { createRedisStore } from '../config/rateLimitStore';

const router = Router();

// Rate Limit para Auth — Anti Brute Force (Redis store #7)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  skipSuccessfulRequests: false,
  message: 'Muitas tentativas de autenticação deste IP, por favor tente novamente em 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('auth'),
});

// Rate limit dedicado para refresh (#58) — 30 req/min por IP
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Muitas tentativas de refresh. Tente novamente em 1 minuto.',
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('refresh'),
});

router.post('/register', authLimiter, register);
router.get('/confirm-email/:token', confirmEmail);
router.post('/login', authLimiter, login);
router.get('/me', authenticateToken, getMe);
router.put('/update-profile', authenticateToken, updateProfile);
router.put('/change-password', authenticateToken, changePassword);

// Recuperação de senha (público)
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password/:token', authLimiter, resetPassword);

// Rotas de autenticação em duas etapas (2FA)
router.post('/2fa/enable', authenticateToken, enableTwoFactor);
router.get('/2fa/confirm/:token', confirmTwoFactorEnable);
router.post('/2fa/disable', authenticateToken, disableTwoFactor);
router.post('/2fa/verify-code', authLimiter, verifyTwoFactorCode);
router.get('/2fa/status', authenticateToken, getTwoFactorStatus);

// Refresh token — rotaciona par access+refresh (rate limit dedicado #58)
router.post('/refresh', refreshLimiter, refreshTokenHandler);

// Logout — semi-publico: funciona mesmo com token expirado (#51)
router.post('/logout', optionalAuthenticateToken, logoutHandler);

export default router;
