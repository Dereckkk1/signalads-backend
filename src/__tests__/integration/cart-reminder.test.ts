/**
 * Integration Tests — Lembrete de carrinho abandonado (cron job)
 * Testa runCartReminderJob diretamente (não o agendador).
 */

import '../helpers/mocks';

import mongoose from 'mongoose';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser } from '../helpers/authHelper';
import { Cart } from '../../models/Cart';
import * as emailService from '../../services/emailService';
import { runCartReminderJob } from '../../cron/cartReminder';

beforeAll(connectTestDB);
afterEach(async () => { await clearTestDB(); jest.clearAllMocks(); });
afterAll(disconnectTestDB);

const makeItem = () => ({
  productId: new mongoose.Types.ObjectId(),
  productName: 'Spot',
  productSchedule: '06:00-12:00',
  broadcasterId: new mongoose.Types.ObjectId(),
  broadcasterName: 'Rádio X',
  price: 100,
  quantity: 2,
});

it('envia lembrete para carrinho parado há 24h+ e marca reminderSentAt', async () => {
  const { user } = await createAdvertiser();
  await Cart.create({ userId: user._id, items: [makeItem()] });
  const old = new Date(Date.now() - 26 * 3600 * 1000);
  await Cart.collection.updateMany({}, { $set: { updatedAt: old } }); // vence o timestamps automático

  await runCartReminderJob();

  expect(emailService.sendCartReminder).toHaveBeenCalledTimes(1);
  const cart = await Cart.findOne({ userId: user._id });
  expect(cart!.reminderSentAt).toBeTruthy();
});

it('não envia para carrinho vazio, recente ou já lembrado', async () => {
  const old = new Date(Date.now() - 26 * 3600 * 1000);
  const a = await createAdvertiser();
  await Cart.create({ userId: a.user._id, items: [] });                    // vazio
  const b = await createAdvertiser();
  await Cart.create({ userId: b.user._id, items: [makeItem()] });          // recente (updatedAt = agora)
  const c = await createAdvertiser();
  await Cart.create({ userId: c.user._id, items: [makeItem()], reminderSentAt: new Date() }); // já lembrado
  await Cart.collection.updateOne({ userId: c.user._id }, { $set: { updatedAt: old } });

  await runCartReminderJob();

  expect(emailService.sendCartReminder).not.toHaveBeenCalled();
});
