import { Request, Response } from 'express';
import BlockedDomain from '../models/BlockedDomain';
import { AuthRequest } from '../middleware/auth';
import { FREE_EMAIL_DOMAINS, getEmailDomain, isFreeEmailDomain } from '../utils/freeEmailDomains';

/**
 * Lista todos os domínios bloqueados pelo admin
 */
export const getBlockedDomains = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const domains = await BlockedDomain.find()
      .sort({ createdAt: -1 })
      .populate('createdBy', 'email companyName');

    res.json({ domains });
  } catch (error) {

    res.status(500).json({ error: 'Erro ao buscar domínios bloqueados' });
  }
};

/**
 * Retorna a lista padrão hardcoded de domínios gratuitos
 */
export const getDefaultDomains = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ domains: FREE_EMAIL_DOMAINS });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar domínios padrão' });
  }
};

/**
 * Adiciona um domínio à blacklist
 */
export const addBlockedDomain = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { domain, reason } = req.body;

    if (!domain) {
      res.status(400).json({ error: 'Domínio é obrigatório' });
      return;
    }

    const cleanDomain = domain.toLowerCase().trim();

    // Verificar se já está na lista hardcoded
    if (FREE_EMAIL_DOMAINS.includes(cleanDomain)) {
      res.status(400).json({ error: 'Este domínio já está bloqueado na lista padrão do sistema' });
      return;
    }

    // Verificar se já existe no banco
    const existing = await BlockedDomain.findOne({ domain: cleanDomain });
    if (existing) {
      res.status(400).json({ error: 'Este domínio já está na blacklist' });
      return;
    }

    const blocked = new BlockedDomain({
      domain: cleanDomain,
      reason,
      createdBy: req.user!._id,
    });

    await blocked.save();

    res.status(201).json({ message: 'Domínio adicionado à blacklist', domain: blocked });
  } catch (error) {

    res.status(500).json({ error: 'Erro ao adicionar domínio à blacklist' });
  }
};

/**
 * Remove um domínio da blacklist
 */
export const removeBlockedDomain = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const domain = await BlockedDomain.findByIdAndDelete(id);
    if (!domain) {
      res.status(404).json({ error: 'Domínio não encontrado' });
      return;
    }

    res.json({ message: 'Domínio removido da blacklist' });
  } catch (error) {

    res.status(500).json({ error: 'Erro ao remover domínio da blacklist' });
  }
};

/**
 * Verifica se um email é bloqueado (endpoint público para frontend)
 */
export const checkEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email é obrigatório' });
      return;
    }

    const domain = getEmailDomain(email);

    // Verificar lista hardcoded
    if (isFreeEmailDomain(email)) {
      res.json({ blocked: true });
      return;
    }

    // Verificar lista customizada do admin — nao expor reason (#28)
    const blockedDomain = await BlockedDomain.findOne({ domain });
    if (blockedDomain) {
      res.json({ blocked: true });
      return;
    }

    res.json({ blocked: false });
  } catch (error) {

    res.status(500).json({ error: 'Erro ao verificar email' });
  }
};
