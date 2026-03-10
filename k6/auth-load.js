/**
 * k6 Load Test — POST /api/auth/login e fluxo de autenticação
 * 
 * Executar:
 *   k6 run --env API_URL=http://localhost:5000/api k6/auth-load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const loginErrorRate = new Rate('login_errors');
const loginLatency = new Trend('login_duration', true);

export const options = {
    stages: [
        { duration: '20s', target: 10 },  // Aquecimento
        { duration: '1m', target: 30 },  // Carga normal (logins simultâneos)
        { duration: '30s', target: 50 },  // Pico
        { duration: '20s', target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<1000', 'p(99)<2000'],  // Login pode ser mais lento (bcrypt)
        http_req_failed: ['rate<0.01'],
        login_errors: ['rate<0.01'],
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:5000/api';

export default function () {
    const headers = { 'Content-Type': 'application/json' };

    // ── Cenário 1: Login com credenciais válidas ──
    const loginRes = http.post(
        `${BASE_URL}/auth/login`,
        JSON.stringify({
            emailOrCnpj: __ENV.TEST_EMAIL || 'perf@test.com',
            password: __ENV.TEST_PASS || 'Senha@123',
        }),
        { headers }
    );

    const loginOk = check(loginRes, {
        'login: status 200': (r) => r.status === 200,
        'login: tem token': (r) => !!r.json('token'),
        'login: tempo < 1s': (r) => r.timings.duration < 1000,
    });

    loginErrorRate.add(!loginOk);
    loginLatency.add(loginRes.timings.duration);

    if (loginOk) {
        const token = loginRes.json('token');

        // ── Cenário 2: Buscar dados do usuário logado ──
        const meRes = http.get(`${BASE_URL}/auth/me`, {
            headers: { ...headers, Authorization: `Bearer ${token}` },
        });

        check(meRes, {
            'me: status 200': (r) => r.status === 200,
            'me: tem email': (r) => !!r.json('email'),
            'me: sem senha': (r) => !r.json('password'),
            'me: tempo < 300ms': (r) => r.timings.duration < 300,
        });
    }

    // ── Cenário 3: Tentativa com senha errada ──
    const badLoginRes = http.post(
        `${BASE_URL}/auth/login`,
        JSON.stringify({
            emailOrCnpj: __ENV.TEST_EMAIL || 'perf@test.com',
            password: 'SenhaErrada@999',
        }),
        { headers }
    );

    check(badLoginRes, {
        'bad-login: deve retornar 401': (r) => r.status === 401,
    });

    sleep(1);
}
