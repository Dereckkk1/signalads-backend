/**
 * Unit tests — checkSuspiciousPath middleware
 * Cobre: bloqueio na primeira tentativa, persistencia no DB, isencao de localhost.
 */

jest.mock('../../../models/BlockedIP');

import { Request, Response, NextFunction } from 'express';
import BlockedIP from '../../../models/BlockedIP';
import { blockedIPsSet } from '../../../utils/ipBlockList';
import { checkSuspiciousPath } from '../../../middleware/suspiciousPath';

const mockedBlockedIP = BlockedIP as jest.Mocked<typeof BlockedIP>;

function makeReq(path: string, ip: string): Partial<Request> {
  return {
    path,
    method: 'GET',
    ip,
    socket: { remoteAddress: ip } as any,
  };
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  blockedIPsSet.clear();
  jest.clearAllMocks();
  // Default mock — findOneAndUpdate retorna sucesso
  mockedBlockedIP.findOneAndUpdate = jest.fn().mockResolvedValue({}) as any;
  // Silencia console.log do middleware nos testes
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('checkSuspiciousPath — paths legitimos', () => {
  it('chama next() para path legitimo', () => {
    const req = makeReq('/api/auth/login', '1.2.3.4') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    checkSuspiciousPath(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(blockedIPsSet.size).toBe(0);
  });

  it('chama next() para GET / (raiz)', () => {
    const req = makeReq('/', '1.2.3.4') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    checkSuspiciousPath(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('checkSuspiciousPath — paths suspeitos', () => {
  it('bloqueia IP na primeira tentativa de /.env', () => {
    const req = makeReq('/.env', '1.2.3.4') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    checkSuspiciousPath(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(blockedIPsSet.has('1.2.3.4')).toBe(true);
    expect(mockedBlockedIP.findOneAndUpdate).toHaveBeenCalledWith(
      { ip: '1.2.3.4' },
      expect.objectContaining({
        ip: '1.2.3.4',
        reason: expect.stringContaining('/.env'),
        blockedById: 'system',
      }),
      { upsert: true }
    );
  });

  it('bloqueia tentativa de /wordpress/.env', () => {
    const req = makeReq('/wordpress/.env', '5.6.7.8') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    checkSuspiciousPath(req, res, next);

    expect(blockedIPsSet.has('5.6.7.8')).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('bloqueia tentativa de /wp-admin', () => {
    const req = makeReq('/wp-admin', '9.10.11.12') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    checkSuspiciousPath(req, res, next);

    expect(blockedIPsSet.has('9.10.11.12')).toBe(true);
  });

  it('bloqueia tentativa de /.git/config', () => {
    const req = makeReq('/.git/config', '13.14.15.16') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    checkSuspiciousPath(req, res, next);

    expect(blockedIPsSet.has('13.14.15.16')).toBe(true);
  });

  it('retorna 404 (nao 403) para nao revelar bloqueio', () => {
    const req = makeReq('/.env', '1.2.3.4') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    checkSuspiciousPath(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('nao chama findOneAndUpdate se IP ja esta bloqueado', () => {
    blockedIPsSet.add('1.2.3.4');

    const req = makeReq('/.env', '1.2.3.4') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    checkSuspiciousPath(req, res, next);

    expect(mockedBlockedIP.findOneAndUpdate).not.toHaveBeenCalled();
    // Mas ainda devolve 404
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('nao quebra se persistencia no DB falhar', () => {
    mockedBlockedIP.findOneAndUpdate = jest
      .fn()
      .mockRejectedValue(new Error('DB down')) as any;

    const req = makeReq('/.env', '1.2.3.4') as Request;
    const res = makeRes() as Response;
    const next: NextFunction = jest.fn();

    expect(() => checkSuspiciousPath(req, res, next)).not.toThrow();
    // IP ja foi adicionado em memoria
    expect(blockedIPsSet.has('1.2.3.4')).toBe(true);
  });
});

describe('checkSuspiciousPath — localhost isento de bloqueio', () => {
  const localhostIps = ['::1', '127.0.0.1', '::ffff:127.0.0.1'];

  localhostIps.forEach((ip) => {
    it(`nao bloqueia IP de localhost: ${ip}`, () => {
      const req = makeReq('/.env', ip) as Request;
      const res = makeRes() as Response;
      const next: NextFunction = jest.fn();

      checkSuspiciousPath(req, res, next);

      // Devolve 404 mas nao adiciona ao Set nem persiste
      expect(res.status).toHaveBeenCalledWith(404);
      expect(blockedIPsSet.has(ip)).toBe(false);
      expect(mockedBlockedIP.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
