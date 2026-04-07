/**
 * Unit tests para stringUtils.
 * Testa escapeRegex e toAccentInsensitiveRegex.
 */

import { escapeRegex, toAccentInsensitiveRegex } from '../../../utils/stringUtils';

// ═══════════════════════════════════════════════════════════════
// escapeRegex
// ═══════════════════════════════════════════════════════════════
describe('escapeRegex', () => {
    it('deve escapar ponto (.)', () => {
        expect(escapeRegex('a.b')).toBe('a\\.b');
    });

    it('deve escapar asterisco (*)', () => {
        expect(escapeRegex('a*b')).toBe('a\\*b');
    });

    it('deve escapar mais (+)', () => {
        expect(escapeRegex('a+b')).toBe('a\\+b');
    });

    it('deve escapar interrogacao (?)', () => {
        expect(escapeRegex('a?b')).toBe('a\\?b');
    });

    it('deve escapar circunflexo (^)', () => {
        expect(escapeRegex('^start')).toBe('\\^start');
    });

    it('deve escapar dolar ($)', () => {
        expect(escapeRegex('end$')).toBe('end\\$');
    });

    it('deve escapar chaves ({})', () => {
        expect(escapeRegex('a{1,3}')).toBe('a\\{1,3\\}');
    });

    it('deve escapar parenteses ((|))', () => {
        expect(escapeRegex('(a|b)')).toBe('\\(a\\|b\\)');
    });

    it('deve escapar colchetes ([])', () => {
        expect(escapeRegex('[abc]')).toBe('\\[abc\\]');
    });

    it('deve escapar barra invertida (\\)', () => {
        expect(escapeRegex('a\\b')).toBe('a\\\\b');
    });

    it('deve escapar todos os caracteres especiais de uma vez', () => {
        const input = '.*+?^${}()|[]\\';
        const escaped = escapeRegex(input);

        // Cada caractere especial deve estar precedido por \
        expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });

    it('nao deve alterar strings sem caracteres especiais', () => {
        expect(escapeRegex('hello world')).toBe('hello world');
    });

    it('nao deve alterar string vazia', () => {
        expect(escapeRegex('')).toBe('');
    });

    it('deve escapar corretamente strings que parecem regex patterns', () => {
        const mongoPattern = '{ $regex: ".*" }';
        const escaped = escapeRegex(mongoPattern);

        // A string escapada nao deve funcionar como regex perigoso
        const re = new RegExp(escaped);
        expect(re.test(mongoPattern)).toBe(true);
        expect(re.test('qualquer coisa')).toBe(false);
    });

    it('resultado deve ser seguro para uso em new RegExp()', () => {
        const dangerous = 'test.+something[0]';
        const escaped = escapeRegex(dangerous);

        // Nao deve lancar erro ao criar RegExp
        expect(() => new RegExp(escaped)).not.toThrow();

        // Deve fazer match literal
        const re = new RegExp(escaped);
        expect(re.test('test.+something[0]')).toBe(true);
        expect(re.test('testXXsomething0')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════
// toAccentInsensitiveRegex
// ═══════════════════════════════════════════════════════════════
describe('toAccentInsensitiveRegex', () => {
    // ── Matching basico ────────────────────────────────────────
    it('deve retornar um RegExp', () => {
        const result = toAccentInsensitiveRegex('teste');
        expect(result).toBeInstanceOf(RegExp);
    });

    it('deve fazer match com texto exato', () => {
        const regex = toAccentInsensitiveRegex('radio');
        expect(regex.test('radio')).toBe(true);
    });

    // ── Case insensitive ───────────────────────────────────────
    it('deve ser case insensitive', () => {
        const regex = toAccentInsensitiveRegex('Radio');
        expect(regex.test('radio')).toBe(true);
        expect(regex.test('RADIO')).toBe(true);
        expect(regex.test('Radio')).toBe(true);
    });

    // ── Acentos: input com acento deve encontrar sem acento ───
    it('deve fazer match de "Sao Paulo" quando buscando "Sao Paulo"', () => {
        const regex = toAccentInsensitiveRegex('Sao Paulo');
        expect(regex.test('Sao Paulo')).toBe(true);
    });

    it('deve fazer match de "Sao Paulo" e "Sao Paulo" com acentos', () => {
        const regex = toAccentInsensitiveRegex('Sao Paulo');
        expect(regex.test('Sao Paulo')).toBe(true);
        expect(regex.test('SAO PAULO')).toBe(true);
    });

    it('deve fazer match de "Sao Paulo" quando input e "Sao Paulo" (sem acento)', () => {
        const regex = toAccentInsensitiveRegex('Sao Paulo');
        expect(regex.test('Sao Paulo')).toBe(true);
    });

    // ── Acentos: input com acento normalizado ──────────────────
    it('deve normalizar input com acento (NFD) para busca', () => {
        // Input: "Sao" (com til) -> normalizado para "Sao" -> regex aceita ambos
        const regex = toAccentInsensitiveRegex('\u0053\u00e3o Paulo');
        expect(regex.test('Sao Paulo')).toBe(true);
        expect(regex.test('sao paulo')).toBe(true);
    });

    // ── Cedilha ────────────────────────────────────────────────
    it('deve tratar cedilha (c/c)', () => {
        const regex = toAccentInsensitiveRegex('Florianopolis');
        expect(regex.test('Florianopolis')).toBe(true);
    });

    it('deve fazer match de "acao" com e sem cedilha', () => {
        const regex = toAccentInsensitiveRegex('acao');
        expect(regex.test('acao')).toBe(true);
    });

    // ── Til ────────────────────────────────────────────────────
    it('deve tratar til em a', () => {
        const regex = toAccentInsensitiveRegex('manha');
        expect(regex.test('manha')).toBe(true);
        expect(regex.test('MANHA')).toBe(true);
    });

    // ── Acento agudo ───────────────────────────────────────────
    it('deve tratar acento agudo em vogais', () => {
        const regex = toAccentInsensitiveRegex('cafe');
        expect(regex.test('cafe')).toBe(true);
        expect(regex.test('Cafe')).toBe(true);
    });

    // ── Acento circunflexo ─────────────────────────────────────
    it('deve tratar acento circunflexo', () => {
        const regex = toAccentInsensitiveRegex('competencia');
        expect(regex.test('competencia')).toBe(true);
    });

    // ── Trema (u) ──────────────────────────────────────────────
    it('deve tratar u com trema', () => {
        const regex = toAccentInsensitiveRegex('frequencia');
        expect(regex.test('frequencia')).toBe(true);
    });

    // ── Enhe (n) ───────────────────────────────────────────────
    it('deve tratar n/n tilde', () => {
        const regex = toAccentInsensitiveRegex('espanol');
        expect(regex.test('espanol')).toBe(true);
    });

    // ── Caracteres especiais no input ──────────────────────────
    it('deve escapar caracteres especiais de regex no input', () => {
        const regex = toAccentInsensitiveRegex('Radio FM 98.5');
        expect(regex.test('Radio FM 98.5')).toBe(true);
        // O ponto deve ser literal, nao wildcard
        expect(regex.test('Radio FM 9805')).toBe(false);
    });

    it('deve escapar parenteses no input', () => {
        const regex = toAccentInsensitiveRegex('Cidade (SP)');
        expect(regex.test('Cidade (SP)')).toBe(true);
    });

    it('deve escapar colchetes no input', () => {
        const regex = toAccentInsensitiveRegex('Opcao [A]');
        expect(regex.test('Opcao [A]')).toBe(true);
    });

    // ── Strings complexas ──────────────────────────────────────
    it('deve funcionar com nomes de cidades brasileiras comuns', () => {
        const cities = [
            { search: 'Belem', targets: ['Belem', 'belem', 'BELEM'] },
            { search: 'Goiania', targets: ['Goiania', 'goiania'] },
            { search: 'Brasilia', targets: ['Brasilia', 'BRASILIA'] },
            { search: 'Curitiba', targets: ['Curitiba', 'curitiba'] },
        ];

        for (const city of cities) {
            const regex = toAccentInsensitiveRegex(city.search);
            for (const target of city.targets) {
                expect(regex.test(target)).toBe(true);
            }
        }
    });

    it('deve funcionar com string vazia', () => {
        const regex = toAccentInsensitiveRegex('');
        // Regex vazio faz match com tudo
        expect(regex.test('')).toBe(true);
        expect(regex.test('qualquer coisa')).toBe(true);
    });

    it('deve encontrar substring dentro de texto maior', () => {
        const regex = toAccentInsensitiveRegex('paulo');
        expect(regex.test('Cidade de Sao Paulo - SP')).toBe(true);
    });

    // ── Flag 'i' ───────────────────────────────────────────────
    it('deve ter a flag "i" no regex gerado', () => {
        const regex = toAccentInsensitiveRegex('test');
        expect(regex.flags).toContain('i');
    });
});
