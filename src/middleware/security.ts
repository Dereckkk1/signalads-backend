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
            // Block MongoDB operators in string values like {"field": {"$gt": ""}}
            if (/^\$[a-zA-Z]/.test(obj[key])) {
                obj[key] = '';
            }
        } else if (obj[key] && typeof obj[key] === 'object') {
            sanitizeMongo(obj[key], depth + 1);
        }
    }
};

export const mongoSanitize = (req: Request, res: Response, next: NextFunction) => {
    try {
        if (req.body) sanitizeMongo(req.body);
        if (req.query) sanitizeMongo(req.query);
        if (req.params) sanitizeMongo(req.params);
    } catch (err) {
        if (err instanceof PayloadTooDeepError) {
            return res.status(400).json({ error: 'Payload muito profundo' });
        }
        // Outros erros de sanitização — segue silenciosamente
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
        // req.query e req.params são read-only no Express 5 — sanitiza in-place
        if (req.query) {
            for (const key of Object.keys(req.query)) {
                (req.query as any)[key] = sanitizeXssValue(req.query[key]);
            }
        }
        if (req.params) {
            for (const key of Object.keys(req.params)) {
                (req.params as any)[key] = sanitizeXssValue(req.params[key]);
            }
        }
    } catch {
        // XSS sanitization error — continue silently
    }
    next();
};
