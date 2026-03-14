import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

const ALLOWED_INTERVALS = [1, 5, 15, 60] as const;
const DEFAULT_INTERVAL = 5;

router.get("/candles", async (req, res) => {
  const raw = req.query.interval;
  let intervalSeconds = DEFAULT_INTERVAL;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isNaN(parsed) || !ALLOWED_INTERVALS.includes(parsed as 1 | 5 | 15 | 60)) {
      return res.status(400).json({
        error: "Invalid interval",
        allowed: ALLOWED_INTERVALS,
      });
    }
    intervalSeconds = parsed;
  }

  const trades = await prisma.trade.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 10 * 60 * 1000),
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const bucketMs = intervalSeconds * 1000;
  const buckets = new Map<number, { prices: number[]; volume: number }>();

  for (const t of trades) {
    const ts = t.createdAt.getTime();
    const bucketTime = Math.floor(ts / bucketMs) * bucketMs;
    const bucketSec = Math.floor(bucketTime / 1000);

    if (!buckets.has(bucketSec)) {
      buckets.set(bucketSec, { prices: [t.price], volume: t.quantity });
    } else {
      const bucket = buckets.get(bucketSec)!;
      bucket.prices.push(t.price);
      bucket.volume += t.quantity;
    }
  }

  let candles = Array.from(buckets.entries())
    .map(([time, { prices, volume }]) => ({
      time,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume,
    }))
    .sort((a, b) => a.time - b.time);

  if (candles.length === 0) {
    const lastTrade = await prisma.trade.findFirst({
      orderBy: { createdAt: "desc" },
    });
    const nowSec = Math.floor(Date.now() / 1000);
    if (lastTrade) {
      candles = [{
        time: nowSec,
        open: lastTrade.price,
        high: lastTrade.price,
        low: lastTrade.price,
        close: lastTrade.price,
        volume: 0,
      }];
    } else {
      candles = [{
        time: nowSec,
        open: 10,
        high: 10,
        low: 10,
        close: 10,
        volume: 0,
      }];
    }
  }

  return res.json(candles);
});

export default router;
