/**
 * Unit tests para freeEmailDomains.
 * Testa getEmailDomain e isFreeEmailDomain.
 */

import {
    getEmailDomain,
    isFreeEmailDomain,
    FREE_EMAIL_DOMAINS,
} from '../../../utils/freeEmailDomains';

// ═══════════════════════════════════════════════════════════════
// getEmailDomain
// ═══════════════════════════════════════════════════════════════
describe('getEmailDomain', () => {
    it('deve extrair dominio de email valido', () => {
        expect(getEmailDomain('user@gmail.com')).toBe('gmail.com');
    });

    it('deve extrair dominio de email corporativo', () => {
        expect(getEmailDomain('joao@signalads.com.br')).toBe('signalads.com.br');
    });

    it('deve retornar dominio em lowercase', () => {
        expect(getEmailDomain('User@GMAIL.COM')).toBe('gmail.com');
    });

    it('deve tratar email com espacos ao redor', () => {
        expect(getEmailDomain('  user@example.com  ')).toBe('example.com');
    });

    it('deve retornar string vazia para email sem @', () => {
        expect(getEmailDomain('invalid-email')).toBe('');
    });

    it('deve retornar string vazia para string vazia', () => {
        expect(getEmailDomain('')).toBe('');
    });

    it('deve retornar string vazia para apenas @', () => {
        expect(getEmailDomain('@')).toBe('');
    });

    it('deve retornar dominio correto quando ha multiplos @', () => {
        // split('@')[1] retorna a parte apos o primeiro @
        expect(getEmailDomain('user@domain@extra.com')).toBe('domain');
    });

    it('deve extrair dominio de email com subdominio', () => {
        expect(getEmailDomain('admin@mail.empresa.com.br')).toBe('mail.empresa.com.br');
    });

    it('deve tratar email com caracteres especiais no local part', () => {
        expect(getEmailDomain('user+tag@protonmail.com')).toBe('protonmail.com');
    });
});

// ═══════════════════════════════════════════════════════════════
// isFreeEmailDomain
// ═══════════════════════════════════════════════════════════════
describe('isFreeEmailDomain', () => {
    // ── Provedores gratuitos que DEVEM ser bloqueados ──────────
    describe('deve retornar true para provedores gratuitos', () => {
        const freeProviders = [
            'user@gmail.com',
            'user@googlemail.com',
            'user@hotmail.com',
            'user@hotmail.com.br',
            'user@outlook.com',
            'user@outlook.com.br',
            'user@live.com',
            'user@yahoo.com',
            'user@yahoo.com.br',
            'user@icloud.com',
            'user@protonmail.com',
            'user@proton.me',
            'user@aol.com',
        ];

        it.each(freeProviders)('%s', (email) => {
            expect(isFreeEmailDomain(email)).toBe(true);
        });
    });

    // ── Provedores brasileiros gratuitos ───────────────────────
    describe('deve retornar true para provedores brasileiros gratuitos', () => {
        const brazilianFree = [
            'user@bol.com.br',
            'user@uol.com.br',
            'user@terra.com.br',
            'user@ig.com.br',
            'user@globo.com',
            'user@r7.com',
        ];

        it.each(brazilianFree)('%s', (email) => {
            expect(isFreeEmailDomain(email)).toBe(true);
        });
    });

    // ── Emails temporarios/descartaveis ────────────────────────
    describe('deve retornar true para provedores temporarios', () => {
        const disposable = [
            'user@mailinator.com',
            'user@guerrillamail.com',
            'user@yopmail.com',
            'user@tempmail.com',
            'user@10minutemail.com',
        ];

        it.each(disposable)('%s', (email) => {
            expect(isFreeEmailDomain(email)).toBe(true);
        });
    });

    // ── Emails corporativos que DEVEM ser permitidos ───────────
    describe('deve retornar false para dominios corporativos', () => {
        const corporate = [
            'contato@signalads.com',
            'joao@empresa.com.br',
            'admin@radiofm.com.br',
            'financeiro@agencia.digital',
            'user@custom-domain.com',
            'ceo@startup.io',
        ];

        it.each(corporate)('%s', (email) => {
            expect(isFreeEmailDomain(email)).toBe(false);
        });
    });

    // ── Edge cases ─────────────────────────────────────────────
    it('deve retornar false para string vazia', () => {
        expect(isFreeEmailDomain('')).toBe(false);
    });

    it('deve retornar false para email sem @', () => {
        expect(isFreeEmailDomain('invalido')).toBe(false);
    });

    it('deve ser case insensitive (GMAIL.COM)', () => {
        expect(isFreeEmailDomain('user@GMAIL.COM')).toBe(true);
    });

    it('deve ser case insensitive (Hotmail.Com)', () => {
        expect(isFreeEmailDomain('user@Hotmail.Com')).toBe(true);
    });

    it('deve tratar email com espacos', () => {
        expect(isFreeEmailDomain('  user@gmail.com  ')).toBe(true);
    });

    it('deve retornar false para subdominio de provedor gratuito', () => {
        // mail.gmail.com nao esta na lista — nao e o mesmo que gmail.com
        expect(isFreeEmailDomain('user@mail.gmail.com')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════
// FREE_EMAIL_DOMAINS — integridade da lista
// ═══════════════════════════════════════════════════════════════
describe('FREE_EMAIL_DOMAINS (lista)', () => {
    it('deve conter pelo menos 50 dominios', () => {
        expect(FREE_EMAIL_DOMAINS.length).toBeGreaterThanOrEqual(50);
    });

    it('nao deve conter duplicatas', () => {
        const unique = new Set(FREE_EMAIL_DOMAINS);
        expect(unique.size).toBe(FREE_EMAIL_DOMAINS.length);
    });

    it('todos os dominios devem estar em lowercase', () => {
        for (const domain of FREE_EMAIL_DOMAINS) {
            expect(domain).toBe(domain.toLowerCase());
        }
    });

    it('nenhum dominio deve conter @', () => {
        for (const domain of FREE_EMAIL_DOMAINS) {
            expect(domain).not.toContain('@');
        }
    });

    it('nenhum dominio deve conter espacos', () => {
        for (const domain of FREE_EMAIL_DOMAINS) {
            expect(domain.trim()).toBe(domain);
        }
    });
});
