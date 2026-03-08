import { WebSocketServer, WebSocket } from "ws";

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initializeWebSocket(server: any) {
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    console.log(`WebSocket client connected. Total clients: ${clients.size}`);

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`WebSocket client disconnected. Total clients: ${clients.size}`);
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      clients.delete(ws);
    });
  });

  console.log("WebSocket server initialized");
}

export function broadcast(payload: any) {
  if (!wss || clients.size === 0) return;

  const message = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        sent++;
      } catch (error) {
        console.error("Failed to send WebSocket message:", error);
        failed++;
        clients.delete(client);
      }
    } else {
      clients.delete(client);
    }
  });

  if (sent > 0) {
    console.log(`Broadcast sent to ${sent} client(s)`);
  }
  if (failed > 0) {
    console.log(`Failed to send to ${failed} client(s)`);
  }
}

export function getClientCount(): number {
  return clients.size;
}
