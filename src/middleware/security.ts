import { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';

// ============================================================
// NoSQL Injection Protection
// Remove keys starting with '$' and '__proto__' to prevent
// MongoDB operator injection and prototype pollution
// ============================================================
const sanitizeMongo = (obj: any): void => {
    if (obj && typeof obj === 'object') {
        for (const key in obj) {
            if (key.startsWith('$') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
                delete obj[key];
            } else if (typeof obj[key] === 'string') {
                // Block MongoDB operators in string values like {"field": {"$gt": ""}}
                // Only block if it looks like an operator pattern
                if (/^\$[a-zA-Z]+$/.test(obj[key])) {
                    obj[key] = '';
                }
            } else {
                sanitizeMongo(obj[key]);
            }
        }
    }
};

export const mongoSanitize = (req: Request, res: Response, next: NextFunction) => {
    try {
        if (req.body) sanitizeMongo(req.body);
        if (req.query) sanitizeMongo(req.query);
        if (req.params) sanitizeMongo(req.params);
    } catch (error) {
        console.error('Sanitization error:', error);
    }
    next();
};

// ============================================================
// XSS Protection (substitui xss-clean incompativel com Express 5)
// Sanitiza strings em body, query e params para remover HTML/JS malicioso
// ============================================================
const sanitizeXssValue = (value: any): any => {
    if (typeof value === 'string') {
        return sanitizeHtml(value, {
            allowedTags: [],       // Nenhuma tag HTML permitida
            allowedAttributes: {}, // Nenhum atributo permitido
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
    } catch (error) {
        console.error('XSS Sanitization error:', error);
    }
    next();
};
