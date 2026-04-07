/**
 * Test Setup
 *
 * Manages mongodb-memory-server lifecycle and Jest mocks for integration tests.
 * Import connectTestDB / disconnectTestDB / clearTestDB in your test files.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer;

/**
 * Starts an in-memory MongoDB instance and connects Mongoose to it.
 * Call this in beforeAll().
 */
export async function connectTestDB(): Promise<void> {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}

/**
 * Drops all collections. Call this in afterEach() to isolate tests.
 */
export async function clearTestDB(): Promise<void> {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key]!.deleteMany({});
  }
}

/**
 * Disconnects Mongoose and stops the in-memory server.
 * Call this in afterAll().
 */
export async function disconnectTestDB(): Promise<void> {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}
