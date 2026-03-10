/**
 * Setup global para testes de backend.
 * Inicia um servidor MongoDB em memória antes de todos os testes
 * e faz cleanup depois.
 *
 * Cada arquivo de teste deve importar este setup no topo:
 *   import './setup';
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod: MongoMemoryServer;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
});

afterEach(async () => {
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
    await mongod.stop();
});
