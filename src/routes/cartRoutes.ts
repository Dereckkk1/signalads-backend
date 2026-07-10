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
  syncCart,
  repeatOrder,
  updateSponsorshipMonth,
  updateSponsorshipMaterial
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

// Atualizar mês de patrocínio
router.put('/items/sponsorship-month', updateSponsorshipMonth);

// Atualizar material de patrocínio (por tipo de inserção)
router.put('/items/sponsorship-material', updateSponsorshipMaterial);

// Remover item do carrinho
router.delete('/items/:productId', removeItem);

// Limpar carrinho
router.delete('/', clearCart);

// Sincronizar carrinho completo
router.post('/sync', syncCart);

// Repetir campanha: reconstrói itens de um pedido concluído no carrinho
router.post('/repeat/:orderId', repeatOrder);

export default router;
