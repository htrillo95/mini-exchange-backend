import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import orderRoutes from "./routes/orders.js";

dotenv.config();
const app = express();

// CORS configuration: env-based origin whitelist
const NODE_ENV = process.env.NODE_ENV || "development";
const CORS_ORIGIN = process.env.CORS_ORIGIN;

let allowedOrigins: string[] = [];
if (NODE_ENV === "production") {
  // Production: require CORS_ORIGIN env var
  if (!CORS_ORIGIN) {
    throw new Error(
      'Missing required environment variable: CORS_ORIGIN (required in production)'
    );
  }
  allowedOrigins = [CORS_ORIGIN];
} else {
  // Development: allow common localhost ports
  allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:3001",
  ];
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: false, // Set to true if cookies/auth headers needed
  })
);
app.use(express.json());

app.use("/api/orders", orderRoutes);

// Create HTTP server (WebSocket-ready)
const PORT = Number(process.env.PORT) || 4000;
const server = http.createServer(app);

server.listen(PORT, "0.0.0.0", () => {
  console.log(` Server running on port ${PORT}`);
  console.log(` Environment: ${NODE_ENV}`);
  console.log(` Allowed CORS origins: ${allowedOrigins.join(", ")}`);
});

export { server };
