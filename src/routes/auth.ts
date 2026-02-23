import { Router } from "express";
import { prisma } from "../db";
import {
  hashPassword,
  comparePassword,
  signToken,
} from "../utils/auth";

const router = Router();

/**
 * REGISTER
 */
router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

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
});

/**
 * LOGIN
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

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
});

export default router;