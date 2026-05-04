import { createHash } from 'crypto';
import { RedisStore } from 'rate-limit-redis';
import { redis } from './redis';

/**
 * Cria um RedisStore para express-rate-limit.
 * Rate limits compartilhados entre workers PM2 e persistem entre restarts (#7).
 *
 * Quando Redis esta indisponivel, sendCommand retorna respostas sinteticas
 * com tipos validos para evitar que rate-limit-redis derrube o processo
 * (ele valida `typeof result === 'string'` em SCRIPT LOAD e crasharia com
 * unhandled rejection no construtor). Quando Redis volta, o EVALSHA falha
 * com NOSCRIPT e a logica `retryableIncrement` recarrega o script real.
 */
const syntheticReply = (args: string[]): unknown => {
  const cmd = args[0]?.toUpperCase();
  const sub = args[1]?.toUpperCase();
  if (cmd === 'SCRIPT' && sub === 'LOAD') {
    return createHash('sha1').update(args[2] ?? '').digest('hex');
  }
  if (cmd === 'EVALSHA' || cmd === 'EVAL') {
    // [totalHits, msBeforeReset]. express-rate-limit valida totalHits >= 1,
    // entao retornamos 1 (longe do limite) em vez de 0.
    return [1, 0];
  }
  return 0;
};

export const createRedisStore = (prefix: string) =>
  new RedisStore({
    sendCommand: async (...args: string[]) => {
      try {
        return await (redis as any).call(...args);
      } catch {
        return syntheticReply(args);
      }
    },
    prefix: `rl:${prefix}:`,
  });
