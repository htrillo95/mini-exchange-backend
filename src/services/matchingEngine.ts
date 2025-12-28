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
      // find sell priced <= buy
      const matchIndex = orderBook.sell.findIndex((sell) => sell.price <= newOrder.price);
  
      if (matchIndex !== -1) {
        const match = orderBook.sell[matchIndex];
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
  
        if (match.quantity <= 0) orderBook.sell.splice(matchIndex, 1);
        if (newOrder.quantity > 0) orderBook.buy.push(newOrder);
      } else {
        orderBook.buy.push(newOrder);
      }
    } else {
      // find buy priced >= sell
      const matchIndex = orderBook.buy.findIndex((buy) => buy.price >= newOrder.price);
  
      if (matchIndex !== -1) {
        const match = orderBook.buy[matchIndex];
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
  
        if (match.quantity <= 0) orderBook.buy.splice(matchIndex, 1);
        if (newOrder.quantity > 0) orderBook.sell.push(newOrder);
      } else {
        orderBook.sell.push(newOrder);
      }
    }
  
    console.log(`[STATE] Book now has ${orderBook.buy.length} buys & ${orderBook.sell.length} sells`);
  
    return {
      orderBook,
      newTrades,    // only trades from THIS request
      orderUpdates, // which resting orders changed
    };
  }
  
  export { trades, orderBook };