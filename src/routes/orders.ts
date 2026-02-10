import { Router } from "express";
import { processOrder, trades, orderBook } from "../services/matchingEngine";
import { prisma } from "../db";

const router = Router();

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

// Remaining qty based on in-memory state:
// if order still exists in book -> that qty
// if it was removed -> it’s filled -> 0
const findRemainingQtyInBook = (id: string) => {
  const b = orderBook.buy.find((o) => o.id === id);
  if (b) return b.quantity;
  const s = orderBook.sell.find((o) => o.id === id);
  if (s) return s.quantity;
  return 0;
};

// Simple in-process serialization for requests that touch the book/DB
let queue: Promise<unknown> = Promise.resolve();
const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

router.post("/", async (req, res) => {
  return withLock(async () => {
    try {
      const { type, price, quantity } = req.body;

      // Validation
      if (!type || price == null || quantity == null) {
        return res.status(400).json({ error: "Missing fields" });
      }
      if (type !== "buy" && type !== "sell") {
        return res.status(400).json({ error: "type must be 'buy' or 'sell'" });
      }

      const order: Order = {
        id: Math.random().toString(36).substring(2, 9),
        type,
        price: Number(price),
        quantity: Number(quantity),
      };

      if (Number.isNaN(order.price) || Number.isNaN(order.quantity)) {
        return res.status(400).json({ error: "Price and quantity must be numbers" });
      }
      if (!Number.isInteger(order.quantity) || order.quantity <= 0 || order.price <= 0) {
        return res
          .status(400)
          .json({ error: "Price must be > 0 and quantity must be a positive integer" });
      }

      const originalQty = order.quantity;

      // Track trades BEFORE matching so we only save new ones
      const tradesBefore = trades.length;

      // 1) Match first (mutates order.quantity + updates in-memory orderBook)
      const result = processOrder(order);

      // Only new trades from THIS request
      const newTrades = trades.slice(tradesBefore);

      // Snapshot final qty now
      const finalQty = order.quantity;
      const status = computeStatus(originalQty, finalQty);

      // 2) Save the incoming order FINAL state + 3) trades + matched order updates in ONE transaction
      await prisma.$transaction(async (tx) => {
        // Save incoming order final state
        await tx.order.create({
          data: {
            id: order.id,
            type: order.type,
            price: order.price,
            quantity: finalQty,
            status,
          },
        });

        // Save new trades + update matched existing orders in DB
        for (const t of newTrades) {
          // Save trade row
          await tx.trade.create({
            data: {
              buyOrderId: t.buyOrderId,
              sellOrderId: t.sellOrderId,
              price: t.price,
              quantity: t.quantity,
            },
          });

          // Update both sides in DB to reflect remaining qty in the book
          const buyRemaining = findRemainingQtyInBook(t.buyOrderId);
          const sellRemaining = findRemainingQtyInBook(t.sellOrderId);

          // For existing matched orders, we treat remaining > 0 as PARTIAL
          // (Because if they were involved in a trade and still remain, they were partially filled.)
          const matchedStatus = (remaining: number): OrderStatus =>
            remaining === 0 ? "FILLED" : "PARTIAL";

          await tx.order.updateMany({
            where: { id: t.buyOrderId },
            data: {
              quantity: buyRemaining,
              status: matchedStatus(buyRemaining),
            },
          });

          await tx.order.updateMany({
            where: { id: t.sellOrderId },
            data: {
              quantity: sellRemaining,
              status: matchedStatus(sellRemaining),
            },
          });
        }
      });

      // IMPORTANT: respond with ONLY the new trades (not the whole global list)
      return res.json({
        success: true,
        order: { ...order, quantity: finalQty, status },
        orderBook: result.orderBook,
        trades: newTrades,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  });
});

// Health check
router.get("/", (_req, res) => {
  res.json({ message: "Orders API endpoint is working" });
});

// In-memory trades (debug)
router.get("/trades", (_req, res) => {
  res.json(trades);
});

// DB trades
router.get("/trades/db", async (_req, res) => {
  const dbTrades = await prisma.trade.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json(dbTrades);
});

// In-memory live book (debug / realtime feel)
router.get("/book", (_req, res) => {
  res.json(orderBook);
});

// DB orders
router.get("/db", async (_req, res) => {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

// Cancel order by ID
router.delete("/:id", async (req, res) => {
  return withLock(async () => {
    const { id } = req.params;

    // Check current status in DB first
    const existing = await prisma.order.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Order not found", id });
    }

    if (existing.status === "FILLED") {
      return res
        .status(400)
        .json({ success: false, message: "Cannot cancel a FILLED order", id });
    }

    // remove from in-memory book (so /book updates instantly)
    const buyIndex = orderBook.buy.findIndex((o) => o.id === id);
    const sellIndex = orderBook.sell.findIndex((o) => o.id === id);
    if (buyIndex !== -1) orderBook.buy.splice(buyIndex, 1);
    if (sellIndex !== -1) orderBook.sell.splice(sellIndex, 1);

    // mark canceled in DB
    const updated = await prisma.order.updateMany({
      where: { id },
      data: { status: "CANCELED", quantity: 0 },
    });

    if (updated.count === 0) {
      return res.status(404).json({ success: false, message: "Order not found", id });
    }

    return res.json({ success: true, message: "Order canceled", id });
  });
});

export default router;