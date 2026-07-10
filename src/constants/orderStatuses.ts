/**
 * Status de pedido que exigem ação do time admin.
 * Fonte única de verdade para os badges de "pendentes" (sidebar, dashboard,
 * header da gestão de pedidos) — evita contagens divergentes entre telas.
 */
export const ATTENTION_STATUSES = [
  'pending_contact',
  'pending_payment',
  'awaiting_payment',
  'paid',
  'pending_approval',
  'pending_billing_validation',
] as const;

export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];
