import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware factory that sets the `Cache-Control` header
 * for downstream CDN / browser caching of public marketplace endpoints.
 *
 * Usage:
 *   router.get('/something', setCacheHeaders('public', 30, 60), handler);
 *
 * @param directive       Cache-Control directive ("public" | "private" | "no-store" ...)
 * @param sMaxAgeSeconds  Shared (CDN) max-age in seconds
 * @param maxAgeSeconds   Browser max-age in seconds
 */
export const setCacheHeaders = (
  directive: 'public' | 'private' | 'no-store' = 'public',
  sMaxAgeSeconds = 60,
  maxAgeSeconds = 30
) => {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (directive === 'no-store') {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader(
        'Cache-Control',
        `${directive}, max-age=${maxAgeSeconds}, s-maxage=${sMaxAgeSeconds}`
      );
    }
    next();
  };
};

export default setCacheHeaders;
