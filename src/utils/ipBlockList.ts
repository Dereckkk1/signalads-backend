import BlockedIP from '../models/BlockedIP';

export const blockedIPsSet = new Set<string>();

// Email "sintetico" usado pelos antigos bloqueadores automaticos de IP.
// O auto-block por IP foi descontinuado (gerava 403 em usuarios legitimos
// atras de NAT/CGNAT/proxy). Blocks manuais usam o email real do admin.
const AUTO_BLOCK_EMAIL = 'auto-block@sistema';

/**
 * Remove os bloqueios automaticos de IP legados persistidos no banco.
 * Roda uma vez no startup, antes de carregar a blocklist em memoria, para
 * liberar usuarios que foram auto-bloqueados indevidamente. Idempotente:
 * apos a desativacao do auto-block, nao ha mais entradas para remover.
 * Preserva bloqueios manuais (blockedByEmail != auto-block@sistema).
 */
export async function purgeLegacyAutoBlocks(): Promise<number> {
  try {
    const result = await BlockedIP.deleteMany({ blockedByEmail: AUTO_BLOCK_EMAIL });
    const removed = result.deletedCount ?? 0;
    if (removed > 0) {
      console.log(`[ipBlockList] ${removed} IP(s) auto-bloqueado(s) removido(s) — auto-block descontinuado.`);
    }
    return removed;
  } catch (err) {
    console.warn('[ipBlockList] Falha ao remover auto-blocks legados:', (err as Error).message);
    return 0;
  }
}

export async function loadBlockedIPs(): Promise<void> {
  try {
    const blocked = await BlockedIP.find().select('ip').lean();
    blocked.forEach((b) => blockedIPsSet.add(b.ip));
    if (blocked.length > 0) {
      console.log(`[ipBlockList] ${blocked.length} IPs bloqueados carregados.`);
    }
  } catch (err) {
    console.warn('[ipBlockList] Falha ao carregar IPs bloqueados:', (err as Error).message);
  }
}
