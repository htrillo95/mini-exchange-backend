import {
  processOrder,
  trades,
  orderBook,
  getTradesWireDescending,
} from "./matchingEngine.js";
import { broadcast } from "./websocket.js";

type Order = {
  id: string;
  type: "buy" | "sell";
  price: number;
  quantity: number;
};

let intervalRef: NodeJS.Timeout | null = null;
let isRunning = false;

/** Steady cadence: evenly spaced ticks (no burst clustering). */
const DEMO_TICK_MS = 120;

let demoDiagnosticsTick = 0;

let queue: Promise<unknown> = Promise.resolve();
const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
};

/**
 * Midpoint from in-memory tape: average of last 10–20 trades, else last trade, else default.
 */
function getMarketMidpoint(): number {
  if (trades.length === 0) return 10.0;
  const n = Math.min(trades.length, 20);
  const slice = trades.slice(-n);
  if (slice.length === 1) return slice[0].price;
  return slice.reduce((sum, t) => sum + t.price, 0) / slice.length;
}

function getBestBidAsk(): { bestBid: number | null; bestAsk: number | null } {
  const bestBid = orderBook.buy.length > 0
    ? Math.max(...orderBook.buy.map((o) => o.price))
    : null;
  const bestAsk = orderBook.sell.length > 0
    ? Math.min(...orderBook.sell.map((o) => o.price))
    : null;
  return { bestBid, bestAsk };
}

function logMarketDiagnosticsMemory(): void {
  const last50 = trades.slice(-50);
  const prices = last50.map((t) => t.price);
  const unique = new Set(prices.map((p) => Math.round(p * 100) / 100)).size;
  console.log(
    `[DEMO diagnostics] last ${prices.length} trade prices (${unique} unique):`,
    prices.join(", ")
  );
}

async function generateDemoOrder(): Promise<Order> {
  const lastPrice = getMarketMidpoint();
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

async function processDemoOrder(order: Order): Promise<void> {
  return withLock(async () => {
    processOrder(order);

    const wireTrades = getTradesWireDescending(50);
    broadcast({
      type: "market_update",
      book: orderBook,
      trades: wireTrades,
    });
  });
}

async function demoMarketTick(): Promise<void> {
  try {
    const order = await generateDemoOrder();
    await processDemoOrder(order);
    console.log(`[DEMO] Generated ${order.type} order: ${order.quantity} @ $${order.price}`);
    demoDiagnosticsTick += 1;
    if (demoDiagnosticsTick % 25 === 0) {
      logMarketDiagnosticsMemory();
    }
  } catch (error) {
    console.error("[DEMO] Error in market tick:", error);
  }
}

function scheduleNextTick(): void {
  if (!isRunning) return;

  intervalRef = setTimeout(() => {
    demoMarketTick().then(() => scheduleNextTick());
  }, DEMO_TICK_MS);
}

export function startDemoMarket(): void {
  if (isRunning) {
    return;
  }

  isRunning = true;
  demoDiagnosticsTick = 0;

  demoMarketTick().then(() => scheduleNextTick());

  console.log("[DEMO] Demo market started (in-memory, no DB)");
}

export function stopDemoMarket(): void {
  if (!isRunning) {
    return;
  }

  if (intervalRef) {
    clearTimeout(intervalRef);
    intervalRef = null;
  }

  isRunning = false;
  console.log("[DEMO] Demo market stopped");
}

export function getDemoStatus(): { running: boolean } {
  return { running: isRunning };
}
