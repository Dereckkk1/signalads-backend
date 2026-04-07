/**
 * Unit tests para proposalAlerts cron job.
 * Testa alertas inteligentes: propostas quentes (visualizadas 3+ vezes)
 * e propostas stale (enviadas 7+ dias sem visualizacao).
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
const mockFindViewed = jest.fn();
const mockFindSent = jest.fn();

// We need to handle two different find calls, so we track call order
let findCallCount = 0;

jest.mock('../../../models/Proposal', () => ({
    __esModule: true,
    default: {
        find: jest.fn((...args: any[]) => {
            findCallCount++;
            if (findCallCount % 2 === 1) {
                // First call: viewedNoResponse
                return mockFindViewed(...args);
            } else {
                // Second call: sentNoView
                return mockFindSent(...args);
            }
        }),
    },
}));

// ── Mock emailService (dynamic import) ──
const mockSendEmail = jest.fn();
const mockCreateEmailTemplate = jest.fn().mockReturnValue('<html>alert</html>');

jest.mock('../../../services/emailService', () => ({
    __esModule: true,
    default: {
        createEmailTemplate: mockCreateEmailTemplate,
        sendEmail: mockSendEmail,
    },
}));

import cron from 'node-cron';
import { startProposalAlertsCron } from '../../../cron/proposalAlerts';

// ── Helper: chain pattern for Mongoose queries ──
function createChainedQuery(results: any[]) {
    return {
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(results),
    };
}

// ─── Setup ─────────────────────────────────────────────────────
beforeEach(() => {
    jest.clearAllMocks();
    cronCallback = null;
    findCallCount = 0;
});

// ═══════════════════════════════════════════════════════════════
// startProposalAlertsCron — scheduling
// ═══════════════════════════════════════════════════════════════
describe('startProposalAlertsCron — scheduling', () => {
    it('deve registrar cron para dias uteis as 09:00', () => {
        startProposalAlertsCron();

        expect(cron.schedule).toHaveBeenCalledTimes(1);
        expect(cron.schedule).toHaveBeenCalledWith('0 9 * * 1-5', expect.any(Function));
    });

    it('deve capturar callback executavel', () => {
        startProposalAlertsCron();

        expect(cronCallback).not.toBeNull();
        expect(typeof cronCallback).toBe('function');
    });
});

// ═══════════════════════════════════════════════════════════════
// Logica de alertas — nenhuma proposta
// ═══════════════════════════════════════════════════════════════
describe('proposalAlerts — sem propostas', () => {
    beforeEach(() => {
        startProposalAlertsCron();
    });

    it('deve retornar early quando nao ha propostas em nenhuma categoria', async () => {
        mockFindViewed.mockReturnValueOnce(createChainedQuery([]));
        mockFindSent.mockReturnValueOnce(createChainedQuery([]));

        await cronCallback!();

        // Should not attempt to send emails
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(mockCreateEmailTemplate).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// Logica de alertas — propostas quentes (viewed 3+ vezes)
// ═══════════════════════════════════════════════════════════════
describe('proposalAlerts — propostas quentes', () => {
    beforeEach(() => {
        startProposalAlertsCron();
    });

    it('deve agrupar alertas por owner e enviar email consolidado', async () => {
        const viewedProposals = [
            {
                _id: 'p1',
                proposalNumber: 'PROP-001',
                title: 'Campanha A',
                clientName: 'Cliente A',
                status: 'viewed',
                viewCount: 5,
                ownerType: 'agency',
                agencyId: { _id: 'ag-1', email: 'agency@test.com', companyName: 'Agency Co' },
                broadcasterId: null,
            },
            {
                _id: 'p2',
                proposalNumber: 'PROP-002',
                title: 'Campanha B',
                clientName: 'Cliente B',
                status: 'viewed',
                viewCount: 3,
                ownerType: 'agency',
                agencyId: { _id: 'ag-1', email: 'agency@test.com', companyName: 'Agency Co' },
                broadcasterId: null,
            },
        ];

        mockFindViewed.mockReturnValueOnce(createChainedQuery(viewedProposals));
        mockFindSent.mockReturnValueOnce(createChainedQuery([]));

        await cronCallback!();

        // Should send ONE consolidated email (same owner)
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'agency@test.com',
                subject: expect.stringContaining('2 proposta(s)'),
            })
        );
    });

    it('deve incluir info de visualizacoes no template', async () => {
        const viewedProposals = [{
            _id: 'p3',
            proposalNumber: 'PROP-003',
            title: 'Campanha Hot',
            clientName: 'Hot Client',
            status: 'viewed',
            viewCount: 7,
            ownerType: 'broadcaster',
            broadcasterId: { _id: 'bc-1', email: 'radio@test.com', companyName: 'Radio FM' },
            agencyId: null,
        }];

        mockFindViewed.mockReturnValueOnce(createChainedQuery(viewedProposals));
        mockFindSent.mockReturnValueOnce(createChainedQuery([]));

        await cronCallback!();

        expect(mockCreateEmailTemplate).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Alerta de Propostas',
            })
        );

        // The content should include viewCount
        const templateCall = mockCreateEmailTemplate.mock.calls[0][0];
        expect(templateCall.content).toContain('7 visualiza');
        expect(templateCall.content).toContain('PROP-003');
    });
});

// ═══════════════════════════════════════════════════════════════
// Logica de alertas — propostas stale (7+ dias sem visualizacao)
// ═══════════════════════════════════════════════════════════════
describe('proposalAlerts — propostas stale', () => {
    beforeEach(() => {
        startProposalAlertsCron();
    });

    it('deve incluir propostas stale no alerta', async () => {
        const staleProposals = [{
            _id: 'p4',
            proposalNumber: 'PROP-004',
            title: 'Campanha Stale',
            clientName: 'Stale Client',
            status: 'sent',
            ownerType: 'broadcaster',
            broadcasterId: { _id: 'bc-2', email: 'radio2@test.com', companyName: 'Radio XYZ' },
            agencyId: null,
        }];

        mockFindViewed.mockReturnValueOnce(createChainedQuery([]));
        mockFindSent.mockReturnValueOnce(createChainedQuery(staleProposals));

        await cronCallback!();

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'radio2@test.com',
            })
        );

        const templateCall = mockCreateEmailTemplate.mock.calls[0][0];
        expect(templateCall.content).toContain('sem visualiza');
        expect(templateCall.content).toContain('PROP-004');
    });
});

// ═══════════════════════════════════════════════════════════════
// Logica de alertas — ambos os tipos juntos
// ═══════════════════════════════════════════════════════════════
describe('proposalAlerts — alertas combinados', () => {
    beforeEach(() => {
        startProposalAlertsCron();
    });

    it('deve enviar email com ambas as secoes quando owner tem ambos tipos', async () => {
        const viewedProposals = [{
            _id: 'p5',
            proposalNumber: 'PROP-005',
            title: 'Hot Proposal',
            clientName: 'Client Hot',
            status: 'viewed',
            viewCount: 4,
            ownerType: 'agency',
            agencyId: { _id: 'ag-2', email: 'combo@test.com', companyName: 'Combo Agency' },
            broadcasterId: null,
        }];

        const staleProposals = [{
            _id: 'p6',
            proposalNumber: 'PROP-006',
            title: 'Stale Proposal',
            clientName: 'Client Stale',
            status: 'sent',
            ownerType: 'agency',
            agencyId: { _id: 'ag-2', email: 'combo@test.com', companyName: 'Combo Agency' },
            broadcasterId: null,
        }];

        mockFindViewed.mockReturnValueOnce(createChainedQuery(viewedProposals));
        mockFindSent.mockReturnValueOnce(createChainedQuery(staleProposals));

        await cronCallback!();

        // Single email for the same owner
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: expect.stringContaining('2 proposta(s)'),
            })
        );

        const templateCall = mockCreateEmailTemplate.mock.calls[0][0];
        expect(templateCall.content).toContain('quentes');
        expect(templateCall.content).toContain('sem visualiza');
    });

    it('deve enviar emails separados para owners diferentes', async () => {
        const viewedProposals = [{
            _id: 'p7',
            proposalNumber: 'PROP-007',
            title: 'Owner1 Prop',
            clientName: 'Client1',
            status: 'viewed',
            viewCount: 3,
            ownerType: 'agency',
            agencyId: { _id: 'ag-3', email: 'owner1@test.com', companyName: 'Owner1' },
            broadcasterId: null,
        }];

        const staleProposals = [{
            _id: 'p8',
            proposalNumber: 'PROP-008',
            title: 'Owner2 Prop',
            clientName: 'Client2',
            status: 'sent',
            ownerType: 'broadcaster',
            broadcasterId: { _id: 'bc-3', email: 'owner2@test.com', companyName: 'Owner2' },
            agencyId: null,
        }];

        mockFindViewed.mockReturnValueOnce(createChainedQuery(viewedProposals));
        mockFindSent.mockReturnValueOnce(createChainedQuery(staleProposals));

        await cronCallback!();

        // Two different owners = two emails
        expect(mockSendEmail).toHaveBeenCalledTimes(2);
    });
});

// ═══════════════════════════════════════════════════════════════
// Logica de alertas — propostas sem email
// ═══════════════════════════════════════════════════════════════
describe('proposalAlerts — owners sem email', () => {
    beforeEach(() => {
        startProposalAlertsCron();
    });

    it('deve pular proposals sem email no owner', async () => {
        const viewedProposals = [{
            _id: 'p9',
            proposalNumber: 'PROP-009',
            title: 'No Email',
            clientName: 'Test',
            status: 'viewed',
            viewCount: 5,
            ownerType: 'broadcaster',
            broadcasterId: { _id: 'bc-no-email' }, // No email field
            agencyId: null,
        }];

        mockFindViewed.mockReturnValueOnce(createChainedQuery(viewedProposals));
        mockFindSent.mockReturnValueOnce(createChainedQuery([]));

        await cronCallback!();

        expect(mockSendEmail).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// Tratamento de erros
// ═══════════════════════════════════════════════════════════════
describe('proposalAlerts — tratamento de erros', () => {
    beforeEach(() => {
        startProposalAlertsCron();
    });

    it('deve tratar erro no Proposal.find sem crashar', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        mockFindViewed.mockReturnValueOnce({
            populate: jest.fn().mockReturnThis(),
            lean: jest.fn().mockRejectedValue(new Error('DB Error')),
        });

        await expect(cronCallback!()).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Erro ao gerar alertas'),
            expect.any(Error)
        );
        consoleSpy.mockRestore();
    });

    it('deve tratar erro no envio de email sem crashar', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const viewedProposals = [{
            _id: 'p-err',
            proposalNumber: 'PROP-ERR',
            title: 'Error Test',
            clientName: 'Test',
            status: 'viewed',
            viewCount: 3,
            ownerType: 'agency',
            agencyId: { _id: 'ag-err', email: 'err@test.com', companyName: 'Err' },
            broadcasterId: null,
        }];

        mockFindViewed.mockReturnValueOnce(createChainedQuery(viewedProposals));
        mockFindSent.mockReturnValueOnce(createChainedQuery([]));

        mockCreateEmailTemplate.mockImplementationOnce(() => {
            throw new Error('Template render error');
        });

        await expect(cronCallback!()).resolves.toBeUndefined();

        consoleSpy.mockRestore();
    });
});
