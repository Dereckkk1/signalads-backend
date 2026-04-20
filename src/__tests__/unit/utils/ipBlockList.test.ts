/**
 * Unit tests — ipBlockList
 * Cobre: loadBlockedIPs, blockedIPsSet
 */

// Mock do modelo BlockedIP antes de qualquer import do app
jest.mock('../../../models/BlockedIP');

import BlockedIP from '../../../models/BlockedIP';
import { loadBlockedIPs, blockedIPsSet } from '../../../utils/ipBlockList';

const mockedBlockedIP = BlockedIP as jest.Mocked<typeof BlockedIP>;

beforeEach(() => {
  blockedIPsSet.clear();
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// blockedIPsSet — comportamento do Set
// ═══════════════════════════════════════════════════════════════
describe('blockedIPsSet', () => {
  it('inicia vazio', () => {
    expect(blockedIPsSet.size).toBe(0);
  });

  it('aceita adicao manual de IP', () => {
    blockedIPsSet.add('192.168.1.1');
    expect(blockedIPsSet.has('192.168.1.1')).toBe(true);
  });

  it('nao duplica IPs repetidos (comportamento Set)', () => {
    blockedIPsSet.add('10.0.0.1');
    blockedIPsSet.add('10.0.0.1');
    blockedIPsSet.add('10.0.0.1');
    expect(blockedIPsSet.size).toBe(1);
  });

  it('remove IP corretamente', () => {
    blockedIPsSet.add('172.16.0.1');
    blockedIPsSet.delete('172.16.0.1');
    expect(blockedIPsSet.has('172.16.0.1')).toBe(false);
  });

  it('delete de IP inexistente nao lanca erro', () => {
    expect(() => blockedIPsSet.delete('1.2.3.4')).not.toThrow();
  });

  it('suporta multiplos IPs independentes', () => {
    blockedIPsSet.add('1.1.1.1');
    blockedIPsSet.add('2.2.2.2');
    blockedIPsSet.add('3.3.3.3');
    expect(blockedIPsSet.size).toBe(3);
    expect(blockedIPsSet.has('1.1.1.1')).toBe(true);
    expect(blockedIPsSet.has('2.2.2.2')).toBe(true);
    expect(blockedIPsSet.has('3.3.3.3')).toBe(true);
  });

  it('has retorna false para IP nao adicionado', () => {
    expect(blockedIPsSet.has('99.99.99.99')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// loadBlockedIPs
// ═══════════════════════════════════════════════════════════════
describe('loadBlockedIPs', () => {
  it('popula o Set com IPs vindos do banco', async () => {
    mockedBlockedIP.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { ip: '10.0.0.1' },
          { ip: '10.0.0.2' },
          { ip: '10.0.0.3' },
        ]),
      }),
    }) as any;

    await loadBlockedIPs();

    expect(blockedIPsSet.has('10.0.0.1')).toBe(true);
    expect(blockedIPsSet.has('10.0.0.2')).toBe(true);
    expect(blockedIPsSet.has('10.0.0.3')).toBe(true);
    expect(blockedIPsSet.size).toBe(3);
  });

  it('nao lanca erro quando banco retorna lista vazia', async () => {
    mockedBlockedIP.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    }) as any;

    await expect(loadBlockedIPs()).resolves.toBeUndefined();
    expect(blockedIPsSet.size).toBe(0);
  });

  it('nao duplica IPs ja presentes no Set', async () => {
    blockedIPsSet.add('192.168.1.1');

    mockedBlockedIP.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { ip: '192.168.1.1' }, // duplicado
          { ip: '192.168.1.2' },
        ]),
      }),
    }) as any;

    await loadBlockedIPs();

    expect(blockedIPsSet.size).toBe(2);
    expect(blockedIPsSet.has('192.168.1.1')).toBe(true);
    expect(blockedIPsSet.has('192.168.1.2')).toBe(true);
  });

  it('nao lanca erro quando o banco falha (captura silenciosamente)', async () => {
    mockedBlockedIP.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('MongoDB timeout')),
      }),
    }) as any;

    await expect(loadBlockedIPs()).resolves.toBeUndefined();
    expect(blockedIPsSet.size).toBe(0);
  });

  it('acumulacao: segunda chamada adiciona novos IPs sem limpar os anteriores', async () => {
    mockedBlockedIP.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn()
          .mockResolvedValueOnce([{ ip: '5.5.5.5' }])
          .mockResolvedValueOnce([{ ip: '6.6.6.6' }]),
      }),
    }) as any;

    await loadBlockedIPs();
    await loadBlockedIPs();

    expect(blockedIPsSet.has('5.5.5.5')).toBe(true);
    expect(blockedIPsSet.has('6.6.6.6')).toBe(true);
  });
});
