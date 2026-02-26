import { processOrder, trades, orderBook } from "./matchingEngine.js";
import { prisma } from "../db.js";
import { broadcast } from "./websocket.js";

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
let inBurst = false;
let lastBurstTime = 0;
const BURST_COOLDOWN_MS = 30000; // 30 seconds minimum between bursts

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
 * Generate a synthetic order with realistic volatility and marketable bias
 */
async function generateDemoOrder(): Promise<Order> {
  const midpoint = await getMarketMidpoint();
  const { bestBid, bestAsk } = getBestBidAsk();
  const type = Math.random() > 0.5 ? "buy" : "sell";

  // Price jitter: ±2-4% normally, 10% chance of ±8% spike
  const isSpike = Math.random() < 0.1;
  const jitterRange = isSpike ? 0.08 : 0.02 + Math.random() * 0.02; // 2-4% or 8%
  const jitter = (Math.random() - 0.5) * 2 * jitterRange * midpoint;
  let price = Math.max(0.01, midpoint + jitter);

  // Bias orders to be marketable (70% chance to price aggressively)
  if (Math.random() < 0.7) {
    if (type === "buy" && bestAsk !== null) {
      // Price buy order at or above best ask to match
      price = Math.max(price, bestAsk);
    } else if (type === "sell" && bestBid !== null) {
      // Price sell order at or below best bid to match
      price = Math.min(price, bestBid);
    }
  }

  const quantity = Math.floor(Math.random() * 8) + 1; // 1-8

  return {
    id: `demo_${Math.random().toString(36).substring(2, 9)}`,
    type,
    price: Math.round(price * 100) / 100, // Round to 2 decimals
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
  } catch (error) {
    console.error("[DEMO] Error in market tick:", error);
  }
}

/**
 * Execute a burst of rapid orders (3-5 orders at 150-300ms intervals)
 * Rate limited to prevent excessive DB writes
 */
async function executeBurst(): Promise<void> {
  const now = Date.now();
  if (now - lastBurstTime < BURST_COOLDOWN_MS) {
    // Rate limit: skip burst if too soon after last one
    return;
  }

  inBurst = true;
  lastBurstTime = now;
  const burstCount = 3 + Math.floor(Math.random() * 3); // 3-5 orders

  for (let i = 0; i < burstCount; i++) {
    await demoMarketTick();
    if (i < burstCount - 1) {
      // Wait 150-300ms between burst orders
      const delay = 150 + Math.random() * 150;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  inBurst = false;
}

/**
 * Schedule next tick with random interval (2000-4000ms) or burst behavior
 * Reduced frequency to lower DB write load
 */
function scheduleNextTick(): void {
  if (!isRunning) return;

  // 15% chance to enter burst mode (rate limited)
  if (!inBurst && Math.random() < 0.15) {
    executeBurst().then(() => {
      // After burst, schedule next normal tick
      const intervalMs = 2000 + Math.random() * 2000; // 2000-4000ms
      intervalRef = setTimeout(() => {
        demoMarketTick().then(() => scheduleNextTick());
      }, intervalMs);
    });
  } else {
    // Normal tick with random interval (reduced frequency)
    const intervalMs = 2000 + Math.random() * 2000; // 2000-4000ms
    intervalRef = setTimeout(() => {
      demoMarketTick().then(() => scheduleNextTick());
    }, intervalMs);
  }
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
  inBurst = false;
  lastBurstTime = 0;

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
  inBurst = false;
  console.log("[DEMO] Demo market stopped");
}

/**
 * Get demo market status
 */
export function getDemoStatus(): { running: boolean } {
  return { running: isRunning };
}
