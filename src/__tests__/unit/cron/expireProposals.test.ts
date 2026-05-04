/**
 * Unit tests para expireProposals cron job.
 * Testa a logica de expiracao de propostas e alertas de expiracao.
 *
 * Mock: node-cron, Proposal model, emailService.
 */

// ── Mock node-cron — captura o callback do schedule ──
let cronCallback: (() => Promise<void>) | null = null;

jest.mock('node-cron', () => ({
    __esModule: true,
    default: {
        schedule: jest.fn((expression: string, cb: () => Promise<void>) => {
            cronCallback = cb;
        }),
    },
}));

// ── Mock Proposal model ──
const mockUpdateMany = jest.fn();
const mockFind = jest.fn();

jest.mock('../../../models/Proposal', () => ({
    __esModule: true,
    default: {
        updateMany: mockUpdateMany,
        find: mockFind,
    },
}));

// ── Mock Order e SponsorshipBooking — chamados no inicio do cron
// para liberar bookings; sem mock ficam buffering 10s sem conexao Mongo.
jest.mock('../../../models/Order', () => ({
    __esModule: true,
    default: {
        find: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([]),
        }),
    },
}));

jest.mock('../../../models/SponsorshipBooking', () => ({
    __esModule: true,
    default: {
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    },
}));

// ── Mock emailService (dynamic import) ──
const mockSendEmail = jest.fn();
const mockCreateEmailTemplate = jest.fn().mockReturnValue('<html>test</html>');

jest.mock('../../../services/emailService', () => ({
    __esModule: true,
    default: {
        createEmailTemplate: mockCreateEmailTemplate,
        sendEmail: mockSendEmail,
    },
}));

import cron from 'node-cron';
import { startExpireProposalsCron } from '../../../cron/expireProposals';

// ─── Setup ─────────────────────────────────────────────────────
beforeEach(() => {
    jest.clearAllMocks();
    cronCallback = null;
});

// ═══════════════════════════════════════════════════════════════
// startExpireProposalsCron — scheduling
// ═══════════════════════════════════════════════════════════════
describe('startExpireProposalsCron — scheduling', () => {
    it('deve registrar um cron job com schedule', () => {
        startExpireProposalsCron();

        expect(cron.schedule).toHaveBeenCalledTimes(1);
        expect(cron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
    });

    it('deve capturar callback executavel', () => {
        startExpireProposalsCron();

        expect(cronCallback).not.toBeNull();
        expect(typeof cronCallback).toBe('function');
    });
});

// ═══════════════════════════════════════════════════════════════
// Logica de expiracao — Proposal.updateMany
// ═══════════════════════════════════════════════════════════════
describe('expireProposals — logica de expiracao', () => {
    beforeEach(() => {
        startExpireProposalsCron();
    });

    it('deve chamar updateMany para expirar propostas vencidas', async () => {
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });
        mockFind.mockReturnValueOnce({
            populate: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([]),
        });

        await cronCallback!();

        expect(mockUpdateMany).toHaveBeenCalledTimes(1);
        expect(mockUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                validUntil: expect.objectContaining({ $lt: expect.any(Date) }),
                status: { $in: ['draft', 'sent', 'viewed'] },
            }),
            expect.objectContaining({
                $set: { status: 'expired' },
            })
        );
    });

    it('deve logar quantidade quando propostas sao expiradas', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 5 });
        mockFind.mockReturnValueOnce({
            populate: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([]),
        });

        await cronCallback!();

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('5 proposta(s) expirada(s)')
        );
        consoleSpy.mockRestore();
    });

    it('nao deve logar quando nenhuma proposta e expirada', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });
        mockFind.mockReturnValueOnce({
            populate: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([]),
        });

        await cronCallback!();

        expect(consoleSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('proposta(s) expirada(s)')
        );
        consoleSpy.mockRestore();
    });
});

// ═══════════════════════════════════════════════════════════════
// Logica de alertas — propostas expirando em 3 dias
// ═══════════════════════════════════════════════════════════════
describe('expireProposals — alertas de expiracao', () => {
    beforeEach(() => {
        startExpireProposalsCron();
    });

    it('deve buscar propostas que expiram em 3 dias', async () => {
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });

        const mockPopulate = jest.fn().mockReturnThis();
        const mockLean = jest.fn().mockResolvedValue([]);
        mockFind.mockReturnValueOnce({
            populate: mockPopulate,
            lean: mockLean,
        });

        await cronCallback!();

        expect(mockFind).toHaveBeenCalledTimes(1);
        expect(mockFind).toHaveBeenCalledWith(
            expect.objectContaining({
                status: { $in: ['sent', 'viewed'] },
            })
        );
    });

    it('deve enviar email para propostas expirando com ownerType broadcaster', async () => {
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });

        const twoDaysFromNow = new Date();
        twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

        const proposal = {
            _id: 'prop-1',
            proposalNumber: 'PROP-001',
            title: 'Campanha Teste',
            clientName: 'Cliente X',
            status: 'sent',
            validUntil: twoDaysFromNow,
            ownerType: 'broadcaster',
            broadcasterId: {
                _id: 'bc-1',
                email: 'radio@test.com',
                companyName: 'Radio FM',
            },
            agencyId: null,
        };

        const mockPopulate = jest.fn().mockReturnThis();
        const mockLean = jest.fn().mockResolvedValue([proposal]);
        mockFind.mockReturnValueOnce({
            populate: mockPopulate,
            lean: mockLean,
        });

        await cronCallback!();

        expect(mockCreateEmailTemplate).toHaveBeenCalledTimes(1);
        expect(mockCreateEmailTemplate).toHaveBeenCalledWith(
            expect.objectContaining({
                title: expect.stringContaining('expira em'),
            })
        );
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'radio@test.com',
            })
        );
    });

    it('deve enviar email para propostas expirando com ownerType agency', async () => {
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });

        const oneDayFromNow = new Date();
        oneDayFromNow.setDate(oneDayFromNow.getDate() + 1);

        const proposal = {
            _id: 'prop-2',
            proposalNumber: 'PROP-002',
            title: 'Campanha Agency',
            clientName: 'Agency Client',
            status: 'viewed',
            validUntil: oneDayFromNow,
            ownerType: 'agency',
            broadcasterId: null,
            agencyId: {
                _id: 'ag-1',
                email: 'agency@test.com',
                companyName: 'Agency Co',
            },
        };

        const mockPopulate = jest.fn().mockReturnThis();
        const mockLean = jest.fn().mockResolvedValue([proposal]);
        mockFind.mockReturnValueOnce({
            populate: mockPopulate,
            lean: mockLean,
        });

        await cronCallback!();

        expect(mockSendEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'agency@test.com',
            })
        );
    });

    it('deve pular propostas sem email do owner', async () => {
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });

        const proposal = {
            _id: 'prop-3',
            proposalNumber: 'PROP-003',
            title: 'No Email',
            clientName: 'Test',
            status: 'sent',
            validUntil: new Date(Date.now() + 86400000),
            ownerType: 'broadcaster',
            broadcasterId: { _id: 'bc-2' }, // No email
            agencyId: null,
        };

        const mockPopulate = jest.fn().mockReturnThis();
        const mockLean = jest.fn().mockResolvedValue([proposal]);
        mockFind.mockReturnValueOnce({
            populate: mockPopulate,
            lean: mockLean,
        });

        await cronCallback!();

        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('nao deve enviar alertas quando nao ha propostas expirando', async () => {
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });

        const mockPopulate = jest.fn().mockReturnThis();
        const mockLean = jest.fn().mockResolvedValue([]);
        mockFind.mockReturnValueOnce({
            populate: mockPopulate,
            lean: mockLean,
        });

        await cronCallback!();

        expect(mockSendEmail).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// Tratamento de erros
// ═══════════════════════════════════════════════════════════════
describe('expireProposals — tratamento de erros', () => {
    beforeEach(() => {
        startExpireProposalsCron();
    });

    it('deve tratar erro no updateMany sem crashar', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        mockUpdateMany.mockRejectedValueOnce(new Error('DB Error'));

        await expect(cronCallback!()).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Erro ao expirar propostas'),
            expect.any(Error)
        );
        consoleSpy.mockRestore();
    });

    it('deve tratar erro no envio de email sem crashar', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });

        const proposal = {
            _id: 'prop-err',
            proposalNumber: 'PROP-ERR',
            title: 'Error Test',
            clientName: 'Test',
            status: 'sent',
            validUntil: new Date(Date.now() + 86400000),
            ownerType: 'broadcaster',
            broadcasterId: { _id: 'bc-err', email: 'err@test.com', companyName: 'Test' },
            agencyId: null,
        };

        const mockPopulate = jest.fn().mockReturnThis();
        const mockLean = jest.fn().mockResolvedValue([proposal]);
        mockFind.mockReturnValueOnce({
            populate: mockPopulate,
            lean: mockLean,
        });

        mockCreateEmailTemplate.mockImplementationOnce(() => {
            throw new Error('Template error');
        });

        await expect(cronCallback!()).resolves.toBeUndefined();

        consoleSpy.mockRestore();
    });
});
