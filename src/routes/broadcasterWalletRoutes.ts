import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getBroadcasterWallet,
  updateBroadcasterBankAccount,
  requestBroadcasterWithdraw,
  getBroadcasterWithdrawRequests
} from '../controllers/broadcasterWalletController';

const router = Router();

// Middleware para verificar se é emissora
const isBroadcaster = (req: any, res: any, next: any) => {
  if (req.user.userType !== 'broadcaster') {
    return res.status(403).json({ error: 'Acesso negado. Apenas emissoras.' });
  }
  next();
};

// ========================
// ROTAS DE WALLET DA EMISSORA
// ========================

// GET /api/broadcaster/wallet - Consulta wallet
router.get('/wallet', authenticateToken, isBroadcaster, getBroadcasterWallet);

// PUT /api/broadcaster/wallet/bank-account - Atualiza dados bancários
router.put('/wallet/bank-account', authenticateToken, isBroadcaster, updateBroadcasterBankAccount);

// POST /api/broadcaster/wallet/withdraw - Solicita saque
router.post('/wallet/withdraw', authenticateToken, isBroadcaster, requestBroadcasterWithdraw);

// GET /api/broadcaster/wallet/withdraw-requests - Lista solicitações
router.get('/wallet/withdraw-requests', authenticateToken, isBroadcaster, getBroadcasterWithdrawRequests);

export default router;
