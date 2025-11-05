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
  
  // --- In-memory data --- remeber state concepts
  const orderBook: { buy: Order[]; sell: Order[] } = { buy: [], sell: [] };
  const trades: Trade[] = [];
  
  //function & logic start here
  export function processOrder(newOrder: Order) {
    console.log(`[NEW] ${newOrder.type.toUpperCase()} ${newOrder.id} — ${newOrder.quantity} @ $${newOrder.price}`);

    if (newOrder.type === "buy") {
         // find sell priced <= buy
        const matchIndex = orderBook.sell.findIndex(
            (sell) => sell.price <= newOrder.price
        );

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
            console.log(`[TRADE] Executed BUY:${trade.buyOrderId} SELL:${trade.sellOrderId} — ${trade.quantity} units @ $${trade.price}`
              );

            match.quantity -= tradeQty;
            newOrder.quantity -= tradeQty;

            if (match.quantity <= 0) orderBook.sell.splice(matchIndex, 1);
            if (newOrder.quantity > 0) orderBook.buy.push(newOrder);
        } else {
            orderBook.buy.push(newOrder);
        }
    } else {
          // find buy priced >= sell
        const matchIndex = orderBook.buy.findIndex(
            (buy) => buy.price >= newOrder.price
        );

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

            console.log(`[TRADE] Executed BUY:${trade.buyOrderId} SELL:${trade.sellOrderId} — ${trade.quantity} units @ $${trade.price}`
              );

            match.quantity -= tradeQty;
            newOrder.quantity -= tradeQty;

            if (match.quantity <= 0) orderBook.buy.splice(matchIndex, 1);
            if (newOrder.quantity > 0) orderBook.sell.push(newOrder);
        } else { 
            orderBook.sell.push(newOrder);
        }
    }

    console.log(`[STATE] Book now has ${orderBook.buy.length} buys & ${orderBook.sell.length} sells`);

     // return updated state
    return { orderBook, trades};
}

export { trades, orderBook };