import { RedisStore } from 'rate-limit-redis';
import { redis } from './redis';

/**
 * Cria um RedisStore para express-rate-limit.
 * Rate limits compartilhados entre workers PM2 e persistem entre restarts (#7).
 */
export const createRedisStore = (prefix: string) =>
  new RedisStore({
    sendCommand: async (...args: string[]) => {
      try {
        return await (redis as any).call(...args);
      } catch {
        // Graceful degradation: se Redis indisponivel, permite request
        return null;
      }
    },
    prefix: `rl:${prefix}:`,
  });
