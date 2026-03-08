import { Router } from "express";
import { startDemoMarket, stopDemoMarket, getDemoStatus } from "../services/demoMarket.js";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware.js";

const router = Router();
const NODE_ENV = process.env.NODE_ENV || "development";

/**
 * Guard: Block demo endpoints in production OR require auth
 */
function demoGuard(req: any, res: any, next: any) {
  if (NODE_ENV === "production") {
    return res.status(403).json({
      error: "Demo market is disabled in production",
    });
  }
  // In development, allow without auth (or you can require auth here)
  next();
}

router.post("/start", demoGuard, (req, res) => {
  startDemoMarket();
  res.json({ success: true, message: "Demo market started" });
});

router.post("/stop", demoGuard, (req, res) => {
  stopDemoMarket();
  res.json({ success: true, message: "Demo market stopped" });
});

router.get("/status", demoGuard, (req, res) => {
  const status = getDemoStatus();
  res.json(status);
});

export default router;
