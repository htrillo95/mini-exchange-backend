import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

const ALLOWED_INTERVALS = [1, 5, 15, 60] as const;
const DEFAULT_INTERVAL = 5;

type BucketAgg = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

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
  const buckets = new Map<number, BucketAgg>();

  for (const t of trades) {
    const ts = t.createdAt.getTime();
    const bucketTime = Math.floor(ts / bucketMs) * bucketMs;
    const timeSec = Math.floor(bucketTime / 1000);
    const p = t.price;
    const q = t.quantity;

    const existing = buckets.get(timeSec);
    if (!existing) {
      buckets.set(timeSec, {
        open: p,
        high: p,
        low: p,
        close: p,
        volume: q,
      });
    } else {
      if (p > existing.high) existing.high = p;
      if (p < existing.low) existing.low = p;
      existing.close = p;
      existing.volume += q;
    }
  }

  let candles = Array.from(buckets.entries())
    .map(([time, agg]) => ({
      time,
      open: agg.open,
      high: agg.high,
      low: agg.low,
      close: agg.close,
      volume: agg.volume,
    }))
    .sort((a, b) => a.time - b.time);

  if (candles.length > 300) {
    candles = candles.slice(-300);
  }

  const lastFive = candles.slice(-5);
  console.log("[market/candles] last 5 candles:", JSON.stringify(lastFive));

  return res.json(candles);
});

export default router;
