import express from 'express';
import {
  getWallet,
  getTransactions,
  addCredits,
  requestWithdraw,
  updateBankAccount,
  getBalance,
  rechargeWallet
} from '../controllers/walletController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

/**
 * Rotas de Wallet (Carteira Virtual)
 */

// GET /api/wallet - Obter informações da wallet
router.get('/', authenticateToken, getWallet);

// GET /api/wallet/balance - Obter apenas saldo (rápido)
router.get('/balance', authenticateToken, getBalance);

// GET /api/wallet/transactions - Histórico de transações
router.get('/transactions', authenticateToken, getTransactions);

// POST /api/wallet/add-credits - Adicionar créditos (admin ou recarga manual)
router.post('/add-credits', authenticateToken, addCredits);

// POST /api/wallet/recharge - Recarga via Asaas (PIX ou Cartão)
router.post('/recharge', authenticateToken, rechargeWallet);

// POST /api/wallet/withdraw - Solicitar saque
router.post('/withdraw', authenticateToken, requestWithdraw);

// PUT /api/wallet/bank-account - Atualizar dados bancários
router.put('/bank-account', authenticateToken, updateBankAccount);

export default router;