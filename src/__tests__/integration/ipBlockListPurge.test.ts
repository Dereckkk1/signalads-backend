/**
 * Integration Tests — purgeLegacyAutoBlocks (DB real)
 *
 * O auto-block por IP foi descontinuado (gerava 403 em usuarios legitimos
 * atras de NAT/CGNAT). Esta funcao roda no startup e remove os blocks
 * automaticos legados, preservando os blocks manuais feitos por um admin.
 */

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import BlockedIP from '../../models/BlockedIP';
import { purgeLegacyAutoBlocks } from '../../utils/ipBlockList';

beforeAll(async () => {
  await connectTestDB();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

describe('purgeLegacyAutoBlocks (DB real)', () => {
  it('remove auto-blocks legados e preserva blocks manuais', async () => {
    await BlockedIP.create([
      { ip: '1.1.1.1', reason: 'Auto-bloqueado: bot', blockedAt: new Date(), blockedById: 'system', blockedByEmail: 'auto-block@sistema' },
      { ip: '2.2.2.2', reason: 'Auto-bloqueado: path suspeito', blockedAt: new Date(), blockedById: 'system', blockedByEmail: 'auto-block@sistema' },
      { ip: '3.3.3.3', reason: 'Bloqueado manualmente pelo admin', blockedAt: new Date(), blockedById: 'admin123', blockedByEmail: 'admin@eradios.com.br' },
    ]);

    const removed = await purgeLegacyAutoBlocks();

    expect(removed).toBe(2);

    const remaining = await BlockedIP.find().lean();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.ip).toBe('3.3.3.3');
    expect(remaining[0]!.blockedByEmail).toBe('admin@eradios.com.br');
  });

  it('retorna 0 quando nao ha auto-blocks (apenas manuais no banco)', async () => {
    await BlockedIP.create([
      { ip: '4.4.4.4', reason: 'Bloqueado manualmente', blockedAt: new Date(), blockedById: 'admin123', blockedByEmail: 'admin@eradios.com.br' },
    ]);

    const removed = await purgeLegacyAutoBlocks();

    expect(removed).toBe(0);
    const remaining = await BlockedIP.find().lean();
    expect(remaining).toHaveLength(1);
  });
});
