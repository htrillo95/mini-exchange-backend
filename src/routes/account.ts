import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware.js";
import { prisma } from "../db.js";

const router = Router();

router.get("/account", requireAuth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { balance: true },
  });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json({ balance: user.balance });
});

router.get("/account/positions", requireAuth, async (req: AuthRequest, res) => {
  const positions = await prisma.position.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
    select: { symbol: true, quantity: true, avgPrice: true },
  });
  return res.json(
    positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      avgPrice: p.avgPrice,
    }))
  );
});

export default router;
