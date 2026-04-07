/**
 * Mock in-memory do Redis (ioredis) para testes.
 * Todas as operacoes sao no-op ou usam um Map local.
 * Nenhuma conexao real e aberta.
 */

const store = new Map<string, { value: string; expiresAt: number | null }>();

const mockRedisInstance = {
    status: 'ready' as string,

    // ── Core commands ──────────────────────────────────────────
    async get(key: string): Promise<string | null> {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            store.delete(key);
            return null;
        }
        return entry.value;
    },

    async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
        let expiresAt: number | null = null;
        // Handle SET key value EX seconds
        if (args[0] === 'EX' && typeof args[1] === 'number') {
            expiresAt = Date.now() + args[1] * 1000;
        }
        store.set(key, { value, expiresAt });
        return 'OK';
    },

    async del(...keys: string[]): Promise<number> {
        let deleted = 0;
        for (const key of keys) {
            if (store.delete(key)) deleted++;
        }
        return deleted;
    },

    async ping(): Promise<string> {
        return 'PONG';
    },

    async scan(cursor: string, ..._args: any[]): Promise<[string, string[]]> {
        // Return empty — scan is used for cache invalidation, no-op in tests
        return ['0', []];
    },

    async keys(_pattern: string): Promise<string[]> {
        return Array.from(store.keys());
    },

    async flushall(): Promise<'OK'> {
        store.clear();
        return 'OK';
    },

    async quit(): Promise<'OK'> {
        return 'OK';
    },

    async disconnect(): Promise<void> {
        // no-op
    },

    // ── Event emitter stubs ────────────────────────────────────
    on(_event: string, _handler: (...args: any[]) => void) {
        return mockRedisInstance;
    },

    once(_event: string, _handler: (...args: any[]) => void) {
        return mockRedisInstance;
    },

    off(_event: string, _handler: (...args: any[]) => void) {
        return mockRedisInstance;
    },

    removeListener(_event: string, _handler: (...args: any[]) => void) {
        return mockRedisInstance;
    },

    // ── Utility ────────────────────────────────────────────────
    _clear() {
        store.clear();
    },
};

/**
 * Cria uma nova instancia mock do Redis.
 * Usada pelo moduleNameMapper para substituir ioredis.
 */
class MockRedis {
    status = 'ready';
    get = mockRedisInstance.get;
    set = mockRedisInstance.set;
    del = mockRedisInstance.del;
    ping = mockRedisInstance.ping;
    scan = mockRedisInstance.scan;
    keys = mockRedisInstance.keys;
    flushall = mockRedisInstance.flushall;
    quit = mockRedisInstance.quit;
    disconnect = mockRedisInstance.disconnect;
    on = mockRedisInstance.on;
    once = mockRedisInstance.once;
    off = mockRedisInstance.off;
    removeListener = mockRedisInstance.removeListener;
    _clear = mockRedisInstance._clear;

    constructor(_url?: string, _options?: any) {
        // Constructor accepts same args as ioredis but does nothing
    }
}

export default MockRedis;
export { mockRedisInstance, store as mockRedisStore };
