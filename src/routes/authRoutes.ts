import { Router, Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
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
  logoutHandler,
  updateCompletedTours
} from '../controllers/authController';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import { createRedisStore } from '../config/rateLimitStore';

const router = Router();

// ─────────────────────────────────────────────────────────────
// Rate limiters POR ROTA (prefixos Redis distintos)
//
// Antes: um unico authLimiter compartilhava 25/15min entre login,
// register, forgot-password, reset-password e 2FA verify. Atacante
// queimava login bruteforce e tambem bloqueava 2FA verify do mesmo IP.
//
// Agora cada rota tem prefixo Redis proprio + key generator dedicado.
// ─────────────────────────────────────────────────────────────

// Helper: extrai email/cnpj do body para chave composta (IP + alvo)
const getEmailKey = (req: Request): string => {
  const raw = (req.body?.emailOrCnpj || req.body?.email || '').toString().trim().toLowerCase();
  return raw || 'no-email';
};

// Helper: chave segura por IP (IPv6-aware via ipKeyGenerator do express-rate-limit v8)
const ipKey = (req: Request): string => ipKeyGenerator(req.ip || 'unknown');

// Login: 10/15min por (IP + emailOrCnpj). Usuario CGNAT pode logar
// na sua propria conta sem ser afetado por outro atacante mirando outra conta.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('login'),
  keyGenerator: (req) => `${ipKey(req)}|${getEmailKey(req)}`,
});

// Register: 5/15min por IP — registros sao raros, brute force nao faz sentido.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de cadastro. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('register'),
  keyGenerator: (req) => ipKey(req),
});

// Forgot password POR EMAIL: 3/hora — limita email bombing direto na vitima.
const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Voce pediu redefinicao demais vezes. Aguarde 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('forgotPassEmail'),
  keyGenerator: (req) => getEmailKey(req),
});

// Forgot password POR IP: 10/hora — backup para o caso de email vazio/invalido.
const forgotPasswordIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas requisicoes deste IP. Tente novamente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('forgotPassIp'),
  keyGenerator: (req) => ipKey(req),
});

// Reset password (com token): 10/15min por IP — token na URL ja eh chave de unicidade.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de redefinir senha. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('resetPass'),
  keyGenerator: (req) => ipKey(req),
});

// 2FA verify: 10/15min por session token (do body) — chave por sessao individual,
// nao por IP (CGNAT-friendly). Cada sessao 2FA so tem 10 chances totais via rate limit
// alem do limite ja existente de 5 tentativas no banco (whichever hits first).
const twoFactorVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de verificacao 2FA. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('2faVerify'),
  keyGenerator: (req) => {
    const sessionToken = (req.body?.sessionToken || req.body?.userId || '').toString();
    return sessionToken ? `session:${sessionToken}` : `ip:${ipKey(req)}`;
  },
});

// Rate limit dedicado para refresh (#58) — 30 req/min por IP
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Muitas tentativas de refresh. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('refresh'),
});

router.post('/register', registerLimiter, register);
router.get('/confirm-email/:token', confirmEmail);
router.post('/login', loginLimiter, auditLog('auth.login', 'user', { allowAnonymous: true }), login);
router.get('/me', authenticateToken, getMe);
router.put('/update-profile', authenticateToken, updateProfile);
router.put('/change-password', authenticateToken, changePassword);
router.patch('/completed-tours', authenticateToken, updateCompletedTours);

// Recuperação de senha (público) — limiter por email + por IP encadeados
router.post('/forgot-password', forgotPasswordIpLimiter, forgotPasswordEmailLimiter, auditLog('auth.password_reset_request', 'user', { allowAnonymous: true }), forgotPassword);
router.post('/reset-password/:token', resetPasswordLimiter, auditLog('auth.password_reset', 'user', { allowAnonymous: true }), resetPassword);

// Rotas de autenticação em duas etapas (2FA)
router.post('/2fa/enable', authenticateToken, enableTwoFactor);
router.get('/2fa/confirm/:token', confirmTwoFactorEnable);
router.post('/2fa/disable', authenticateToken, disableTwoFactor);
router.post('/2fa/verify-code', twoFactorVerifyLimiter, auditLog('auth.2fa_verify', 'user', { allowAnonymous: true }), verifyTwoFactorCode);
router.get('/2fa/status', authenticateToken, getTwoFactorStatus);

// Refresh token — rotaciona par access+refresh (rate limit dedicado #58)
router.post('/refresh', refreshLimiter, refreshTokenHandler);

// Logout — semi-publico: funciona mesmo com token expirado (#51)
router.post('/logout', optionalAuthenticateToken, logoutHandler);

export default router;
