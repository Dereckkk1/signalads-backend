/**
 * Unit tests — tamper-evidence do AuditLog (FASE 9.4).
 * Cada registro carrega um HMAC-SHA256 do proprio conteudo; alterar qualquer
 * campo assinado deve fazer a verificacao falhar.
 */

import {
    computeAuditSignature,
    verifyAuditLogIntegrity,
    buildAuditPayload,
} from '../../../models/AuditLog';

const ORIGINAL_SECRET = process.env.AUDIT_LOG_SECRET;
const ORIGINAL_JWT = process.env.JWT_SECRET;

beforeEach(() => {
    process.env.AUDIT_LOG_SECRET = 'audit-secret-para-testes-123456';
    process.env.JWT_SECRET = 'jwt-secret-para-testes-123456';
});

afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.AUDIT_LOG_SECRET;
    else process.env.AUDIT_LOG_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_JWT === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL_JWT;
});

function baseRecord() {
    return {
        userId: '507f1f77bcf86cd799439011',
        action: 'user.role_change',
        resource: 'user',
        resourceId: '507f1f77bcf86cd799439012',
        details: { requestBody: { role: 'admin' }, responseStatus: 200 },
        ipAddress: '203.0.113.10',
        userAgent: 'Mozilla/5.0',
        timestamp: new Date('2026-07-20T12:00:00.000Z'),
    };
}

describe('computeAuditSignature', () => {
    it('deve gerar HMAC hex de 64 chars', () => {
        const sig = computeAuditSignature(baseRecord());
        expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });

    it('deve ser deterministico independente da ordem das chaves', () => {
        const a = computeAuditSignature({
            action: 'x',
            resource: 'y',
            details: { b: 2, a: 1 },
            timestamp: new Date('2026-01-01T00:00:00.000Z'),
        });
        const b = computeAuditSignature({
            timestamp: new Date('2026-01-01T00:00:00.000Z'),
            details: { a: 1, b: 2 },
            resource: 'y',
            action: 'x',
        });
        expect(a).toBe(b);
    });

    it('deve mudar quando o segredo muda', () => {
        const record = baseRecord();
        const a = computeAuditSignature(record);
        process.env.AUDIT_LOG_SECRET = 'outro-segredo-completamente-diferente';
        expect(computeAuditSignature(record)).not.toBe(a);
    });

    it('deve retornar null quando nao ha segredo configurado', () => {
        delete process.env.AUDIT_LOG_SECRET;
        delete process.env.JWT_SECRET;
        expect(computeAuditSignature(baseRecord())).toBeNull();
    });

    it('payload canonico deve ignorar campos nao assinados', () => {
        const withExtra = { ...baseRecord(), _id: 'abc', __v: 0 };
        expect(buildAuditPayload(withExtra)).toBe(buildAuditPayload(baseRecord()));
    });
});

describe('verifyAuditLogIntegrity', () => {
    it('deve validar registro intacto', () => {
        const record: any = baseRecord();
        record.integrityHash = computeAuditSignature(record);
        expect(verifyAuditLogIntegrity(record)).toEqual({ valid: true });
    });

    it('deve detectar adulteracao da action', () => {
        const record: any = baseRecord();
        record.integrityHash = computeAuditSignature(record);
        record.action = 'user.role_change.innocuo';
        expect(verifyAuditLogIntegrity(record)).toEqual({ valid: false, reason: 'tampered' });
    });

    it('deve detectar adulteracao do ipAddress (apagar rastro do atacante)', () => {
        const record: any = baseRecord();
        record.integrityHash = computeAuditSignature(record);
        record.ipAddress = '127.0.0.1';
        expect(verifyAuditLogIntegrity(record).valid).toBe(false);
    });

    it('deve detectar adulteracao dentro de details', () => {
        const record: any = baseRecord();
        record.integrityHash = computeAuditSignature(record);
        record.details.requestBody.role = 'advertiser';
        expect(verifyAuditLogIntegrity(record).valid).toBe(false);
    });

    it('deve detectar hash truncado/substituido', () => {
        const record: any = baseRecord();
        record.integrityHash = 'deadbeef';
        expect(verifyAuditLogIntegrity(record)).toEqual({ valid: false, reason: 'tampered' });
    });

    it('deve reportar not-signed para registro sem hash (legado)', () => {
        expect(verifyAuditLogIntegrity(baseRecord() as any)).toEqual({
            valid: false,
            reason: 'not-signed',
        });
        expect(verifyAuditLogIntegrity(null)).toEqual({ valid: false, reason: 'not-signed' });
    });

    it('deve reportar no-secret quando o segredo sumiu', () => {
        const record: any = baseRecord();
        record.integrityHash = computeAuditSignature(record);
        delete process.env.AUDIT_LOG_SECRET;
        delete process.env.JWT_SECRET;
        expect(verifyAuditLogIntegrity(record)).toEqual({ valid: false, reason: 'no-secret' });
    });
});
