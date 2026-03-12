const SYMBOL = "DEMO";

// Transaction client from prisma.$transaction (has order, user, position, trade)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type TradeRecord = {
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  quantity: number;
};

/**
 * Apply portfolio accounting for one trade: update buyer/seller balance and positions.
 * Must run inside a Prisma transaction. Throws if seller has insufficient position.
 */
export async function applyTradeAccounting(
  tx: Tx,
  trade: TradeRecord
): Promise<void> {
  const { buyOrderId, sellOrderId, price, quantity } = trade;
  const amount = price * quantity;

  const [buyOrder, sellOrder] = await Promise.all([
    tx.order.findUnique({ where: { id: buyOrderId }, select: { userId: true } }),
    tx.order.findUnique({ where: { id: sellOrderId }, select: { userId: true } }),
  ]);

  const buyerId = buyOrder?.userId ?? null;
  const sellerId = sellOrder?.userId ?? null;

  // BUY side: decrease balance, update or create position
  if (buyerId) {
    await tx.user.update({
      where: { id: buyerId },
      data: { balance: { decrement: amount } },
    });

    const existing = await tx.position.findFirst({
      where: { userId: buyerId, symbol: SYMBOL },
    });

    if (existing) {
      const newQuantity = existing.quantity + quantity;
      const newAvgPrice =
        (existing.quantity * existing.avgPrice + quantity * price) / newQuantity;
      await tx.position.update({
        where: { id: existing.id },
        data: { quantity: newQuantity, avgPrice: newAvgPrice },
      });
    } else {
      await tx.position.create({
        data: {
          userId: buyerId,
          symbol: SYMBOL,
          quantity,
          avgPrice: price,
        },
      });
    }
  }

  // SELL side: check position, increase balance, update or delete position
  if (sellerId) {
    const position = await tx.position.findFirst({
      where: { userId: sellerId, symbol: SYMBOL },
    });

    if (!position || position.quantity < quantity) {
      throw new Error("Insufficient position to sell");
    }

    await tx.user.update({
      where: { id: sellerId },
      data: { balance: { increment: amount } },
    });

    const newQuantity = position.quantity - quantity;
    if (newQuantity === 0) {
      await tx.position.delete({ where: { id: position.id } });
    } else {
      await tx.position.update({
        where: { id: position.id },
        data: { quantity: newQuantity },
      });
    }
  }
}
