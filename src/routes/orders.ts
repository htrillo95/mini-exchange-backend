import { Router } from "express";
import { processOrder, trades, orderBook } from "../services/matchingEngine.js";
import { prisma } from "../db.js";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware.js";
import { broadcast, getClientCount } from "../services/websocket.js";

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

const findRemainingQtyInBook = (id: string) => {
  const b = orderBook.buy.find((o) => o.id === id);
  if (b) return b.quantity;
  const s = orderBook.sell.find((o) => o.id === id);
  if (s) return s.quantity;
  return 0;
};

let queue: Promise<unknown> = Promise.resolve();
const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
};

router.post("/demo", async (req, res) => {
  return withLock(async () => {
    try {
      const { type, price, quantity } = req.body;

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
        return res.status(400).json({
          error: "Price must be > 0 and quantity must be a positive integer",
        });
      }

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
            userId: null,
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

      return res.json({
        success: true,
        order: { ...order, originalQuantity: originalQty, quantity: finalQty, status },
        orderBook: result.orderBook,
        trades: newTrades,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  });
});

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  return withLock(async () => {
    try {
      const { type, price, quantity } = req.body;

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
        return res.status(400).json({
          error: "Price must be > 0 and quantity must be a positive integer",
        });
      }

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
            userId: req.user!.userId,
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

      return res.json({
        success: true,
        order: { ...order, originalQuantity: originalQty, quantity: finalQty, status },
        orderBook: result.orderBook,
        trades: newTrades,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  });
});

router.get("/", (_req, res) => {
  res.json({ message: "Orders API endpoint is working" });
});

// WebSocket status endpoint (debug)
router.get("/ws-status", (_req, res) => {
  res.json({ clients: getClientCount() });
});

router.get("/trades", (_req, res) => {
  res.json(trades);
});

router.get("/trades/db", async (req, res) => {
  const limitParam = req.query.limit;
  let limit = 50;
  if (typeof limitParam === "string") {
    const parsed = Number(limitParam);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
    }
  }

  const dbTrades = await prisma.trade.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json(dbTrades);
});

router.get("/book", (_req, res) => {
  res.json(orderBook);
});

router.get("/db", requireAuth, async (req: AuthRequest, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

router.get("/open", requireAuth, async (req: AuthRequest, res) => {
  const limitParam = req.query.limit;
  let limit = 50;
  if (typeof limitParam === "string") {
    const parsed = Number(limitParam);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
    }
  }

  const orders = await prisma.order.findMany({
    where: {
      userId: req.user!.userId,
      status: { in: ["OPEN", "PARTIAL"] },
      quantity: { gt: 0 },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json(orders);
});

router.get("/history", requireAuth, async (req: AuthRequest, res) => {
  const limitParam = req.query.limit;
  let limit = 50;
  if (typeof limitParam === "string") {
    const parsed = Number(limitParam);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
    }
  }

  const orders = await prisma.order.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json(orders);
});

router.get("/by-ids", requireAuth, async (req: AuthRequest, res) => {
  try {
    const idsParam = req.query.ids;

    if (!idsParam || typeof idsParam !== "string") {
      return res.json([]);
    }

    const ids = idsParam
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (ids.length === 0) {
      return res.json([]);
    }

    const orders = await prisma.order.findMany({
      where: {
        userId: req.user!.userId,
        id: { in: ids },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(orders);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  return withLock(async () => {
    const { id } = req.params;

    const existing = await prisma.order.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Order not found", id });
    }

    if (existing.status === "FILLED") {
      return res
        .status(400)
        .json({ success: false, message: "Cannot cancel a FILLED order", id });
    }

    const buyIndex = orderBook.buy.findIndex((o) => o.id === id);
    const sellIndex = orderBook.sell.findIndex((o) => o.id === id);
    if (buyIndex !== -1) orderBook.buy.splice(buyIndex, 1);
    if (sellIndex !== -1) orderBook.sell.splice(sellIndex, 1);

    const updated = await prisma.order.updateMany({
      where: { id, userId: req.user!.userId },
      data: { status: "CANCELED", quantity: 0 },
    });

    if (updated.count === 0) {
      return res.status(404).json({ success: false, message: "Order not found", id });
    }

    // Broadcast market update after successful cancellation
    const dbTrades = await prisma.trade.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    broadcast({
      type: "market_update",
      book: orderBook,
      trades: dbTrades,
    });

    return res.json({ success: true, message: "Order canceled", id });
  });
});

export default router;