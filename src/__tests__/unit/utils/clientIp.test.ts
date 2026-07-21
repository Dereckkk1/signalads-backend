/**
 * Unit Tests — getClientIp (item 10.1 do plano de seguranca 2026-07-20)
 *
 * `api.eradios.com.br` esta proxiado pela Cloudflare (confirmado no painel DNS
 * em 2026-07-20). `CF-Connecting-IP` e sobrescrito na borda, entao um valor
 * enviado pelo cliente nesse header e descartado antes de chegar aqui.
 *
 * O que estes testes garantem: a resolucao do IP nao depende de acertar o
 * numero de saltos em `trust proxy` — errar aquele numero tornava `req.ip`
 * spoofavel e derrubava rate limit, blocklist e auditoria de uma vez.
 */

import { Request } from 'express';
import { getClientIp } from '../../../utils/clientIp';

const IP_CLIENTE = '203.0.113.42';
const IP_ATACANTE = '198.51.100.99';

const req = (over: Partial<any> = {}): Request =>
  ({ headers: {}, socket: {}, ...over } as Request);

describe('getClientIp', () => {
  it('prefere CF-Connecting-IP (fonte da borda Cloudflare)', () => {
    const r = req({
      headers: { 'cf-connecting-ip': IP_CLIENTE },
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
    });
    expect(getClientIp(r)).toBe(IP_CLIENTE);
  });

  it('SEGURANCA: X-Forwarded-For forjado NAO sobrepoe o CF-Connecting-IP', () => {
    // Cenario do ataque: o cliente injeta um XFF proprio tentando falsear o
    // IP para escapar do rate limit. A Cloudflare reescreve CF-Connecting-IP,
    // entao a origem correta prevalece.
    const r = req({
      headers: {
        'cf-connecting-ip': IP_CLIENTE,
        'x-forwarded-for': `${IP_ATACANTE}, 10.0.0.1`,
      },
      ip: IP_ATACANTE,
    });
    expect(getClientIp(r)).toBe(IP_CLIENTE);
    expect(getClientIp(r)).not.toBe(IP_ATACANTE);
  });

  it('cai para req.ip quando nao ha header da Cloudflare', () => {
    const r = req({ ip: IP_CLIENTE, socket: { remoteAddress: '10.0.0.1' } });
    expect(getClientIp(r)).toBe(IP_CLIENTE);
  });

  it('cai para o peer TCP quando nao ha req.ip', () => {
    const r = req({ socket: { remoteAddress: IP_CLIENTE } });
    expect(getClientIp(r)).toBe(IP_CLIENTE);
  });

  it('devolve "unknown" quando nao ha fonte alguma', () => {
    expect(getClientIp(req())).toBe('unknown');
  });

  it('ignora CF-Connecting-IP vazio ou so espacos', () => {
    const r = req({ headers: { 'cf-connecting-ip': '   ' }, ip: IP_CLIENTE });
    expect(getClientIp(r)).toBe(IP_CLIENTE);
  });

  it('faz trim do header', () => {
    const r = req({ headers: { 'cf-connecting-ip': `  ${IP_CLIENTE}  ` } });
    expect(getClientIp(r)).toBe(IP_CLIENTE);
  });

  it('ignora CF-Connecting-IP em formato de array (nao e o formato da Cloudflare)', () => {
    const r = req({
      headers: { 'cf-connecting-ip': [IP_ATACANTE, IP_CLIENTE] as any },
      ip: IP_CLIENTE,
    });
    expect(getClientIp(r)).toBe(IP_CLIENTE);
  });

  it('resolve IPv6 normalmente', () => {
    const r = req({ headers: { 'cf-connecting-ip': '2001:db8::1' } });
    expect(getClientIp(r)).toBe('2001:db8::1');
  });
});

describe('robustez — nao pode derrubar o pipeline', () => {
  it('sobrevive a request sem headers (mock de middleware)', () => {
    // metricsMiddleware e checkBlockedIP chamam esta funcao em TODA request.
    // Um throw aqui derrubaria o pipeline por causa de telemetria.
    expect(() => getClientIp({ ip: '1.2.3.4' } as any)).not.toThrow();
    expect(getClientIp({ ip: '1.2.3.4' } as any)).toBe('1.2.3.4');
  });

  it('sobrevive a request sem headers e sem ip', () => {
    expect(getClientIp({} as any)).toBe('unknown');
  });
});
