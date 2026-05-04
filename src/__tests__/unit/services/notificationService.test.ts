import '../../helpers/mocks';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../../helpers/setup';
import { createTestUser } from '../../helpers/authHelper';
import { shouldSendNotification } from '../../../services/notificationService';

beforeAll(async () => {
  await connectTestDB();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

describe('shouldSendNotification', () => {
  it('retorna true quando preferencia esta ligada (default)', async () => {
    const user = await createTestUser({ userType: 'admin' });
    const result = await shouldSendNotification(user._id.toString(), 'newOrders');
    expect(result).toBe(true);
  });

  it('retorna false quando preferencia esta desligada', async () => {
    const user = await createTestUser({ userType: 'admin' });
    user.set('notificationPreferences', { newOrders: false });
    await user.save();
    const result = await shouldSendNotification(user._id.toString(), 'newOrders');
    expect(result).toBe(false);
  });

  it('retorna true (fail-open) quando user nao existe', async () => {
    const result = await shouldSendNotification('507f1f77bcf86cd799439011', 'newOrders');
    expect(result).toBe(true);
  });

  it('retorna true quando o campo notificationPreferences nao existe (legacy users)', async () => {
    const user = await createTestUser({ userType: 'agency' });
    // simula user legado sem o campo
    await user.collection.updateOne(
      { _id: user._id },
      { $unset: { notificationPreferences: '' } }
    );
    const result = await shouldSendNotification(user._id.toString(), 'ownOrderUpdates');
    expect(result).toBe(true);
  });

  it('retorna true quando a key especifica nao esta seteada (preferencias parciais)', async () => {
    const user = await createTestUser({ userType: 'admin' });
    user.set('notificationPreferences', { newOrders: false });
    await user.save();
    const result = await shouldSendNotification(user._id.toString(), 'ownOrderUpdates');
    expect(result).toBe(true);
  });
});
