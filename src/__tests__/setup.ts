/**
 * Setup global para testes de backend.
 * Usa MongoDB em memoria — NUNCA conecta ao banco de producao.
 *
 * SEGURANCA: O arquivo aborta imediatamente se NODE_ENV !== 'test',
 * impedindo qualquer operacao de limpeza no banco real.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────
// ENVIRONMENT VARIABLES para testes
// ─────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
process.env.REDIS_URL = ''; // Previne conexao real ao Redis

// ─────────────────────────────────────────────────────────────
// GUARDA DE SEGURANCA — nunca rodar fora do ambiente de teste
// ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
    throw new Error(
        '\n\nPERIGO: setup.ts foi importado fora do ambiente de teste!\n' +
        '   NODE_ENV atual: ' + process.env.NODE_ENV + '\n' +
        '   Este arquivo contem deleteMany() em TODAS as collections.\n' +
        '   Nunca importe setup.ts sem NODE_ENV=test.\n\n'
    );
}

let mongod: MongoMemoryServer;

beforeAll(async () => {
    // Garante desconexao de qualquer conexao existente (ex: Atlas via index.ts)
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    // Cria servidor MongoDB em memoria — completamente isolado
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);

    if (process.env.NODE_ENV !== 'test') {
        throw new Error('Conexao de teste estabelecida fora de NODE_ENV=test!');
    }
});

afterEach(async () => {
    // Dupla verificacao — nunca deletar se nao estiver no in-memory server
    // O MongoMemoryServer sempre usa 127.0.0.1 como host
    const host = mongoose.connection.host ?? '';
    const isMemoryServer = host === '127.0.0.1' || host === 'localhost';

    if (!isMemoryServer) {
        throw new Error(
            `ABORTANDO: afterEach tentou rodar deleteMany em host "${host}" ` +
            `que nao e um servidor in-memory. Verifique NODE_ENV e setup.ts.`
        );
    }

    const collections = mongoose.connection.collections;
    for (const key in collections) {
        const collection = collections[key];
        if (collection) {
            await collection.deleteMany({});
        }
    }
});

afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
        await mongod.stop();
    }
});
