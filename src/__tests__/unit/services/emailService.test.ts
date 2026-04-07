/**
 * Unit tests para emailService.
 * Testa funcoes de envio de email, template helpers e escapeHtml.
 *
 * Mock: nodemailer — nunca envia emails reais.
 */

// ── Mock nodemailer BEFORE any imports ──
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-message-id-123' });
const mockCreateTransport = jest.fn().mockReturnValue({
    sendMail: mockSendMail,
});

jest.mock('nodemailer', () => ({
    createTransport: mockCreateTransport,
}));

// ── Env setup (must be before import so createTransporter() uses them) ──
process.env.SMTP_HOST = 'smtp.test.com';
process.env.SMTP_USER = 'user@test.com';
process.env.SMTP_PASS = 'password123';
process.env.SMTP_PORT = '587';
process.env.SMTP_FROM = 'E-radios <test@e-radios.com>';
process.env.FRONTEND_URL = 'https://e-radios.test';

// ── Now import the module under test ──
import emailService, {
    sendNewOrderToBroadcaster,
    sendOrderConfirmationToClient,
    sendOrderApprovedToClient,
    sendOrderRejectedToClient,
    sendOrderCancelledToClient,
    sendEmailConfirmation,
    sendTwoFactorEnableEmail,
    paragraph,
    greeting,
    infoCard,
    alertCard,
    list,
    divider,
} from '../../../services/emailService';

// ─── Setup ─────────────────────────────────────────────────────
beforeEach(() => {
    jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// Template helper — escapeHtml (tested via paragraph)
// ═══════════════════════════════════════════════════════════════
describe('escapeHtml via paragraph', () => {
    it('deve escapar caracteres HTML em texto', () => {
        const result = paragraph('<script>alert("xss")</script>');
        expect(result).not.toContain('<script>');
        expect(result).toContain('&lt;script&gt;');
        expect(result).toContain('&quot;');
    });

    it('deve retornar string vazia para undefined/null', () => {
        const result = paragraph(undefined as any);
        expect(result).toContain('</p>'); // Template wraps it
    });
});

// ═══════════════════════════════════════════════════════════════
// Template helpers
// ═══════════════════════════════════════════════════════════════
describe('template helpers', () => {
    describe('greeting', () => {
        it('deve gerar saudacao com nome escapado', () => {
            const result = greeting('Maria');
            expect(result).toContain('Maria');
            expect(result).toContain('Olá');
        });

        it('deve escapar HTML no nome', () => {
            const result = greeting('<img src=x>');
            expect(result).not.toContain('<img');
            expect(result).toContain('&lt;img');
        });
    });

    describe('infoCard', () => {
        it('deve gerar card com titulo e items', () => {
            const result = infoCard('Detalhes', [
                { label: 'Nome', value: 'Teste' },
                { label: 'Valor', value: 'R$ 100' },
            ]);
            expect(result).toContain('Detalhes');
            expect(result).toContain('Nome');
            expect(result).toContain('Teste');
            expect(result).toContain('R$ 100');
        });

        it('deve aceitar cor customizada', () => {
            const result = infoCard('Test', [], '#FF0000');
            expect(result).toContain('#FF0000');
        });
    });

    describe('alertCard', () => {
        it('deve gerar card de sucesso', () => {
            const result = alertCard('Operacao concluida', 'success');
            expect(result).toContain('Operacao concluida');
            expect(result).toContain('#ECFDF5'); // bg color for success
        });

        it('deve gerar card de warning', () => {
            const result = alertCard('Atencao', 'warning');
            expect(result).toContain('#FEF3C7');
        });

        it('deve gerar card de error', () => {
            const result = alertCard('Erro ocorreu', 'error');
            expect(result).toContain('#FEE2E2');
        });

        it('deve usar info como padrao', () => {
            const result = alertCard('Info msg');
            expect(result).toContain('#FCE7F3');
        });
    });

    describe('list', () => {
        it('deve gerar lista nao-ordenada por padrao', () => {
            const result = list(['Item 1', 'Item 2']);
            expect(result).toContain('<ul');
            expect(result).toContain('Item 1');
            expect(result).toContain('Item 2');
        });

        it('deve gerar lista ordenada quando ordered=true', () => {
            const result = list(['A', 'B'], true);
            expect(result).toContain('<ol');
        });
    });

    describe('divider', () => {
        it('deve retornar HTML de separador', () => {
            const result = divider();
            expect(result).toContain('height: 1px');
        });
    });
});

// ═══════════════════════════════════════════════════════════════
// createEmailTemplate (via default export)
// ═══════════════════════════════════════════════════════════════
describe('createEmailTemplate', () => {
    it('deve gerar HTML completo com titulo', () => {
        const html = emailService.createEmailTemplate({
            title: 'Teste',
            content: '<p>Conteudo</p>',
        });

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('Teste');
        expect(html).toContain('<p>Conteudo</p>');
    });

    it('deve incluir subtitulo quando fornecido', () => {
        const html = emailService.createEmailTemplate({
            title: 'Titulo',
            subtitle: 'Sub aqui',
            content: '<p>Test</p>',
        });

        expect(html).toContain('Sub aqui');
    });

    it('deve incluir botao quando buttonText e buttonUrl fornecidos', () => {
        const html = emailService.createEmailTemplate({
            title: 'Test',
            content: '<p>Test</p>',
            buttonText: 'Clique Aqui',
            buttonUrl: 'https://e-radios.test/action',
        });

        expect(html).toContain('Clique Aqui');
        expect(html).toContain('https://e-radios.test/action');
    });

    it('deve usar preheader quando fornecido', () => {
        const html = emailService.createEmailTemplate({
            title: 'Test',
            content: '<p>Test</p>',
            preheader: 'Preview text here',
        });

        expect(html).toContain('Preview text here');
    });

    it('deve incluir footer com links', () => {
        const html = emailService.createEmailTemplate({
            title: 'Test',
            content: '<p>Test</p>',
        });

        expect(html).toContain('Termos de Uso');
        expect(html).toContain('Privacidade');
        expect(html).toContain('E-rádios');
    });
});

// ═══════════════════════════════════════════════════════════════
// sendEmail (via default export)
// ═══════════════════════════════════════════════════════════════
describe('sendEmail', () => {
    it('deve chamar transporter.sendMail com parametros corretos', async () => {
        await emailService.sendEmail({
            to: 'dest@test.com',
            subject: 'Test Subject',
            html: '<p>Content</p>',
        });

        expect(mockSendMail).toHaveBeenCalledTimes(1);
        expect(mockSendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'dest@test.com',
                subject: 'Test Subject',
                html: '<p>Content</p>',
            })
        );
    });

    it('deve usar SMTP_FROM do env', async () => {
        await emailService.sendEmail({
            to: 'dest@test.com',
            subject: 'Test',
            html: '<p>Test</p>',
        });

        expect(mockSendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                from: 'E-radios <test@e-radios.com>',
            })
        );
    });

    it('deve retornar success:true e messageId quando envio funciona', async () => {
        const result = await emailService.sendEmail({
            to: 'dest@test.com',
            subject: 'Test',
            html: '<p>Test</p>',
        });

        expect(result).toEqual({ success: true, messageId: 'test-message-id-123' });
    });

    it('deve retornar success:false quando sendMail falha (nao propaga erro)', async () => {
        mockSendMail.mockRejectedValueOnce(new Error('SMTP connection failed'));

        const result = await emailService.sendEmail({
            to: 'dest@test.com',
            subject: 'Test',
            html: '<p>Test</p>',
        });

        expect(result).toEqual({ success: false, error: 'SMTP connection failed' });
    });
});

// ═══════════════════════════════════════════════════════════════
// sendEmailConfirmation
// ═══════════════════════════════════════════════════════════════
describe('sendEmailConfirmation', () => {
    it('deve enviar email de confirmacao com link correto', async () => {
        await sendEmailConfirmation('user@test.com', 'Joao', 'token-abc-123');

        expect(mockSendMail).toHaveBeenCalledTimes(1);
        const call = mockSendMail.mock.calls[0][0];
        expect(call.to).toBe('user@test.com');
        expect(call.subject).toContain('Confirme');
        expect(call.html).toContain('https://e-radios.test/confirm-email/token-abc-123');
        expect(call.html).toContain('Joao');
    });
});

// ═══════════════════════════════════════════════════════════════
// sendTwoFactorEnableEmail
// ═══════════════════════════════════════════════════════════════
describe('sendTwoFactorEnableEmail', () => {
    it('deve enviar email com link de ativacao 2FA', async () => {
        await sendTwoFactorEnableEmail('user@test.com', 'Maria', '2fa-token-xyz');

        expect(mockSendMail).toHaveBeenCalledTimes(1);
        const call = mockSendMail.mock.calls[0][0];
        expect(call.to).toBe('user@test.com');
        expect(call.subject).toContain('Duas Etapas')
        expect(call.html).toContain('https://e-radios.test/auth/confirm-2fa/2fa-token-xyz');
    });
});

// ═══════════════════════════════════════════════════════════════
// sendNewOrderToBroadcaster
// ═══════════════════════════════════════════════════════════════
describe('sendNewOrderToBroadcaster', () => {
    const orderData = {
        orderNumber: 'ORD-001',
        buyerName: 'Empresa ABC',
        buyerEmail: 'comprador@test.com',
        broadcasterName: 'Radio FM Test',
        broadcasterEmail: 'radio@test.com',
        totalValue: 1500.50,
        itemsCount: 22,
        createdAt: new Date('2026-01-15T10:00:00Z'),
    };

    it('deve enviar email para a emissora', async () => {
        await sendNewOrderToBroadcaster(orderData);

        expect(mockSendMail).toHaveBeenCalledTimes(1);
        const call = mockSendMail.mock.calls[0][0];
        expect(call.to).toBe('radio@test.com');
    });

    it('deve incluir numero do pedido no subject', async () => {
        await sendNewOrderToBroadcaster(orderData);

        const call = mockSendMail.mock.calls[0][0];
        expect(call.subject).toContain('ORD-001');
    });

    it('deve incluir nome do comprador no HTML', async () => {
        await sendNewOrderToBroadcaster(orderData);

        const call = mockSendMail.mock.calls[0][0];
        expect(call.html).toContain('Empresa ABC');
    });

    it('deve incluir valor formatado no HTML', async () => {
        await sendNewOrderToBroadcaster(orderData);

        const call = mockSendMail.mock.calls[0][0];
        // Brazilian format: R$ 1.500,50
        expect(call.html).toContain('1.500,50');
    });
});

// ═══════════════════════════════════════════════════════════════
// sendOrderApprovedToClient
// ═══════════════════════════════════════════════════════════════
describe('sendOrderApprovedToClient', () => {
    const orderData = {
        orderNumber: 'ORD-002',
        buyerName: 'Cliente Test',
        buyerEmail: 'cliente@test.com',
        broadcasterName: 'Radio XYZ',
        broadcasterEmail: 'radio@test.com',
        totalValue: 3000,
        itemsCount: 44,
        createdAt: new Date(),
    };

    it('deve enviar email para o comprador', async () => {
        await sendOrderApprovedToClient(orderData);

        expect(mockSendMail).toHaveBeenCalledTimes(1);
        expect(mockSendMail.mock.calls[0][0].to).toBe('cliente@test.com');
    });

    it('deve conter Aprovado no subject', async () => {
        await sendOrderApprovedToClient(orderData);

        const call = mockSendMail.mock.calls[0][0];
        expect(call.subject).toContain('Aprovado');
    });

    it('deve conter nome da emissora no HTML', async () => {
        await sendOrderApprovedToClient(orderData);

        const call = mockSendMail.mock.calls[0][0];
        expect(call.html).toContain('Radio XYZ');
    });
});

// ═══════════════════════════════════════════════════════════════
// sendOrderRejectedToClient
// ═══════════════════════════════════════════════════════════════
describe('sendOrderRejectedToClient', () => {
    it('deve enviar email com motivo da recusa', async () => {
        await sendOrderRejectedToClient({
            orderNumber: 'ORD-003',
            buyerName: 'Teste',
            buyerEmail: 'teste@test.com',
            broadcasterName: 'Radio ABC',
            broadcasterEmail: 'radio@test.com',
            totalValue: 500,
            itemsCount: 22,
            createdAt: new Date(),
            reason: 'Horario indisponivel',
        });

        const call = mockSendMail.mock.calls[0][0];
        expect(call.to).toBe('teste@test.com');
        expect(call.subject).toContain('Recusado');
        expect(call.html).toContain('Horario indisponivel');
    });
});

// ═══════════════════════════════════════════════════════════════
// sendOrderCancelledToClient
// ═══════════════════════════════════════════════════════════════
describe('sendOrderCancelledToClient', () => {
    it('deve enviar email com motivo do cancelamento', async () => {
        await sendOrderCancelledToClient({
            orderNumber: 'ORD-004',
            buyerName: 'Teste Cancel',
            buyerEmail: 'cancel@test.com',
            broadcasterName: 'Radio DEF',
            broadcasterEmail: 'radio@test.com',
            totalValue: 800,
            itemsCount: 22,
            createdAt: new Date(),
            cancelReason: 'Prazo SLA expirado',
        });

        const call = mockSendMail.mock.calls[0][0];
        expect(call.to).toBe('cancel@test.com');
        expect(call.subject).toContain('Cancelado');
        expect(call.html).toContain('Prazo SLA expirado');
    });
});

// ═══════════════════════════════════════════════════════════════
// default export — verifica que todas as funcoes estao presentes
// ═══════════════════════════════════════════════════════════════
describe('default export', () => {
    it('deve exportar todas as funcoes de email esperadas', () => {
        expect(typeof emailService.sendNewOrderToBroadcaster).toBe('function');
        expect(typeof emailService.sendOrderConfirmationToClient).toBe('function');
        expect(typeof emailService.sendOrderApprovedToClient).toBe('function');
        expect(typeof emailService.sendOrderRejectedToClient).toBe('function');
        expect(typeof emailService.sendOrderCancelledToClient).toBe('function');
        expect(typeof emailService.sendEmailConfirmation).toBe('function');
        expect(typeof emailService.sendTwoFactorEnableEmail).toBe('function');
        expect(typeof emailService.sendTwoFactorLoginEmail).toBe('function');
        expect(typeof emailService.sendEmail).toBe('function');
        expect(typeof emailService.createEmailTemplate).toBe('function');
    });

    it('deve exportar utilitarios de template', () => {
        expect(typeof emailService.greeting).toBe('function');
        expect(typeof emailService.paragraph).toBe('function');
        expect(typeof emailService.infoCard).toBe('function');
        expect(typeof emailService.alertCard).toBe('function');
        expect(typeof emailService.list).toBe('function');
        expect(typeof emailService.divider).toBe('function');
    });
});
