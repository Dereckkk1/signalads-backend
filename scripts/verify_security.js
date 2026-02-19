const axios = require('axios');

const BASE_URL = 'http://localhost:5000';

async function checkHeaders() {
    console.log('--- Checking Security Headers ---');
    try {
        const response = await axios.get(BASE_URL + '/health');
        const headers = response.headers;

        // Check for Helmet headers
        const securityHeaders = [
            'x-dns-prefetch-control',
            'x-frame-options',
            'strict-transport-security',
            'x-download-options',
            'x-content-type-options',
            'x-xss-protection'
        ];

        securityHeaders.forEach(header => {
            if (headers[header]) {
                console.log(`✅ ${header}: Present`);
            } else {
                if (header !== 'strict-transport-security') {
                    console.log(`⚠️ ${header}: Missing`);
                }
            }
        });

        if (headers['x-powered-by']) {
            console.log(`❌ X-Powered-By: Present (Should be hidden)`);
        } else {
            console.log(`✅ X-Powered-By: Hidden`);
        }

    } catch (error) {
        console.error('Error checking headers:', error.message);
    }
}

async function checkRateLimit() {
    console.log('\n--- Checking Rate Limiting ---');
    console.log('Sending 65 requests to /health (Limit is 60/min)...');

    let blocked = 0;

    const promises = [];
    for (let i = 0; i < 65; i++) {
        promises.push(
            axios.get(BASE_URL + '/health')
                .catch(err => {
                    if (err.response && err.response.status === 429) {
                        blocked++;
                    }
                })
        );
    }

    await Promise.all(promises);

    console.log(`Blocked requests: ${blocked}`);

    if (blocked > 0) {
        console.log('✅ Rate Limit working!');
    } else {
        console.log('❌ Rate Limit NOT working.');
    }
}

async function run() {
    await checkHeaders();
    await checkRateLimit();
}

run();
