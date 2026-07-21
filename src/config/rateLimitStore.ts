import { createHash } from 'crypto';
import { RedisStore } from 'rate-limit-redis';
import { redis } from './redis';

/**
 * Cria um RedisStore para express-rate-limit.
 * Rate limits compartilhados entre workers PM2 e persistem entre restarts (#7).
 *
 * ─── COMPORTAMENTO EM FALHA DO REDIS ──────────────────────────────────
 *
 * SEGURANCA (item 4.1 do plano 2026-07-20 — severidade CRITICA):
 * ate 2026-07-20 este store devolvia `[1, 0]` sintetico em EVAL/EVALSHA,
 * ou seja "1 hit, longe do limite". Como TODOS os limiters usam este store
 * (login, 2FA, register, checkout, webhook), qualquer indisponibilidade do
 * Redis — queda, senha errada, saturacao provocada pelo proprio atacante —
 * desligava silenciosamente a protecao contra brute force do produto
 * inteiro. Nao havia alerta, e /api/health apenas marcava `degraded`.
 *
 * Hoje o store DEGRADA para contagem em memoria do processo, em vez de
 * falhar aberto. Nao e equivalente ao Redis:
 *   - o contador nao e compartilhado entre workers PM2 (o limite efetivo
 *     fica multiplicado pelo numero de workers);
 *   - zera a cada restart.
 * Mas continua limitando, que e o que importa quando a alternativa e nao
 * limitar nada. Preferiu-se isso a responder 503: derrubar o site inteiro
 * por causa do cache seria um modo de falha pior que o problema.
 *
 * SCRIPT LOAD continua com resposta sintetica de proposito: `rate-limit-redis`
 * valida `typeof result === 'string'` no construtor e uma excecao ali
 * derrubaria o processo no boot.
 */

/** Contadores em memoria usados apenas enquanto o Redis esta indisponivel. */
const degradedCounters = new Map<string, { hits: number; resetAt: number }>();

/** Janela assumida quando nao for possivel ler a do comando. */
const DEFAULT_WINDOW_MS = 60_000;

/** Evita crescimento ilimitado do Map em degradacao prolongada. */
const MAX_DEGRADED_KEYS = 50_000;

let degradedWarnedAt = 0;

function warnDegradedOnce(): void {
  const now = Date.now();
  // Um aviso por minuto no maximo — este caminho e quente sob carga.
  if (now - degradedWarnedAt > 60_000) {
    degradedWarnedAt = now;
    console.error(
      '[rateLimitStore] Redis indisponivel — rate limiting DEGRADADO para memoria do processo. ' +
        'Limites nao sao compartilhados entre workers. Investigar imediatamente.'
    );
  }
}

function pruneDegradedCounters(now: number): void {
  if (degradedCounters.size < MAX_DEGRADED_KEYS) return;
  for (const [key, entry] of degradedCounters) {
    if (entry.resetAt <= now) degradedCounters.delete(key);
  }
  // Se ainda estiver cheio (tudo dentro da janela), descarta o mais antigo.
  if (degradedCounters.size >= MAX_DEGRADED_KEYS) {
    const oldest = degradedCounters.keys().next().value;
    if (oldest !== undefined) degradedCounters.delete(oldest);
  }
}

/**
 * Incremento em memoria. Devolve o par [totalHits, msBeforeReset] que o
 * express-rate-limit espera do script Lua.
 */
function degradedIncrement(key: string, windowMs: number): [number, number] {
  const now = Date.now();
  pruneDegradedCounters(now);

  const current = degradedCounters.get(key);
  if (!current || current.resetAt <= now) {
    degradedCounters.set(key, { hits: 1, resetAt: now + windowMs });
    return [1, windowMs];
  }

  current.hits += 1;
  return [current.hits, Math.max(0, current.resetAt - now)];
}

const degradedReply = (args: string[]): unknown => {
  const cmd = args[0]?.toUpperCase();
  const sub = args[1]?.toUpperCase();

  // Necessario para o construtor do rate-limit-redis nao derrubar o boot.
  if (cmd === 'SCRIPT' && sub === 'LOAD') {
    return createHash('sha1').update(args[2] ?? '').digest('hex');
  }

  if (cmd === 'EVALSHA' || cmd === 'EVAL') {
    warnDegradedOnce();
    // Layout do comando: EVAL(SHA) <script|sha> <numKeys> <key...> <argv...>
    const numKeys = Number(args[2]) || 1;
    const key = args[3] ?? 'unknown';
    const windowMs = Number(args[3 + numKeys]) || DEFAULT_WINDOW_MS;
    return degradedIncrement(key, windowMs);
  }

  return 0;
};

export const createRedisStore = (prefix: string) =>
  new RedisStore({
    sendCommand: async (...args: string[]) => {
      try {
        return await (redis as any).call(...args);
      } catch {
        return degradedReply(args);
      }
    },
    prefix: `rl:${prefix}:`,
  });

/** Exposto para teste: limpa os contadores de degradacao. */
export const __resetDegradedCounters = (): void => {
  degradedCounters.clear();
  degradedWarnedAt = 0;
};
