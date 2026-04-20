import BlockedIP from '../models/BlockedIP';

export const blockedIPsSet = new Set<string>();

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
