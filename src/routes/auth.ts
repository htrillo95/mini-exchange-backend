import { Router } from "express";
import { prisma } from "../db.js";
import {
  hashPassword,
  comparePassword,
  signToken,
} from "../utils/auth.js";
import { requireAuth, AuthRequest } from "../middleware/authMiddleware.js";

const router = Router();

function isDbUnavailable(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as { code?: string; message?: string };
    if (e.code === "P1001" || e.code === "P1017" || e.code === "P1008") {
      return true;
    }
    if (typeof e.message === "string") {
      const m = e.message.toLowerCase();
      return (
        m.includes("connect") ||
        m.includes("quota") ||
        m.includes("timeout") ||
        m.includes("econnrefused") ||
        m.includes("unavailable") ||
        m.includes("paused") ||
        m.includes("querying the database")
      );
    }
  }
  return false;
}

/**
 * REGISTER
 */
router.post("/register", async (req, res) => {
  console.log("[auth] POST /auth/register");
  console.log("[auth] body:", {
    email: req.body?.email,
    password: req.body?.password ? "[present]" : "[missing]",
  });

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashed = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
      },
    });

    const token = signToken({ userId: user.id, email: user.email });

    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("Auth error:", err);
    if (isDbUnavailable(err)) {
      return res.status(503).json({
        error: "Database unavailable. Please try again later.",
        code: "DB_DOWN",
      });
    }
    return res.status(500).json({ error: "Authentication failed" });
  }
});

/**
 * LOGIN
 */
router.post("/login", async (req, res) => {
  console.log("[auth] POST /auth/login");
  console.log("[auth] body:", {
    email: req.body?.email,
    password: req.body?.password ? "[present]" : "[missing]",
  });

  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await comparePassword(password, user.password);

    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken({ userId: user.id, email: user.email });

    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("Auth error:", err);
    if (isDbUnavailable(err)) {
      return res.status(503).json({
        error: "Database unavailable. Please try again later.",
        code: "DB_DOWN",
      });
    }
    return res.status(500).json({ error: "Authentication failed" });
  }
});

router.get("/me", requireAuth, (req: AuthRequest, res) => {
  try {
    return res.json({ user: req.user });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
});
  
export default router;