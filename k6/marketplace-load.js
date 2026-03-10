/**
 * k6 Load Test — GET /api/admin/broadcasters (Marketplace)
 * 
 * Executar:
 *   k6 run --env API_URL=http://localhost:5000/api ^
 *           --env TEST_EMAIL=perf@test.com ^
 *           --env TEST_PASS=Senha@123 ^
 *           k6/marketplace-load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Métricas customizadas
const errorRate = new Rate('custom_errors');
const broadcastersLatency = new Trend('broadcasters_duration', true);

export const options = {
    stages: [
        { duration: '30s', target: 5 },   // Aquecimento — 5 usuários
        { duration: '1m', target: 25 },  // Carga normal — 25 usuários
        { duration: '1m', target: 50 },  // Pico realista — 50 usuários
        { duration: '30s', target: 100 }, // Stress — 100 usuários
        { duration: '30s', target: 0 },   // Ramp-down
    ],
    thresholds: {
        // SLA definido no performance.md
        http_req_duration: ['p(95)<500', 'p(99)<1000'],
        http_req_failed: ['rate<0.01'],  // < 1% de falhas
        custom_errors: ['rate<0.01'],
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:5000/api';

// Faz login uma única vez e retorna o token para todos os VUs
export function setup() {
    const loginRes = http.post(
        `${BASE_URL}/auth/login`,
        JSON.stringify({ emailOrCnpj: __ENV.TEST_EMAIL, password: __ENV.TEST_PASS }),
        { headers: { 'Content-Type': 'application/json' } }
    );

    const ok = check(loginRes, {
        'setup: login bem-sucedido': (r) => r.status === 200,
        'setup: token presente': (r) => !!r.json('token'),
    });

    if (!ok) {
        console.error('SETUP FALHOU — Login não retornou token. Verifique credenciais.');
    }

    return { token: loginRes.json('token') };
}

export default function (data) {
    const headers = {
        'Authorization': `Bearer ${data.token}`,
        'Content-Type': 'application/json',
    };

    // ── Cenário: Browse no marketplace ──
    const res = http.get(`${BASE_URL}/admin/broadcasters?status=approved`, { headers });

    const success = check(res, {
        'broadcasters: status 200': (r) => r.status === 200,
        'broadcasters: resposta < 500ms': (r) => r.timings.duration < 500,
        'broadcasters: tem dados': (r) => {
            try {
                const body = JSON.parse(r.body);
                return Array.isArray(body) || (body.broadcasters && Array.isArray(body.broadcasters));
            } catch {
                return false;
            }
        },
    });

    errorRate.add(!success);
    broadcastersLatency.add(res.timings.duration);

    // Simula tempo de leitura do usuário (1-3s)
    sleep(1 + Math.random() * 2);
}
