import { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';

// ============================================================
// NoSQL Injection Protection
// Remove keys starting with '$' and '__proto__' to prevent
// MongoDB operator injection and prototype pollution
// ============================================================
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

// Hard cap on nesting depth. Legitimate payloads have depth <= 5.
// 30 is a generous safety margin for any future feature; anything deeper
// is rejected as suspicious / DoS attempt (defense in depth).
const MAX_DEPTH = 30;

class PayloadTooDeepError extends Error {
    constructor() {
        super('Payload muito profundo');
        this.name = 'PayloadTooDeepError';
    }
}

const sanitizeMongo = (obj: any, depth = 0): void => {
    if (!obj || typeof obj !== 'object') return;
    // Fail closed: reject the whole request rather than silently letting
    // operator-laden keys through at depths > MAX_DEPTH.
    if (depth > MAX_DEPTH) {
        throw new PayloadTooDeepError();
    }

    const keys = Array.isArray(obj) ? Object.keys(obj) : Object.keys(obj);
    for (const key of keys) {
        if (key.startsWith('$') || DANGEROUS_KEYS.has(key)) {
            delete obj[key];
        } else if (typeof obj[key] === 'string') {
            // NADA a fazer com valores string.
            //
            // Antes (ate 2026-07-20) esta checagem zerava qualquer string
            // iniciada por `$`+letra. Nao havia ganho de seguranca — um
            // operador do MongoDB so e perigoso como CHAVE, e a chave ja e
            // removida no ramo acima — e havia dano real: uma senha como
            // "$enhaForte1" chegava ao controller como "" e a conta ficava
            // permanentemente inacessivel (item 4.4 do plano de remediacao).
        } else if (obj[key] && typeof obj[key] === 'object') {
            sanitizeMongo(obj[key], depth + 1);
        }
    }
};

export const mongoSanitize = (req: Request, res: Response, next: NextFunction) => {
    try {
        if (req.body) sanitizeMongo(req.body);
        if (req.params) sanitizeMongo(req.params);
        // req.query NAO e tratado aqui — ver sanitizeQuery abaixo.
    } catch (err) {
        if (err instanceof PayloadTooDeepError) {
            return res.status(400).json({ error: 'Payload muito profundo' });
        }
        // Fail-closed: um sanitizador que falha nao pode deixar passar o
        // payload cru para o proximo middleware (o sanitizeXssValue tem um
        // sink de prototype pollution logo adiante).
        return res.status(400).json({ error: 'Requisição inválida' });
    }
    next();
};

// ============================================================
// XSS Protection (substitui xss-clean incompativel com Express 5)
// Sanitiza strings em body, query e params para remover HTML/JS malicioso
// ============================================================

// Sanitizador GLOBAL: zero tags permitidas (strip all HTML)
const sanitizeXssValue = (value: any): any => {
    if (typeof value === 'string') {
        return sanitizeHtml(value, {
            allowedTags: [],
            allowedAttributes: {},
            disallowedTagsMode: 'recursiveEscape'
        });
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeXssValue);
    }
    if (value && typeof value === 'object') {
        const cleaned: any = {};
        for (const key of Object.keys(value)) {
            cleaned[key] = sanitizeXssValue(value[key]);
        }
        return cleaned;
    }
    return value;
};

// Sanitizador para campos RICH TEXT (Tiptap editor) — uso exclusivo em rotas especificas
const RICH_TEXT_TAGS = [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'h1', 'h2', 'h3', 'h4',
    'ul', 'ol', 'li',
    'blockquote', 'hr', 'code', 'pre',
    'a', 'span',
];

const RICH_TEXT_ATTRIBUTES: Record<string, string[]> = {
    'a': ['href', 'target', 'rel'],
    'span': ['style'],
    '*': [],
};

export const sanitizeRichText = (html: string): string => {
    return sanitizeHtml(html, {
        allowedTags: RICH_TEXT_TAGS,
        allowedAttributes: RICH_TEXT_ATTRIBUTES,
        allowedStyles: {
            'span': { 'font-size': [/^\d+(?:px|em|rem|%)$/] },
        },
        disallowedTagsMode: 'recursiveEscape'
    });
};

export const xssSanitize = (req: Request, res: Response, next: NextFunction) => {
    try {
        if (req.body) req.body = sanitizeXssValue(req.body);
        if (req.params) {
            for (const key of Object.keys(req.params)) {
                (req.params as any)[key] = sanitizeXssValue(req.params[key]);
            }
        }
        // req.query NAO e tratado aqui — ver sanitizeQuery abaixo.
    } catch {
        // XSS sanitization error — continue silently
    }
    next();
};

// ============================================================
// Sanitizacao de req.query (HPP + NoSQL + XSS)
//
// SEGURANCA (item 4.2 do plano 2026-07-20): ate aqui, mongoSanitize,
// xssSanitize e dedupeQuery TENTAVAM tratar `req.query` mutando o objeto
// devolvido pelo getter. No Express 5 `req.query` e um getter SEM
// memoizacao — `express/lib/request.js` faz `return queryparse(querystring)`
// a cada acesso, construindo um objeto novo. Ou seja: o middleware saneava
// uma instancia descartavel e o controller lia outra, crua. As tres
// protecoes eram no-op para query string, e os testes nao percebiam porque
// chamavam as funcoes com objetos literais (onde mutar funciona).
//
// A correcao e substituir o GETTER por um valor ja saneado, uma unica vez.
//
// Nota: hoje o parser padrao do Express e o `simple` (querystring.parse),
// que so produz string | string[] — por isso nao ha injecao de operador por
// query mesmo com o bug. Isso e sorte de configuracao, nao defesa: no dia em
// que alguem definir `app.set('query parser', 'extended')` por outro motivo,
// a protecao precisa estar de pe. Nao troque o parser sem revisar isto.
// ============================================================
export const sanitizeQuery = (req: Request, res: Response, next: NextFunction) => {
    try {
        const raw = req.query as Record<string, any>;
        if (!raw || typeof raw !== 'object') return next();

        const cleaned: Record<string, any> = {};
        for (const key of Object.keys(raw)) {
            const value = raw[key];
            // HPP: ?a=1&a=2 colapsa para o ULTIMO valor
            cleaned[key] = Array.isArray(value) ? value[value.length - 1] : value;
        }

        sanitizeMongo(cleaned);

        for (const key of Object.keys(cleaned)) {
            cleaned[key] = sanitizeXssValue(cleaned[key]);
        }

        // Substitui o getter no proprio `req`: sem isto, qualquer acesso
        // posterior a req.query reconstroi o objeto e descarta a limpeza.
        Object.defineProperty(req, 'query', {
            value: cleaned,
            writable: true,
            configurable: true,
            enumerable: true,
        });
    } catch (err) {
        if (err instanceof PayloadTooDeepError) {
            return res.status(400).json({ error: 'Payload muito profundo' });
        }
        return res.status(400).json({ error: 'Requisição inválida' });
    }
    next();
};

/**
 * @deprecated Use `sanitizeQuery`. Mantido como alias porque varios testes
 * e o index.ts o importam pelo nome antigo.
 */
export const dedupeQuery = sanitizeQuery;

// ============================================================
// Sanitizacao de corpos multipart/form-data
//
// SEGURANCA (item 4.3 do plano 2026-07-20): `mongoSanitize` e `xssSanitize`
// sao montados globalmente em index.ts, ANTES das rotas. Mas `req.body` de
// um request multipart so e populado pelo multer, que roda DENTRO da rota —
// logo, todo campo de texto enviado junto com um arquivo chegava ao banco
// sem escape de HTML e sem remocao de chaves `$`.
//
// Era o vetor que armava o sink de XSS do Pedido de Insercao no frontend:
// o `document.write` interpolava dados do pedido confiando que a entrada
// tinha sido higienizada — e para multipart ela nunca era.
//
// USO: espalhar DEPOIS do multer, nunca antes (antes do multer req.body
// ainda esta vazio e o middleware nao teria o que sanear):
//
//   router.post('/rota', auth, upload.single('audio'), ...sanitizeMultipart, handler);
// ============================================================
export const sanitizeMultipart = [mongoSanitize, xssSanitize];
