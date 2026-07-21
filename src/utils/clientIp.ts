import { Request } from 'express';

/**
 * IP real do cliente — fonte unica de verdade para rate limiting, blocklist
 * e trilha de auditoria.
 *
 * ─── POR QUE NAO USAR `req.ip` DIRETO ────────────────────────────────
 *
 * `req.ip` depende de `app.set('trust proxy', N)` bater EXATAMENTE com o
 * numero de proxies na frente do Node. Se N for menor que o numero real, o
 * Express passa a confiar numa porcao do `X-Forwarded-For` que o CLIENTE
 * escreve — e ai basta mandar um IP aleatorio por tentativa para que:
 *   - o rate limit por IP nunca encha (brute force de login sem teto),
 *   - a blocklist de IP seja contornavel,
 *   - a auditoria registre o IP errado.
 *
 * Contar saltos e fragil: muda quando alguem poe/tira um proxy, e o erro e
 * silencioso. Aqui a estrategia e outra — usar um header que o CLIENTE NAO
 * consegue forjar.
 *
 * ─── TOPOLOGIA CONFIRMADA (2026-07-20) ───────────────────────────────
 *
 * O DNS de `api.eradios.com.br` esta PROXIADO pela Cloudflare (nuvem laranja).
 * Toda requisicao legitima passa por ela, e a Cloudflare SOBRESCREVE o header
 * `CF-Connecting-IP` com o IP real do cliente — um valor enviado pelo cliente
 * nesse header e descartado. Por isso ele e a fonte preferida, e vale
 * independentemente de existir ou nao um Nginx entre a Cloudflare e o Node.
 *
 * ─── ⚠️ PRE-REQUISITO DE INFRAESTRUTURA ──────────────────────────────
 *
 * Isto so e solido se o servidor de origem ACEITAR TRAFEGO APENAS DA
 * CLOUDFLARE. Se o IP da VM for alcancavel direto da internet, um atacante
 * que o descubra pula a Cloudflare e envia `CF-Connecting-IP` forjado — e
 * nenhuma estrategia baseada em header resolve isso.
 *
 * Acao necessaria: restringir o firewall da VM (regra de ingresso do GCP) as
 * faixas publicadas em https://www.cloudflare.com/ips/ nas portas 80/443.
 * Enquanto isso nao existir, a origem e contornavel — ver
 * `docs/DECISOES-E-PROXIMOS-PASSOS.md`.
 */
export const getClientIp = (req: Request): string => {
  // 1. Cloudflare: header sobrescrito na borda, nao forjavel por quem passa
  //    por ela. Presente em toda requisicao proxiada.
  // `?.` de proposito: esta funcao roda em middleware de metricas e de
  // blocklist, que precisam sobreviver a qualquer objeto de request — um
  // throw aqui derrubaria o pipeline inteiro por causa de telemetria.
  const cfConnectingIp = req.headers?.['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
    return cfConnectingIp.trim();
  }

  // 2. Sem Cloudflare (ex.: chamada interna, health check local, ambiente de
  //    teste): cai no que o Express resolveu a partir do trust proxy.
  if (req.ip) return req.ip;

  // 3. Ultimo recurso: o peer TCP direto. Nunca e forjavel, mas com proxy
  //    na frente aponta para o proxy, nao para o cliente.
  return req.socket?.remoteAddress || 'unknown';
};
