import { Router } from "express";
import { startDemoMarket, stopDemoMarket, getDemoStatus } from "../services/demoMarket.js";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware.js";

const router = Router();

/**
 * Guard: Allow demo endpoints (no production block).
 */
function demoGuard(req: any, res: any, next: any) {
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
