import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 10) return null;
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Conectado com sucesso');
});

redis.on('reconnecting', (delay: number) => {
  console.warn(`[Redis] Reconectando em ${delay}ms...`);
});

redis.on('close', () => {
  console.warn('[Redis] Conexao fechada');
});

/**
 * Verifica se Redis esta conectado e respondendo.
 * Retorna status para uso no health check.
 */
export async function getRedisHealth(): Promise<{ status: string; latencyMs: number }> {
  try {
    const start = Date.now();
    await redis.ping();
    return { status: 'connected', latencyMs: Date.now() - start };
  } catch {
    return { status: 'disconnected', latencyMs: -1 };
  }
}

// Helper: get com parse JSON
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

// Helper: set com TTL em segundos
export async function cacheSet(key: string, data: any, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch {
    // silencioso — cache miss nao deve derrubar a app
  }
}

// Helper: invalidar por prefixo (ex: 'marketplace:*')
export async function cacheInvalidate(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // silencioso
  }
}
