import Order from '../models/Order';

/**
 * Nº de pedidos 'completed' distintos que incluíram cada emissora.
 *
 * `items.broadcasterId` é String no schema do Order — a comparação usa strings
 * (comparar com ObjectId não casaria por diferença de tipo BSON). Um pedido com
 * vários itens da mesma emissora conta 1x ($addToSet no _id do pedido).
 *
 * Emissoras sem pedidos completed simplesmente não aparecem no mapa; o front
 * trata a ausência como 0.
 */
export async function campaignCountsByBroadcaster(
  broadcasterIds: Array<string | { toString(): string }>
): Promise<Record<string, number>> {
  const ids = broadcasterIds.map((id) => String(id));
  if (ids.length === 0) return {};

  const rows = await Order.aggregate([
    { $match: { status: 'completed', 'items.broadcasterId': { $in: ids } } },
    { $unwind: '$items' },
    { $match: { 'items.broadcasterId': { $in: ids } } },
    { $group: { _id: '$items.broadcasterId', orders: { $addToSet: '$_id' } } },
    { $project: { count: { $size: '$orders' } } },
  ]);

  const out: Record<string, number> = {};
  for (const r of rows) out[String(r._id)] = r.count;
  return out;
}
