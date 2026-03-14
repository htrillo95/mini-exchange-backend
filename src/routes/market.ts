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
    orderBy: { createdAt: "asc" },
  });

  const bucketMs = intervalSeconds * 1000;
  const buckets = new Map<number, { prices: number[] }>();

  for (const t of trades) {
    const ts = t.createdAt.getTime();
    const bucketTime = Math.floor(ts / bucketMs) * bucketMs;
    const bucketSec = Math.floor(bucketTime / 1000);

    if (!buckets.has(bucketSec)) {
      buckets.set(bucketSec, { prices: [] });
    }
    buckets.get(bucketSec)!.prices.push(t.price);
  }

  const candles = Array.from(buckets.entries())
    .map(([time, { prices }]) => ({
      time,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
    }))
    .sort((a, b) => a.time - b.time);

  return res.json(candles);
});

export default router;
