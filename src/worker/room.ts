import { DurableObject } from "cloudflare:workers";

// Shape written to each socket at accept time and read back in every handler.
// Later waves grow this to { playerId, name, team, role }; get the pattern
// right now because it is load-bearing for the whole game.
interface SocketAttachment {
  connectedAt: number;
}

// Hibernation API (ctx.acceptWebSocket, not server.accept()) lets Cloudflare
// evict this Durable Object from memory between messages instead of billing
// wall-clock time for every idle connection - required to stay on the free
// plan for a room that sits open between rounds. The cost is that eviction
// wipes ordinary instance fields, so any per-connection identity has to be
// persisted on the socket itself via serializeAttachment and re-read with
// deserializeAttachment in every handler, rather than kept in a class field.
export class RoomDO extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() } satisfies SocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment;
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    ws.send(JSON.stringify({ echo: text, connectedAt: attachment.connectedAt }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    console.log("RoomDO websocket closed", { code, reason, wasClean });
    // 1005 ("no status received") and 1006 ("abnormal closure") are receive-only
    // pseudo-codes: the spec forbids sending them in an actual Close frame, and
    // ws.close(1005, ...) throws InvalidAccessError. Echo the code back to
    // complete the handshake only when it is a real, sendable code.
    if (code === 1005 || code === 1006) {
      ws.close();
    } else {
      ws.close(code, reason);
    }
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error("RoomDO websocket error", error);
  }
}
