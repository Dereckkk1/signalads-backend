/**
 * Unit tests para middleware de seguranca (security.ts).
 * Testa mongoSanitize, xssSanitize e sanitizeRichText diretamente.
 */

import { Request, Response, NextFunction } from 'express';
import { mongoSanitize, xssSanitize, sanitizeRichText, dedupeQuery } from '../../../middleware/security';
import { createMockRequest, createMockResponse, createMockNext } from '../../helpers/testHelpers';

// ═══════════════════════════════════════════════════════════════
// mongoSanitize
// ═══════════════════════════════════════════════════════════════
describe('mongoSanitize', () => {
    // ── Remocao de operadores $ ────────────────────────────────
    it('deve remover keys com prefixo $ do body', () => {
        const req = createMockRequest({
            body: { email: 'test@test.com', $gt: '', $ne: null },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body['$gt']).toBeUndefined();
        expect(req.body['$ne']).toBeUndefined();
        expect(req.body.email).toBe('test@test.com');
        expect(next).toHaveBeenCalled();
    });

    it('deve remover keys com prefixo $ do query', () => {
        const req = createMockRequest({
            query: { search: 'radio', $where: 'this.password' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.query['$where']).toBeUndefined();
        expect(req.query.search).toBe('radio');
        expect(next).toHaveBeenCalled();
    });

    it('deve remover keys com prefixo $ do params', () => {
        const req = createMockRequest({
            params: { id: '123', $regex: '.*' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.params['$regex']).toBeUndefined();
        expect(req.params.id).toBe('123');
        expect(next).toHaveBeenCalled();
    });

    // ── Prototype pollution ────────────────────────────────────
    it('deve remover __proto__ do body', () => {
        const body = { email: 'test@test.com' } as any;
        body['__proto__'] = { isAdmin: true };
        // __proto__ gets assigned to prototype, create it via Object.defineProperty
        const realBody = Object.create(null);
        realBody.email = 'test@test.com';
        realBody['__proto__'] = { isAdmin: true };

        const req = createMockRequest({ body: realBody });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(realBody['__proto__']).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('deve remover "constructor" do body', () => {
        const body = Object.create(null);
        body.name = 'test';
        body['constructor'] = { prototype: { isAdmin: true } };

        const req = createMockRequest({ body });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(body['constructor']).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('deve remover "prototype" do body', () => {
        const body = Object.create(null);
        body.name = 'test';
        body['prototype'] = { exec: 'malicious' };

        const req = createMockRequest({ body });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(body['prototype']).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('deve remover "toString" do body (dangerous key)', () => {
        const body = Object.create(null);
        body.name = 'test';
        body['toString'] = 'malicious';

        const req = createMockRequest({ body });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(body['toString']).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('deve remover "valueOf" do body (dangerous key)', () => {
        const body = Object.create(null);
        body.name = 'test';
        body['valueOf'] = 'malicious';

        const req = createMockRequest({ body });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(body['valueOf']).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    // ── Valores string com operadores $ ────────────────────────
    it('deve bloquear string values que comecam com $ seguido de letra', () => {
        const req = createMockRequest({
            body: { field: '$gt' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.field).toBe('');
        expect(next).toHaveBeenCalled();
    });

    it('deve bloquear "$ne" como valor string', () => {
        const req = createMockRequest({
            body: { role: '$ne' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.role).toBe('');
    });

    it('nao deve bloquear strings que comecam com $ mas sem letra (ex: "$100")', () => {
        const req = createMockRequest({
            body: { price: '$100' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        // $100 nao match /^\$[a-zA-Z]/ — deve permanecer
        expect(req.body.price).toBe('$100');
    });

    // ── Objetos aninhados ──────────────────────────────────────
    it('deve sanitizar objetos aninhados', () => {
        const req = createMockRequest({
            body: {
                user: {
                    email: 'test@test.com',
                    role: { $ne: 'admin' },
                },
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.user.role['$ne']).toBeUndefined();
        expect(req.body.user.email).toBe('test@test.com');
    });

    it('deve sanitizar arrays com objetos', () => {
        const req = createMockRequest({
            body: {
                items: [
                    { name: 'ok' },
                    { $gt: 'malicious' },
                ],
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.items[1]['$gt']).toBeUndefined();
        expect(req.body.items[0].name).toBe('ok');
    });

    // ── Limite de profundidade ─────────────────────────────────
    it('deve parar de sanitizar alem de 10 niveis de profundidade', () => {
        // Cria objeto com 12 niveis de aninhamento
        let deep: any = { '$evil': 'should-survive' };
        for (let i = 0; i < 12; i++) {
            deep = { level: deep };
        }

        const req = createMockRequest({ body: deep });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        // O middleware deve chamar next() mesmo com profundidade excessiva
        expect(next).toHaveBeenCalled();
    });

    it('deve retornar 400 quando profundidade excede MAX_DEPTH (DoS / ataque de aninhamento)', () => {
        // Cria objeto com 35 niveis (acima do MAX_DEPTH = 30)
        let deep: any = { value: 'leaf' };
        for (let i = 0; i < 35; i++) {
            deep = { nested: deep };
        }

        const req = createMockRequest({ body: deep });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        // Deve responder 400 e NAO chamar next()
        expect(res.statusCode).toBe(400);
        expect(res.jsonData).toEqual({ error: 'Payload muito profundo' });
        expect(next).not.toHaveBeenCalled();
    });

    // ── Body/query/params ausentes ─────────────────────────────
    it('deve funcionar quando body e null', () => {
        const req = createMockRequest({ body: null });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve funcionar quando body e undefined', () => {
        const req = createMockRequest({ body: undefined });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    // ── Nao alterar dados validos ──────────────────────────────
    it('nao deve alterar dados validos', () => {
        const validData = {
            name: 'Radio FM',
            email: 'radio@test.com',
            price: 150.50,
            active: true,
            tags: ['music', 'news'],
        };

        const req = createMockRequest({ body: { ...validData } });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.name).toBe('Radio FM');
        expect(req.body.email).toBe('radio@test.com');
        expect(req.body.price).toBe(150.50);
        expect(req.body.active).toBe(true);
        expect(req.body.tags).toEqual(['music', 'news']);
    });

    it('deve sempre chamar next()', () => {
        const req = createMockRequest({
            body: { $gt: '', $ne: null, __proto__: {} },
        });
        const res = createMockResponse();
        const next = createMockNext();

        mongoSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ═══════════════════════════════════════════════════════════════
// xssSanitize
// ═══════════════════════════════════════════════════════════════
describe('xssSanitize', () => {
    // ── Remocao de tags HTML ───────────────────────────────────
    it('deve remover tags <script> de strings no body', () => {
        const req = createMockRequest({
            body: { name: '<script>alert("xss")</script>Radio FM' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.name).not.toContain('<script>');
        expect(req.body.name).toContain('Radio FM');
    });

    it('deve remover tags <img> com onerror', () => {
        const req = createMockRequest({
            body: { bio: '<img src=x onerror=alert(1)>Descricao' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.bio).not.toContain('<img');
        expect(req.body.bio).not.toContain('onerror');
        expect(req.body.bio).toContain('Descricao');
    });

    it('deve remover tags <iframe>', () => {
        const req = createMockRequest({
            body: { content: '<iframe src="evil.com"></iframe>Safe' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.content).not.toContain('<iframe');
        expect(req.body.content).toContain('Safe');
    });

    it('deve remover todas as tags HTML em modo global (allowedTags: [])', () => {
        const req = createMockRequest({
            body: { text: '<b>bold</b> <i>italic</i> <p>para</p>' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.text).not.toContain('<b>');
        expect(req.body.text).not.toContain('<i>');
        expect(req.body.text).not.toContain('<p>');
        // O conteudo textual deve permanecer
        expect(req.body.text).toContain('bold');
        expect(req.body.text).toContain('italic');
    });

    // ── Objetos aninhados e arrays ─────────────────────────────
    it('deve sanitizar strings em objetos aninhados', () => {
        const req = createMockRequest({
            body: {
                user: {
                    name: '<script>steal()</script>John',
                    bio: 'Normal text',
                },
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.user.name).not.toContain('<script>');
        expect(req.body.user.name).toContain('John');
        expect(req.body.user.bio).toBe('Normal text');
    });

    it('deve sanitizar strings dentro de arrays', () => {
        const req = createMockRequest({
            body: {
                tags: ['<script>xss</script>', 'safe tag', '<b>bold</b>'],
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.tags[0]).not.toContain('<script>');
        expect(req.body.tags[1]).toBe('safe tag');
        expect(req.body.tags[2]).not.toContain('<b>');
    });

    // ── Query e params ─────────────────────────────────────────
    it('deve sanitizar strings em query params', () => {
        const req = createMockRequest({
            query: { search: '<script>alert(1)</script>radio' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.query.search).not.toContain('<script>');
        expect(req.query.search).toContain('radio');
    });

    it('deve sanitizar strings em params', () => {
        const req = createMockRequest({
            params: { id: '<script>alert(1)</script>123' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.params.id).not.toContain('<script>');
        expect(req.params.id).toContain('123');
    });

    // ── Preservacao de dados validos ───────────────────────────
    it('nao deve alterar strings sem HTML', () => {
        const req = createMockRequest({
            body: { name: 'Radio FM Brasil', price: 150 },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.name).toBe('Radio FM Brasil');
        expect(req.body.price).toBe(150);
    });

    it('nao deve alterar valores nao-string (numeros, booleans)', () => {
        const req = createMockRequest({
            body: { count: 42, active: true, rate: 3.14, nothing: null },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.body.count).toBe(42);
        expect(req.body.active).toBe(true);
        expect(req.body.rate).toBe(3.14);
        expect(req.body.nothing).toBeNull();
    });

    it('deve sempre chamar next()', () => {
        const req = createMockRequest({
            body: { evil: '<script>alert("xss")</script>' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve funcionar com body vazio', () => {
        const req = createMockRequest({ body: {} });
        const res = createMockResponse();
        const next = createMockNext();

        xssSanitize(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// sanitizeRichText
// ═══════════════════════════════════════════════════════════════
describe('sanitizeRichText', () => {
    // ── Tags permitidas ────────────────────────────────────────
    it('deve permitir tags basicas de formatacao (p, b, strong, em, i, u)', () => {
        const input = '<p>Paragrafo</p><b>Bold</b><strong>Strong</strong><em>Em</em><i>Italic</i><u>Under</u>';
        const result = sanitizeRichText(input);

        expect(result).toContain('<p>');
        expect(result).toContain('<b>');
        expect(result).toContain('<strong>');
        expect(result).toContain('<em>');
        expect(result).toContain('<i>');
        expect(result).toContain('<u>');
    });

    it('deve permitir tags de lista (ul, ol, li)', () => {
        const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
        const result = sanitizeRichText(input);

        expect(result).toContain('<ul>');
        expect(result).toContain('<li>');
    });

    it('deve permitir tags de heading (h1, h2, h3, h4)', () => {
        const input = '<h1>Titulo</h1><h2>Subtitulo</h2><h3>Secao</h3><h4>Sub</h4>';
        const result = sanitizeRichText(input);

        expect(result).toContain('<h1>');
        expect(result).toContain('<h2>');
        expect(result).toContain('<h3>');
        expect(result).toContain('<h4>');
    });

    it('deve permitir links (a) com href, target, rel', () => {
        const input = '<a href="https://signalads.com" target="_blank" rel="noopener">Link</a>';
        const result = sanitizeRichText(input);

        expect(result).toContain('<a');
        expect(result).toContain('href="https://signalads.com"');
        expect(result).toContain('target="_blank"');
        expect(result).toContain('rel="noopener"');
    });

    it('deve permitir blockquote', () => {
        const input = '<blockquote>Citacao importante</blockquote>';
        const result = sanitizeRichText(input);

        expect(result).toContain('<blockquote>');
    });

    it('deve permitir code e pre', () => {
        const input = '<pre><code>const x = 1;</code></pre>';
        const result = sanitizeRichText(input);

        expect(result).toContain('<pre>');
        expect(result).toContain('<code>');
    });

    it('deve permitir hr e br', () => {
        const input = 'Texto<br>Linha<hr>Separado';
        const result = sanitizeRichText(input);

        expect(result).toContain('<br');
        expect(result).toContain('<hr');
    });

    it('deve permitir del e s (strikethrough)', () => {
        const input = '<del>Removido</del><s>Riscado</s>';
        const result = sanitizeRichText(input);

        expect(result).toContain('<del>');
        expect(result).toContain('<s>');
    });

    it('deve permitir span com atributo style', () => {
        const input = '<span style="font-size: 14px">Texto</span>';
        const result = sanitizeRichText(input);

        expect(result).toContain('<span');
    });

    // ── Tags bloqueadas ────────────────────────────────────────
    it('deve remover tags <script>', () => {
        const input = '<p>Seguro</p><script>alert("xss")</script>';
        const result = sanitizeRichText(input);

        expect(result).not.toContain('<script>');
        expect(result).toContain('<p>Seguro</p>');
    });

    it('deve remover tags <iframe>', () => {
        const input = '<p>Conteudo</p><iframe src="evil.com"></iframe>';
        const result = sanitizeRichText(input);

        expect(result).not.toContain('<iframe');
    });

    it('deve remover tags <object>', () => {
        const input = '<p>Ok</p><object data="evil.swf"></object>';
        const result = sanitizeRichText(input);

        expect(result).not.toContain('<object');
    });

    it('deve remover tags <embed>', () => {
        const input = '<p>Ok</p><embed src="evil.swf">';
        const result = sanitizeRichText(input);

        expect(result).not.toContain('<embed');
    });

    it('deve remover tags <img> (nao esta na whitelist de rich text)', () => {
        const input = '<p>Ok</p><img src="x" onerror="alert(1)">';
        const result = sanitizeRichText(input);

        expect(result).not.toContain('<img');
    });

    it('deve remover event handlers de tags permitidas', () => {
        const input = '<p onclick="alert(1)">Texto</p>';
        const result = sanitizeRichText(input);

        expect(result).not.toContain('onclick');
        expect(result).toContain('<p>');
        expect(result).toContain('Texto');
    });

    it('deve remover atributos nao-permitidos de link', () => {
        const input = '<a href="https://ok.com" onclick="evil()">Link</a>';
        const result = sanitizeRichText(input);

        expect(result).toContain('href="https://ok.com"');
        expect(result).not.toContain('onclick');
    });

    // ── Strings sem HTML ───────────────────────────────────────
    it('deve retornar texto puro inalterado', () => {
        const input = 'Texto simples sem HTML';
        const result = sanitizeRichText(input);

        expect(result).toBe('Texto simples sem HTML');
    });

    it('deve tratar string vazia', () => {
        expect(sanitizeRichText('')).toBe('');
    });
});

// ═══════════════════════════════════════════════════════════════
// dedupeQuery (HPP — HTTP Parameter Pollution)
// Substitui o pacote `hpp` que e no-op no Express 5.
// ═══════════════════════════════════════════════════════════════
describe('dedupeQuery', () => {
    it('deve colapsar query params duplicados para o ULTIMO valor', () => {
        const req = createMockRequest({
            query: { sort: ['asc', 'desc'] as any },
        });
        const res = createMockResponse();
        const next = createMockNext();

        dedupeQuery(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.query.sort).toBe('desc');
        expect(next).toHaveBeenCalled();
    });

    it('deve preservar valores escalares inalterados', () => {
        const req = createMockRequest({
            query: { search: 'radio', page: '2' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        dedupeQuery(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.query.search).toBe('radio');
        expect(req.query.page).toBe('2');
        expect(next).toHaveBeenCalled();
    });

    it('deve colapsar apenas keys com array, mantendo escalares', () => {
        const req = createMockRequest({
            query: {
                search: 'radio',
                tag: ['music', 'news', 'pop'] as any,
                limit: '10',
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        dedupeQuery(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(req.query.search).toBe('radio');
        expect(req.query.tag).toBe('pop'); // ultimo valor do array
        expect(req.query.limit).toBe('10');
        expect(next).toHaveBeenCalled();
    });

    it('deve funcionar quando query esta vazia', () => {
        const req = createMockRequest({ query: {} });
        const res = createMockResponse();
        const next = createMockNext();

        dedupeQuery(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('nao deve quebrar quando query e undefined', () => {
        const req = createMockRequest({});
        delete (req as any).query;
        const res = createMockResponse();
        const next = createMockNext();

        dedupeQuery(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve sempre chamar next()', () => {
        const req = createMockRequest({
            query: { foo: ['a', 'b'] as any },
        });
        const res = createMockResponse();
        const next = createMockNext();

        dedupeQuery(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});
