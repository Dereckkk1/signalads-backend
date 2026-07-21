import { Request } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Extrai o userId do cookie de acesso para uso como CHAVE de rate limit.
 *
 * SEGURANCA: a verificacao de assinatura aqui e obrigatoria, nao opcional.
 * Com jwt.decode() (sem verify) qualquer atacante anonimo monta um token
 * nao assinado com { userId: <vitima> }, dispara requests ate esgotar o
 * balde `user:<vitima>` e a conta real passa a receber 429 em todas as
 * rotas — negacao de servico direcionada por conta, de custo trivial.
 * ObjectIds de usuario circulam em respostas do marketplace, entao
 * descobrir o alvo e trivial.
 *
 * Token ausente/invalido/expirado => null => o request e coberto apenas
 * pelo limiter por IP.
 */
export const getUserIdFromToken = (req: Request): string | null => {
  try {
    const token = (req as any).cookies?.access_token;
    if (!token) return null;

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return null;

    const decoded = jwt.verify(token, jwtSecret, {
      algorithms: ['HS256'],
    }) as { userId?: string } | null;

    return decoded?.userId || null;
  } catch {
    return null;
  }
};
