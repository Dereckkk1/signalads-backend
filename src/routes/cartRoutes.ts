import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getCart,
  addItem,
  updateItemQuantity,
  updateItemSchedule,
  updateItemMaterial,
  removeItem,
  clearCart,
  syncCart
} from '../controllers/cartController';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authenticateToken);

// Obter carrinho do usuário
router.get('/', getCart);

// Adicionar item ao carrinho
router.post('/items', addItem);

// Atualizar quantidade de item
router.put('/items/quantity', updateItemQuantity);

// Atualizar agendamento de item
router.put('/items/schedule', updateItemSchedule);

// Atualizar material de item
router.put('/items/material', updateItemMaterial);

// Remover item do carrinho
router.delete('/items/:productId', removeItem);

// Limpar carrinho
router.delete('/', clearCart);

// Sincronizar carrinho completo
router.post('/sync', syncCart);

export default router;
