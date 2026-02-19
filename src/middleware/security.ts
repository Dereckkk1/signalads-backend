import { Request, Response, NextFunction } from 'express';

// Custom NoSQL Injection Protection
// Removes keys starting with '$' to prevent MongoDB operator injection
const sanitize = (obj: any) => {
    if (obj && typeof obj === 'object') {
        for (const key in obj) {
            if (key.startsWith('$')) {
                delete obj[key];
            } else {
                sanitize(obj[key]);
            }
        }
    }
};

export const mongoSanitize = (req: Request, res: Response, next: NextFunction) => {
    try {
        if (req.body) sanitize(req.body);
        if (req.query) sanitize(req.query);
        if (req.params) sanitize(req.params);
    } catch (error) {
        console.error('Sanitization error:', error);
    }
    next();
};
