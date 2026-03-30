import { Request, Response, NextFunction } from 'express';

/**
 * Middleware de Cache-Control para habilitar cache no browser e CDN (Cloudflare).
 *
 * Tipos:
 * - 'public'  → GET endpoints publicos (marketplace, cities, comparador, mapa).
 *               Browser cacheia por maxAge, CDN por sMaxAge.
 * - 'private' → GET endpoints autenticados (perfil, campanhas, pedidos).
 *               Apenas browser cacheia, CDN nao.
 * - 'none'    → Mutations (POST/PUT/DELETE) e endpoints sensiveis.
 *               Nenhum cache.
 *
 * Seguranca: endpoints privados NUNCA recebem Cache-Control public.
 * Mutations NUNCA sao cacheadas.
 */
export function setCacheHeaders(
  type: 'public' | 'private' | 'none',
  maxAge: number = 30,
  sMaxAge?: number
) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    switch (type) {
      case 'public':
        res.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${sMaxAge ?? maxAge * 2}`);
        break;
      case 'private':
        res.set('Cache-Control', `private, max-age=${maxAge}, must-revalidate`);
        break;
      case 'none':
        res.set('Cache-Control', 'no-store');
        break;
    }
    next();
  };
}
