import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Wallet from '../models/Wallet';
import { User } from '../models/User';
import asaasService from '../services/asaasService';

/**
 * Controller de Wallet (Carteira Virtual)
 * Gerencia saldo, transações, saques e recargas
 */

/**
 * GET /api/wallet
 * Retorna saldo e informações da wallet do usuário
 */
export const getWallet = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    let wallet = await Wallet.findOne({ userId });

    // Cria wallet se não existir
    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        balance: 0,
        blockedBalance: 0,
        totalEarned: 0,
        totalSpent: 0,
        transactions: []
      });
    }

    res.status(200).json({ wallet });

  } catch (error: any) {
    console.error('❌ Erro ao buscar wallet:', error);
    res.status(500).json({ message: 'Erro ao buscar carteira' });
  }
};

/**
 * GET /api/wallet/transactions
 * Retorna histórico de transações
 */
export const getTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    const { limit = 50, page = 1, type } = req.query;

    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      return res.status(404).json({ message: 'Carteira não encontrada' });
    }

    // Filtra por tipo se especificado
    let transactions = wallet.transactions;
    if (type && (type === 'credit' || type === 'debit')) {
      transactions = transactions.filter(t => t.type === type);
    }

    // Ordena por data (mais recente primeiro)
    transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Paginação
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    res.status(200).json({
      transactions: paginatedTransactions,
      pagination: {
        total: transactions.length,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(transactions.length / Number(limit))
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar transações:', error);
    res.status(500).json({ message: 'Erro ao buscar transações' });
  }
};

/**
 * POST /api/wallet/add-credits
 * Adiciona créditos manualmente (admin ou recarga)
 */
export const addCredits = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      return res.status(404).json({ message: 'Carteira não encontrada' });
    }

    await wallet.addCredit(amount, description || 'Recarga de créditos');


    res.status(200).json({
      message: 'Créditos adicionados com sucesso',
      wallet
    });

  } catch (error: any) {
    console.error('❌ Erro ao adicionar créditos:', error);
    res.status(500).json({ message: 'Erro ao adicionar créditos' });
  }
};

/**
 * POST /api/wallet/withdraw
 * Solicita saque (apenas para emissoras e agências)
 */
export const requestWithdraw = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    const { amount } = req.body;

    // Verifica se usuário é emissora ou agência
    const user = await User.findById(userId);
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'agency')) {
      return res.status(403).json({
        message: 'Apenas emissoras e agências podem solicitar saques'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      return res.status(404).json({ message: 'Carteira não encontrada' });
    }

    // Verifica saldo disponível (mínimo R$ 10 para saque)
    if (wallet.balance < amount) {
      return res.status(400).json({ message: 'Saldo insuficiente' });
    }

    if (amount < 10) {
      return res.status(400).json({ message: 'Valor mínimo para saque: R$ 10,00' });
    }

    // Verifica se tem conta bancária cadastrada
    if (!wallet.bankAccount) {
      return res.status(400).json({
        message: 'Cadastre seus dados bancários antes de solicitar saque'
      });
    }

    // Bloqueia o valor
    await wallet.blockAmount(amount);

    // TODO: Criar registro de solicitação de saque
    // TODO: Integrar com Asaas para transferência bancária


    res.status(200).json({
      message: 'Solicitação de saque enviada com sucesso. Será processada em até 2 dias úteis.',
      wallet
    });

  } catch (error: any) {
    console.error('❌ Erro ao solicitar saque:', error);
    res.status(500).json({
      message: error.message || 'Erro ao solicitar saque'
    });
  }
};

/**
 * PUT /api/wallet/bank-account
 * Atualiza dados bancários para saque
 */
export const updateBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    const {
      bankCode,
      bankName,
      agency,
      agencyDigit,
      account,
      accountDigit,
      accountType, // 'checking' | 'savings'
      holderName,
      holderDocument
    } = req.body;

    // Validações
    if (!bankCode || !agency || !account || !accountDigit || !accountType || !holderName || !holderDocument) {
      return res.status(400).json({ message: 'Dados bancários incompletos' });
    }

    if (accountType !== 'checking' && accountType !== 'savings') {
      return res.status(400).json({ message: 'Tipo de conta inválido' });
    }

    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      return res.status(404).json({ message: 'Carteira não encontrada' });
    }

    wallet.bankAccount = {
      bankCode,
      bankName,
      agency,
      agencyDigit,
      account,
      accountDigit,
      accountType,
      holderName,
      holderDocument: holderDocument.replace(/\D/g, '')
    };

    await wallet.save();


    res.status(200).json({
      message: 'Dados bancários atualizados com sucesso',
      wallet
    });

  } catch (error: any) {
    console.error('❌ Erro ao atualizar dados bancários:', error);
    res.status(500).json({ message: 'Erro ao atualizar dados bancários' });
  }
};

/**
 * GET /api/wallet/balance
 * Retorna apenas o saldo (endpoint rápido)
 */
export const getBalance = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    const wallet = await Wallet.findOne({ userId }).select('balance blockedBalance');

    if (!wallet) {
      return res.status(200).json({ balance: 0, blockedBalance: 0 });
    }

    res.status(200).json({
      balance: wallet.balance,
      blockedBalance: wallet.blockedBalance,
      available: wallet.balance - wallet.blockedBalance
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar saldo:', error);
    res.status(500).json({ message: 'Erro ao buscar saldo' });
  }
};

/**
 * POST /api/wallet/recharge
 * Recarga de créditos via Asaas (PIX ou Cartão de Crédito)
 */
export const rechargeWallet = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    const { method, amount, cardData } = req.body;

    // Validações
    if (!method || !amount) {
      return res.status(400).json({ message: 'Método e valor são obrigatórios' });
    }

    if (amount < 10) {
      return res.status(400).json({ message: 'Valor mínimo de recarga: R$ 10,00' });
    }

    if (method !== 'pix' && method !== 'credit_card') {
      return res.status(400).json({ message: 'Método de pagamento inválido' });
    }

    // Busca usuário
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Busca ou cria wallet
    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        balance: 0,
        blockedBalance: 0,
        totalEarned: 0,
        totalSpent: 0,
        transactions: []
      });
    }


    // Determina CPF/CNPJ do usuário
    const cpfCnpj = user.cpfOrCnpj || user.cpf || user.cnpj || '';

    if (!cpfCnpj) {
      console.error(`❌ Usuário ${user.email} não possui CPF/CNPJ cadastrado`);
      return res.status(400).json({
        message: 'CPF/CNPJ não encontrado. Complete seu cadastro antes de fazer recargas.'
      });
    }


    // Cria/busca cliente no Asaas
    const asaasCustomer = await asaasService.createOrUpdateCustomer({
      name: user.name || 'Usuário',
      email: user.email,
      phone: user.phone || '00000000000',
      cpfCnpj: cpfCnpj,
      externalReference: userId
    });

    let paymentResponse: any;

    // Processa pagamento conforme método
    if (method === 'pix') {
      // Cria pagamento PIX (já retorna QR Code)
      const today = new Date().toISOString().split('T')[0] as string;

      paymentResponse = await asaasService.createPixPayment({
        customer: asaasCustomer.id,
        value: amount,
        dueDate: today,
        description: `Recarga de créditos - Wallet`,
        externalReference: `wallet_recharge_${userId}_${Date.now()}`
      });




      // Retorna QR Code para frontend
      return res.status(200).json({
        method: 'pix',
        paymentId: paymentResponse.id,
        qrCode: paymentResponse.pixQrCode,
        qrCodePayload: paymentResponse.pixCopyPaste,
        expiresAt: paymentResponse.expirationDate,
        amount,
        status: 'pending',
        message: 'QR Code PIX gerado com sucesso'
      });

    } else if (method === 'credit_card') {
      // Valida dados do cartão
      if (!cardData || !cardData.number || !cardData.holderName ||
        !cardData.expiryDate || !cardData.ccv) {
        return res.status(400).json({
          message: 'Dados do cartão incompletos'
        });
      }

      // Separa mês e ano da validade
      const [expiryMonth, expiryYear] = cardData.expiryDate.split('/');
      const today = new Date().toISOString().split('T')[0] as string;

      // Cria pagamento com cartão
      paymentResponse = await asaasService.createCreditCardPayment({
        customer: asaasCustomer.id,
        billingType: 'CREDIT_CARD',
        value: amount,
        dueDate: today,
        description: `Recarga de créditos - Wallet`,
        externalReference: `wallet_recharge_${userId}_${Date.now()}`,
        creditCard: {
          holderName: cardData.holderName,
          number: cardData.number.replace(/\s/g, ''),
          expiryMonth,
          expiryYear: `20${expiryYear}`,
          ccv: cardData.ccv
        },
        creditCardHolderInfo: {
          name: user.name || 'Usuário',
          email: user.email,
          cpfCnpj: user.cpf || user.cnpj || '',
          postalCode: '00000000',
          addressNumber: '0',
          phone: user.phone || '0000000000'
        }
      });


      // Se pagamento foi confirmado, credita wallet imediatamente
      if (paymentResponse.status === 'CONFIRMED' || paymentResponse.status === 'RECEIVED') {
        await wallet.addCredit(
          amount,
          `Recarga via Cartão de Crédito - ${paymentResponse.id}`
        );



        return res.status(200).json({
          method: 'credit_card',
          paymentId: paymentResponse.id,
          status: 'confirmed',
          amount,
          newBalance: wallet.balance,
          message: 'Recarga realizada com sucesso!'
        });
      }

      // Se não confirmado, retorna status pendente
      return res.status(200).json({
        method: 'credit_card',
        paymentId: paymentResponse.id,
        status: paymentResponse.status,
        amount,
        message: 'Pagamento processado, aguardando confirmação'
      });
    }

  } catch (error: any) {
    console.error('❌ Erro ao processar recarga:', error);
    res.status(500).json({
      message: error.message || 'Erro ao processar recarga'
    });
  }
};
