import { Request, Response, NextFunction } from 'express';
import BlockedIP from '../models/BlockedIP';
import { blockedIPsSet } from '../utils/ipBlockList';
import { matchSuspiciousPath } from '../utils/suspiciousPaths';

const LOCALHOST_IPS = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);

// ─────────────────────────────────────────────────────────────
// Middleware: bloqueia IP na PRIMEIRA tentativa em path suspeito.
//
// Diferenca para o auto-block tradicional (em metrics.ts):
//   - Auto-block tradicional acumula 10+ requests pra avaliar
//     taxa de 404s. Bom contra scanners "lentos" que se diluem.
//   - Este middleware bloqueia INSTANTANEAMENTE qualquer um que
//     tente paths conhecidos de exploit (.env, wp-admin, .git, etc.)
//
// IP block tem ROI baixo se o bot trocar de IP (VPN/proxy), mas:
//   - O regex match continua devolvendo 403 pra qualquer IP novo
//   - O block do IP corrente economiza CPU e zera o ataque atual
// ─────────────────────────────────────────────────────────────
export const checkSuspiciousPath = (req: Request, res: Response, next: NextFunction): void => {
    const matched = matchSuspiciousPath(req.path);
    if (!matched) {
        next();
        return;
    }

    const ip = req.ip || req.socket.remoteAddress || '';

    // Localhost nunca e bloqueado (admin testando, dev local, healthcheck)
    if (LOCALHOST_IPS.has(ip)) {
        res.status(404).json({ error: 'Not Found' });
        return;
    }

    // Bloqueio em memoria imediato (sincrono — protege requests subsequentes)
    if (ip && !blockedIPsSet.has(ip)) {
        blockedIPsSet.add(ip);
        const reason = `Auto-bloqueado: tentativa de acesso a path suspeito (${req.path})`;

        // Persistencia em background — nao bloqueia a resposta
        BlockedIP.findOneAndUpdate(
            { ip },
            {
                ip,
                reason,
                blockedAt: new Date(),
                blockedById: 'system',
                blockedByEmail: 'auto-block@sistema',
            },
            { upsert: true }
        ).catch(() => {
            // Falha silenciosa — IP ja esta no Set em memoria
        });

        console.log(`[suspicious-path] ${ip} bloqueado — tentou ${req.method} ${req.path}`);
    }

    // 404 (nao 403) para nao revelar que bloqueamos — bot pode aprender e mudar de tatica
    res.status(404).json({ error: 'Not Found' });
};
