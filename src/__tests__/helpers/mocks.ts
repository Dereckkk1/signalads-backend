/**
 * Jest mocks for external dependencies.
 *
 * MUST be called before importing any app code (at the top of test files
 * or in a jest.setup file). jest.mock() calls are hoisted automatically.
 */

// ------------------------------------------------------------------
// Redis mock — all cache operations become no-ops returning null.
// ------------------------------------------------------------------
jest.mock('../../config/redis', () => ({
  redis: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []]),
    status: 'ready',
    call: jest.fn().mockResolvedValue(null),
    on: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  },
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  cacheInvalidate: jest.fn().mockResolvedValue(undefined),
  getRedisHealth: jest.fn().mockResolvedValue({ status: 'connected', latencyMs: 1 }),
}));

// ------------------------------------------------------------------
// Rate limit store mock — in test env, use in-memory store (default).
// ------------------------------------------------------------------
jest.mock('../../config/rateLimitStore', () => ({
  createRedisStore: jest.fn().mockReturnValue(undefined), // undefined = uses default memory store
}));

// ------------------------------------------------------------------
// express-rate-limit mock — no-op em testes para evitar 429
// (MemoryStore default persiste contagem entre testes do mesmo worker).
// Nenhum teste asserta comportamento de rate limit (429); o lockout
// de 2FA e application-level, nao framework-level.
// ------------------------------------------------------------------
jest.mock('express-rate-limit', () => {
  const noopMiddleware = (_req: any, _res: any, next: any) => next();
  const factory: any = () => noopMiddleware;
  factory.ipKeyGenerator = (ip: string) => ip || 'unknown';
  return {
    __esModule: true,
    default: factory,
    ipKeyGenerator: factory.ipKeyGenerator,
  };
});

// ------------------------------------------------------------------
// Email service mock — all email functions are silent no-ops.
// ------------------------------------------------------------------
jest.mock('../../services/emailService', () => {
  const noop = jest.fn().mockResolvedValue(undefined);
  const createEmailTemplate = jest.fn().mockReturnValue('<html>mock</html>');
  const sendEmail = jest.fn().mockResolvedValue({ success: true, messageId: 'mock-id' });
  const templateNoop = jest.fn().mockReturnValue('');
  const namedExports = {
    sendEmailConfirmation: noop,
    sendPasswordResetEmail: noop,
    sendTwoFactorEnableEmail: noop,
    sendTwoFactorLoginEmail: noop,
    sendTwoFactorCodeEmail: noop,
    sendNewOrderToBroadcaster: noop,
    sendOrderConfirmationToClient: noop,
    sendOrderApprovedToClient: noop,
    sendOrderRejectedToClient: noop,
    sendOrderCancelledToClient: noop,
    sendOrderReceivedToClient: noop,
    sendNewOrderToAdmin: noop,
    sendOrderPendingPaymentToClient: noop,
    sendOrderPaidConfirmedToClient: noop,
    sendOrderInProductionToClient: noop,
    sendOrderCancelledByAdminToClient: noop,
    sendMaterialRejectedByBroadcaster: noop,
    sendMaterialProducedByBroadcaster: noop,
    sendMaterialApprovedByClient: noop,
    sendMaterialRejectedByClient: noop,
    sendBillingPendingValidation: noop,
    sendBillingAdminNotification: noop,
    sendBillingApproved: noop,
    sendBillingRejected: noop,
    sendInvoiceIssued: noop,
    sendPaymentReminder: noop,
    sendBroadcasterInvoiceRequest: noop,
    sendBillingOrderToBroadcaster: noop,
    sendPaymentConfirmed: noop,
    sendQuoteConfirmationToClient: noop,
    sendQuoteRequestToAdmin: noop,
    sendSalesTeamInvite: noop,
    sendEmail,
    createEmailTemplate,
    greeting: templateNoop,
    paragraph: templateNoop,
    infoCard: templateNoop,
    alertCard: templateNoop,
    list: templateNoop,
    divider: templateNoop,
  };
  return {
    __esModule: true,
    ...namedExports,
    default: { ...namedExports },
  };
});

// ------------------------------------------------------------------
// GCS (Google Cloud Storage) mock — never uploads in tests.
// ------------------------------------------------------------------
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({
        createWriteStream: jest.fn().mockReturnValue({
          on: jest.fn(),
          end: jest.fn(),
        }),
        delete: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  })),
}));

// ------------------------------------------------------------------
// OpenAI mock — never calls external API.
// ------------------------------------------------------------------
jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'mock response' } }],
        }),
      },
    },
  }));
  return { __esModule: true, default: MockOpenAI };
});

// ------------------------------------------------------------------
// Metrics middleware — keep it but suppress batch writes to MongoDB.
// We do NOT mock the middleware itself (it's harmless in tests),
// only prevent the setInterval from firing.
// ------------------------------------------------------------------

export {};
