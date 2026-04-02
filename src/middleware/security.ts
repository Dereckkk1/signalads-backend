import { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';

// ============================================================
// NoSQL Injection Protection
// Remove keys starting with '$' and '__proto__' to prevent
// MongoDB operator injection and prototype pollution
// ============================================================
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

const sanitizeMongo = (obj: any, depth = 0): void => {
    // Limite de profundidade para prevenir stack overflow em payloads aninhados
    if (!obj || typeof obj !== 'object' || depth > 10) return;

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
    } catch {
        // Sanitization error — continue silently
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
