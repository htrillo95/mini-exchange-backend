import { processOrder, trades, orderBook } from "./matchingEngine.js";
import { prisma } from "../db.js";
import { broadcast } from "./websocket.js";
import { applyTradeAccounting } from "./portfolioAccounting.js";

type Order = {
  id: string;
  type: "buy" | "sell";
  price: number;
  quantity: number;
};

type OrderStatus = "OPEN" | "PARTIAL" | "FILLED" | "CANCELED";

const computeStatus = (originalQty: number, finalQty: number): OrderStatus => {
  if (finalQty <= 0) return "FILLED";
  if (finalQty < originalQty) return "PARTIAL";
  return "OPEN";
};

const findRemainingQtyInBook = (id: string) => {
  const b = orderBook.buy.find((o) => o.id === id);
  if (b) return b.quantity;
  const s = orderBook.sell.find((o) => o.id === id);
  if (s) return s.quantity;
  return 0;
};

let intervalRef: NodeJS.Timeout | null = null;
let cleanupRef: NodeJS.Timeout | null = null;
let isRunning = false;

/** Steady cadence: evenly spaced ticks (no burst clustering). */
const DEMO_TICK_MS = 120;

let demoDiagnosticsTick = 0;

// Simple in-process serialization (same pattern as orders.ts)
let queue: Promise<unknown> = Promise.resolve();
const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
};

/**
 * Calculate market midpoint from last 20 trades, or default to 10.0
 */
async function getMarketMidpoint(): Promise<number> {
  const recentTrades = await prisma.trade.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  if (recentTrades.length === 0) {
    return 10.0;
  }

  const avgPrice =
    recentTrades.reduce((sum, t) => sum + t.price, 0) / recentTrades.length;
  return avgPrice;
}

/**
 * Get best bid and ask from order book for marketable pricing
 */
function getBestBidAsk(): { bestBid: number | null; bestAsk: number | null } {
  const bestBid = orderBook.buy.length > 0
    ? Math.max(...orderBook.buy.map((o) => o.price))
    : null;
  const bestAsk = orderBook.sell.length > 0
    ? Math.min(...orderBook.sell.map((o) => o.price))
    : null;
  return { bestBid, bestAsk };
}

/**
 * Periodic diagnostics: trade price diversity + synthetic 5s candle buckets (debug only).
 */
async function logMarketDiagnostics(): Promise<void> {
  try {
    const bucketMs = 5000;
    const recent = await prisma.trade.findMany({
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const last50 = recent.slice(-50);
    const prices = last50.map((t) => t.price);
    const unique = new Set(prices.map((p) => Math.round(p * 100) / 100)).size;
    console.log(
      `[DEMO diagnostics] last ${prices.length} trade prices, ${unique} unique:`,
      prices.join(", ")
    );

    const buckets = new Map<number, number[]>();
    for (const t of recent) {
      const ts = t.createdAt.getTime();
      const bt = Math.floor(ts / bucketMs) * bucketMs;
      const bucketSec = Math.floor(bt / 1000);
      if (!buckets.has(bucketSec)) buckets.set(bucketSec, []);
      buckets.get(bucketSec)!.push(t.price);
    }
    const last10Candles = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-10)
      .map(([time, p]) => ({
        time,
        open: p[0],
        high: Math.max(...p),
        low: Math.min(...p),
        close: p[p.length - 1],
        tradesInBucket: p.length,
      }));
    console.log("[DEMO diagnostics] last 10 x 5s buckets:", JSON.stringify(last10Candles));
  } catch (e) {
    console.error("[DEMO diagnostics] error:", e);
  }
}

/**
 * Generate a synthetic order: continuous small steps from lastPrice, granular intra-candle movement.
 */
async function generateDemoOrder(): Promise<Order> {
  const lastPrice = await getMarketMidpoint();
  const { bestBid, bestAsk } = getBestBidAsk();
  const buyDepth = orderBook.buy.length;
  const sellDepth = orderBook.sell.length;

  let type: "buy" | "sell";
  if (buyDepth > sellDepth * 1.5) {
    type = "sell";
  } else if (sellDepth > buyDepth * 1.5) {
    type = "buy";
  } else {
    type = Math.random() < 0.5 ? "buy" : "sell";
  }

  const drift = (Math.random() - 0.5) * lastPrice * 0.006;
  const jitter = lastPrice * ((Math.random() - 0.5) * 0.01);
  let price = lastPrice + drift + jitter;

  const depthSkew = (Math.random() - 0.5) * lastPrice * 0.008;
  price += depthSkew;

  price = price + 0.02 * (lastPrice - price);

  const baseVolume = Math.floor(Math.random() * 8) + 1;
  const wobble = Math.abs(drift) + Math.abs(jitter);
  let quantity = baseVolume + Math.floor((wobble / Math.max(lastPrice, 0.01)) * 30);
  quantity = Math.max(1, Math.min(50, quantity));

  const impactFactor = 0.002;
  price += type === "buy" ? quantity * impactFactor : -quantity * impactFactor;

  const bandClamp = Math.max(lastPrice * 0.06, 0.35);
  price = Math.min(price, lastPrice + bandClamp);
  price = Math.max(price, lastPrice - bandClamp);
  price = Math.max(price, 0.5);

  if (Math.random() < 0.55) {
    if (type === "buy" && bestAsk !== null) {
      price = bestAsk + Math.random() * 0.06;
    } else if (type === "sell" && bestBid !== null) {
      price = Math.max(0.5, bestBid - Math.random() * 0.06);
    } else if (type === "buy") {
      price = lastPrice + Math.random() * lastPrice * 0.008;
    } else {
      price = Math.max(0.5, lastPrice - Math.random() * lastPrice * 0.008);
    }
    price = Math.min(price, lastPrice + bandClamp);
    price = Math.max(price, lastPrice - bandClamp);
    price = Math.max(price, 0.5);
  }

  price += (Math.random() - 0.5) * 0.02;

  return {
    id: `demo_${Math.random().toString(36).substring(2, 9)}`,
    type,
    price: Math.round(price * 100) / 100,
    quantity,
  };
}

/**
 * Process a demo order (reuses existing order creation logic)
 */
async function processDemoOrder(order: Order): Promise<void> {
  return withLock(async () => {
    const originalQty = order.quantity;
    const tradesBefore = trades.length;

    const result = processOrder(order);
    const newTrades = trades.slice(tradesBefore);
    const finalQty = order.quantity;
    const status = computeStatus(originalQty, finalQty);

    await prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id: order.id,
          type: order.type,
          price: order.price,
          originalQuantity: originalQty,
          quantity: finalQty,
          status,
          userId: null, // Demo orders have no user
        },
      });

      for (const t of newTrades) {
        await tx.trade.create({
          data: {
            buyOrderId: t.buyOrderId,
            sellOrderId: t.sellOrderId,
            price: t.price,
            quantity: t.quantity,
          },
        });

        const buyRemaining = findRemainingQtyInBook(t.buyOrderId);
        const sellRemaining = findRemainingQtyInBook(t.sellOrderId);

        const matchedStatus = (remaining: number): OrderStatus =>
          remaining === 0 ? "FILLED" : "PARTIAL";

        await tx.order.updateMany({
          where: { id: t.buyOrderId },
          data: { quantity: buyRemaining, status: matchedStatus(buyRemaining) },
        });

        await tx.order.updateMany({
          where: { id: t.sellOrderId },
          data: { quantity: sellRemaining, status: matchedStatus(sellRemaining) },
        });

        await applyTradeAccounting(tx, t);
      }
    });

    // Broadcast market update after successful transaction
    const dbTrades = await prisma.trade.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    broadcast({
      type: "market_update",
      book: orderBook,
      trades: dbTrades,
    });
  });
}

/**
 * Demo market tick - generates and processes one order
 */
async function demoMarketTick(): Promise<void> {
  try {
    const order = await generateDemoOrder();
    await processDemoOrder(order);
    console.log(`[DEMO] Generated ${order.type} order: ${order.quantity} @ $${order.price}`);
    demoDiagnosticsTick += 1;
    if (demoDiagnosticsTick % 25 === 0) {
      await logMarketDiagnostics();
    }
  } catch (error) {
    console.error("[DEMO] Error in market tick:", error);
  }
}

/**
 * One tick every DEMO_TICK_MS — continuous, even flow (no bursts).
 */
function scheduleNextTick(): void {
  if (!isRunning) return;

  intervalRef = setTimeout(() => {
    demoMarketTick().then(() => scheduleNextTick());
  }, DEMO_TICK_MS);
}

/**
 * Cleanup demo data older than 24 hours
 * Safe: parameterized queries, deletes trades before orders to avoid FK constraints
 */
async function cleanupOldDemoData(): Promise<void> {
  try {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Delete trades FIRST (before orders) to avoid foreign key constraint issues
    // Use parameterized query for safety
    const deletedTradesResult = await prisma.$executeRaw`
      DELETE FROM "Trade"
      WHERE ("buyOrderId" LIKE 'demo_%' OR "sellOrderId" LIKE 'demo_%')
      AND "createdAt" < ${twentyFourHoursAgo}
    `;

    // Then delete demo orders older than 24 hours
    // Use parameterized query for safety
    const deletedOrdersResult = await prisma.$executeRaw`
      DELETE FROM "Order"
      WHERE id LIKE 'demo_%' AND "createdAt" < ${twentyFourHoursAgo}
    `;

    const deletedOrders = typeof deletedOrdersResult === 'number' ? deletedOrdersResult : 0;
    const deletedTrades = typeof deletedTradesResult === 'number' ? deletedTradesResult : 0;

    if (deletedOrders > 0 || deletedTrades > 0) {
      console.log(
        `[DEMO] Cleanup: Deleted ${deletedOrders} orders and ${deletedTrades} trades older than 24h`
      );
    }
  } catch (error) {
    console.error("[DEMO] Error during cleanup:", error);
  }
}

/**
 * Start the demo market loop with random intervals and cleanup
 */
export function startDemoMarket(): void {
  if (isRunning) {
    return;
  }

  isRunning = true;
  demoDiagnosticsTick = 0;

  // Start first tick immediately
  demoMarketTick().then(() => scheduleNextTick());

  // Start cleanup interval (every 10 minutes)
  cleanupRef = setInterval(() => {
    cleanupOldDemoData();
  }, 10 * 60 * 1000); // 10 minutes

  // Run initial cleanup
  cleanupOldDemoData();

  console.log("[DEMO] Demo market started");
}

/**
 * Stop the demo market loop
 */
export function stopDemoMarket(): void {
  if (!isRunning) {
    return;
  }

  if (intervalRef) {
    clearTimeout(intervalRef);
    intervalRef = null;
  }

  if (cleanupRef) {
    clearInterval(cleanupRef);
    cleanupRef = null;
  }

  isRunning = false;
  console.log("[DEMO] Demo market stopped");
}

/**
 * Get demo market status
 */
export function getDemoStatus(): { running: boolean } {
  return { running: isRunning };
}
