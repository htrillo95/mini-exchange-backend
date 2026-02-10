type Order = {
  id: string;
  type: "buy" | "sell";
  price: number;
  quantity: number;
};

type Trade = {
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  quantity: number;
};

// -- In-memory data --
const orderBook: { buy: Order[]; sell: Order[] } = { buy: [], sell: [] };
const trades: Trade[] = [];

type OrderUpdate = {
  id: string;
  quantity: number;
};

export function processOrder(newOrder: Order) {
  console.log(
    `[NEW] ${newOrder.type.toUpperCase()} ${newOrder.id} — ${newOrder.quantity} @ $${newOrder.price}`
  );

  const newTrades: Trade[] = [];
  const orderUpdates: OrderUpdate[] = []; // which EXISTING order got changed

  if (newOrder.type === "buy") {
    // BUY: repeatedly match with best-priced sell where sell.price <= buy.price
    while (newOrder.quantity > 0) {
      let bestIndex = -1;
      let bestPrice = Infinity;

      for (let i = 0; i < orderBook.sell.length; i++) {
        const candidate = orderBook.sell[i];
        if (candidate.price <= newOrder.price && candidate.price < bestPrice) {
          bestPrice = candidate.price;
          bestIndex = i;
        }
      }

      if (bestIndex === -1) break; // no more matches

      const match = orderBook.sell[bestIndex];
      const tradeQty = Math.min(newOrder.quantity, match.quantity);

      console.log(`[MATCH] Found match with ${match.id} — ${tradeQty} units @ $${match.price}`);

      const trade: Trade = {
        buyOrderId: newOrder.id,
        sellOrderId: match.id,
        price: match.price,
        quantity: tradeQty,
      };

      trades.push(trade);
      newTrades.push(trade);

      // mutate quantities (in-memory)
      match.quantity -= tradeQty;
      newOrder.quantity -= tradeQty;

      // record update for the resting order (match)
      orderUpdates.push({ id: match.id, quantity: Math.max(match.quantity, 0) });

      if (match.quantity <= 0) {
        orderBook.sell.splice(bestIndex, 1);
      }
    }

    // If anything remains, it becomes a new resting BUY
    if (newOrder.quantity > 0) {
      orderBook.buy.push(newOrder);
    }
  } else {
    // SELL: repeatedly match with best-priced buy where buy.price >= sell.price
    while (newOrder.quantity > 0) {
      let bestIndex = -1;
      let bestPrice = -Infinity;

      for (let i = 0; i < orderBook.buy.length; i++) {
        const candidate = orderBook.buy[i];
        if (candidate.price >= newOrder.price && candidate.price > bestPrice) {
          bestPrice = candidate.price;
          bestIndex = i;
        }
      }

      if (bestIndex === -1) break; // no more matches

      const match = orderBook.buy[bestIndex];
      const tradeQty = Math.min(newOrder.quantity, match.quantity);

      console.log(`[MATCH] Found match with ${match.id} — ${tradeQty} units @ $${match.price}`);

      const trade: Trade = {
        buyOrderId: match.id,
        sellOrderId: newOrder.id,
        price: newOrder.price,
        quantity: tradeQty,
      };

      trades.push(trade);
      newTrades.push(trade);

      // mutate quantities (in-memory)
      match.quantity -= tradeQty;
      newOrder.quantity -= tradeQty;

      // record update for the resting order (match)
      orderUpdates.push({ id: match.id, quantity: Math.max(match.quantity, 0) });

      if (match.quantity <= 0) {
        orderBook.buy.splice(bestIndex, 1);
      }
    }

    // If anything remains, it becomes a new resting SELL
    if (newOrder.quantity > 0) {
      orderBook.sell.push(newOrder);
    }
  }

  console.log(`[STATE] Book now has ${orderBook.buy.length} buys & ${orderBook.sell.length} sells`);

  return {
    orderBook,
    newTrades, // only trades from THIS request
    orderUpdates, // which resting orders changed
  };
}

export { trades, orderBook };