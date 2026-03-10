/**
 * k6 Stress Test — Endpoints de pagamento (PIX + Wallet)
 * Mais restritivo: pagamentos afetam cobranças reais.
 * 
 * Executar:
 *   k6 run --env API_URL=http://localhost:5000/api ^
 *           --env TEST_EMAIL=perf@test.com ^
 *           --env TEST_PASS=Senha@123 ^
 *           k6/payment-stress.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const paymentErrorRate = new Rate('payment_errors');
const walletLatency = new Trend('wallet_duration', true);

export const options = {
    // Stress gradual — pagamentos têm menos tolerância para erros
    stages: [
        { duration: '20s', target: 5 },
        { duration: '1m', target: 15 },
        { duration: '30s', target: 25 },
        { duration: '20s', target: 0 },
    ],
    thresholds: {
        // Integração externa (Asaas) — aceita latência maior
        http_req_duration: ['p(95)<3000', 'p(99)<5000'],
        // Taxa de erro muito baixa para área financeira
        http_req_failed: ['rate<0.005'],
        payment_errors: ['rate<0.005'],
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:5000/api';

export function setup() {
    const loginRes = http.post(
        `${BASE_URL}/auth/login`,
        JSON.stringify({ emailOrCnpj: __ENV.TEST_EMAIL, password: __ENV.TEST_PASS }),
        { headers: { 'Content-Type': 'application/json' } }
    );
    return { token: loginRes.json('token') };
}

export default function (data) {
    const headers = {
        'Authorization': `Bearer ${data.token}`,
        'Content-Type': 'application/json',
    };

    // ── Cenário 1: Consultar saldo da wallet ──
    const walletRes = http.get(`${BASE_URL}/wallet/balance`, { headers });

    const walletOk = check(walletRes, {
        'wallet/balance: status 200 ou 404': (r) => [200, 404].includes(r.status),
        'wallet/balance: tempo < 500ms': (r) => r.timings.duration < 500,
    });

    walletLatency.add(walletRes.timings.duration);
    paymentErrorRate.add(!walletOk);

    // ── Cenário 2: Histórico de transações ──
    const historyRes = http.get(`${BASE_URL}/wallet/transactions?page=1&limit=10`, { headers });

    check(historyRes, {
        'wallet/transactions: status 200 ou 404': (r) => [200, 404].includes(r.status),
        'wallet/transactions: tempo < 800ms': (r) => r.timings.duration < 800,
    });

    sleep(2); // Espaçar mais em pagamentos para não saturar o gateway externo
}
