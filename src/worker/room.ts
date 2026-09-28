import { DurableObject } from "cloudflare:workers";
import type { Room, Role, TeamId, Viewer, ServerMsg, GuessEvent } from "../shared/types.ts";
import {
  newRoom,
  resetRound,
  startRound,
  finishRound,
  skipTurn,
  toggleTap,
  applyGuess,
  seededShuffle,
  activeTeams,
  isValidTeamCount,
  isValidLives,
  toRoomView,
  parseClientMsg,
} from "../shared/game.ts";
import { PUZZLES } from "../puzzles.ts";

// Shape written to each socket at accept time and read back in every handler.
// `role` is resolved and verified by the Worker (index.ts) BEFORE the socket
// is accepted here - it is never re-derived from a later client message.
// Team membership is NOT here: it lives in `room.players`, so it survives
// reconnects and every send path reads the current value.
interface SocketAttachment {
  playerId: string;
  role: Role;
}

// Result shape shared by every admin RPC method below, mapped 1:1 onto an
// HTTP response by index.ts.
type ActionResult = { status: number; json?: unknown };

const ok = (json: unknown = {}): ActionResult => ({ status: 200, json });
const notFound = (message: string): ActionResult => ({ status: 404, json: { error: message } });
const badRequest = (message: string): ActionResult => ({ status: 400, json: { error: message } });

function findPuzzle(puzzleId: string | null) {
  return puzzleId ? (PUZZLES.find(p => p.id === puzzleId) ?? null) : null;
}

// A close-frame reason is capped at 123 UTF-8 BYTES, and the reason here came
// from the client. Trim on a byte budget, not a character count, so a
// multi-byte name cannot overflow the frame and make ws.close() throw.
function truncateReason(reason: string): string {
  const bytes = new TextEncoder().encode(reason);
  if (bytes.length <= 123) return reason;
  return new TextDecoder().decode(bytes.slice(0, 123)).replace(/�+$/, "");
}

// Hibernation API (ctx.acceptWebSocket, not server.accept()) lets Cloudflare
// evict this Durable Object from memory between messages instead of billing
// wall-clock time for every idle connection - required to stay on the free
// plan for a room that sits open between rounds. Eviction wipes instance
// fields, so per-connection identity is persisted on the socket via
// serializeAttachment, and `this.room` is a read-through cache the
// constructor repopulates from storage. Every mutation is written back to
// storage before any socket sees it.
export class RoomDO extends DurableObject {
  private room: Room | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<Room>("room");
      // Rooms created before the turn-based redesign have a different shape;
      // treat them as gone rather than crash every handler on them.
      this.room = stored && "teamCount" in stored ? stored : null;
    });
  }

  // Persist, then show everyone. Every state change ends here.
  private async commit(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put("room", this.room);
    this.broadcastState();
  }

  // --- Admin RPC methods (invoked directly by index.ts via the stub) ---

  async createRoom(code: string): Promise<boolean> {
    // idFromName(code) is deterministic: the same code always maps to this
    // same DO. A collision on room-code generation must never clobber a
    // room that already exists here.
    if (this.room) return false;
    this.room = newRoom(code);
    await this.ctx.storage.put("room", this.room);
    return true;
  }

  async setPuzzle(puzzleId: string): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    const puzzle = findPuzzle(puzzleId);
    if (!puzzle) return notFound("puzzle not found");
    if (this.room.phase === "playing") return badRequest("end the round before changing the puzzle");
    resetRound(this.room, puzzle);
    await this.commit();
    return ok();
  }

  async startRoom(): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    const puzzle = findPuzzle(this.room.puzzleId);
    if (!puzzle) return badRequest("no puzzle assigned");
    if (this.room.phase === "playing") return badRequest("a round is already running");
    startRound(this.room, puzzle);
    await this.commit();
    return ok();
  }

  async resetRoom(): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    resetRound(this.room, findPuzzle(this.room.puzzleId));
    await this.commit();
    return ok();
  }

  async endRoom(): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    if (this.room.phase !== "playing") return badRequest("no round is running");
    finishRound(this.room);
    await this.commit();
    return ok();
  }

  async skipRoom(): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    if (this.room.phase !== "playing") return badRequest("no round is running");
    skipTurn(this.room);
    await this.commit();
    return ok();
  }

  async zeroScores(): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    this.room.totals = { red: 0, blue: 0, orange: 0, teal: 0 };
    await this.commit();
    return ok();
  }

  async setConfig(config: { teamCount?: number; lives?: number }): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    if (this.room.phase === "playing") return badRequest("end the round before changing settings");
    if (config.teamCount !== undefined) {
      if (!isValidTeamCount(config.teamCount)) return badRequest("teamCount must be an integer 2..4");
      this.room.teamCount = config.teamCount;
      // A captain on a team that no longer exists goes back to the picker
      // rather than silently holding a team with no turns.
      const active = activeTeams(this.room);
      for (const player of Object.values(this.room.players)) {
        if (player.team && !active.includes(player.team)) player.team = null;
      }
    }
    if (config.lives !== undefined) {
      if (!isValidLives(config.lives)) return badRequest("lives must be an integer 1..6");
      this.room.lives = config.lives;
    }
    await this.commit();
    return ok();
  }

  // --- WebSocket join ---
  // playerId/name/role arrive as query params already resolved and verified
  // by index.ts. The only way to reach this fetch() is through the Worker's
  // own ROOM binding call - never directly from the internet.
  async fetch(request: Request): Promise<Response> {
    if (!this.room) return new Response("room not found", { status: 404 });

    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId") ?? "";
    if (!playerId) return new Response("missing playerId", { status: 400 });
    const name = url.searchParams.get("name") ?? "";
    const rawRole = url.searchParams.get("role");
    const role: Role = rawRole === "admin" || rawRole === "screen" ? rawRole : "player";

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, role } satisfies SocketAttachment);

    if (role === "player") {
      // Reconnecting playerId UPDATES the existing entry and keeps its team,
      // so a phone that locks mid-round comes back as the same captain.
      const existing = this.room.players[playerId];
      this.room.players[playerId] = {
        name: name || existing?.name || "Player",
        team: existing?.team ?? null,
        connected: true,
      };
      await this.commit();
    } else {
      this.sendState(server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const attachment = this.readAttachment(ws);
    if (!attachment) {
      ws.close(1011, "missing socket attachment");
      return;
    }
    const room = this.room;
    if (!room) {
      this.safeSend(ws, { t: "error", message: "room not found" });
      return;
    }

    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const msg = parseClientMsg(text);
    if (!msg) {
      this.safeSend(ws, { t: "error", message: "malformed message" });
      return;
    }

    if (attachment.role === "screen") {
      this.safeSend(ws, { t: "error", message: "the big screen is read-only" });
      return;
    }

    if (msg.t === "join") {
      const player = room.players[attachment.playerId];
      if (attachment.role !== "player" || !player) {
        this.safeSend(ws, { t: "error", message: "only players join teams" });
        return;
      }
      if (!activeTeams(room).includes(msg.team)) {
        this.safeSend(ws, { t: "error", message: "that team is not playing" });
        return;
      }
      // Mid-round, a captain could otherwise hop to whichever team is on
      // turn and play for it. A phone with no team yet may still sign up.
      if (room.phase === "playing" && player.team && player.team !== msg.team) {
        this.safeSend(ws, { t: "error", message: "teams are locked until the round ends" });
        return;
      }
      player.team = msg.team;
      await this.commit();
      return;
    }

    const puzzle = findPuzzle(room.puzzleId);
    if (room.phase !== "playing" || !puzzle || !room.turn) {
      this.safeSend(ws, { t: "error", message: "the round is not running" });
      return;
    }
    // The leader's phone may play for whichever team is up (a team with no
    // phone, or a captain whose battery died). A player acts only for their
    // own team, and only on its turn.
    const team: TeamId = room.turn;
    if (attachment.role === "player" && room.players[attachment.playerId]?.team !== team) {
      this.safeSend(ws, { t: "error", message: "not your turn" });
      return;
    }

    switch (msg.t) {
      case "tap":
        if (toggleTap(room, puzzle, msg.word)) await this.commit();
        break;
      case "clear":
        room.selection = [];
        await this.commit();
        break;
      case "shuffle":
        room.order = seededShuffle(room.order, crypto.randomUUID());
        await this.commit();
        break;
      case "submit": {
        const outcome = applyGuess(room, puzzle, Date.now());
        if (outcome.kind === "invalid") {
          this.safeSend(ws, { t: "error", message: outcome.reason });
          return;
        }
        const event: GuessEvent = {
          team,
          outcome: outcome.kind,
          words: room.pastGuesses.at(-1) ?? [],
          group: null,
        };
        if (outcome.kind === "correct") {
          const entry = room.solved.find(s => s.groupId === outcome.group.id);
          event.group = { ...outcome.group, by: team, points: entry?.points ?? 0 };
          event.words = [...outcome.group.members];
        }
        if (outcome.kind === "repeat") event.words = [];
        await this.ctx.storage.put("room", room);
        // The event first, then the state it produced, so a screen can show
        // "ONE AWAY" over the board the guess was made on.
        this.broadcast({ t: "guess", event });
        this.broadcastState();
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    await this.markDisconnected(ws);
    // 1005 and 1006 are receive-only pseudo-codes: ws.close(1005, ...) throws.
    // Echo the code back only when it is a real, sendable one.
    if (code === 1005 || code === 1006) {
      ws.close();
    } else {
      ws.close(code, truncateReason(reason));
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("RoomDO websocket error", error);
    await this.markDisconnected(ws);
  }

  private async markDisconnected(ws: WebSocket): Promise<void> {
    const attachment = this.readAttachment(ws);
    if (!attachment || !this.room || attachment.role !== "player") return;
    const player = this.room.players[attachment.playerId];
    if (!player || !player.connected) return;
    // A second tab for the same player keeps them "here".
    const stillOpen = this.ctx.getWebSockets().some(other => {
      if (other === ws || other.readyState !== WebSocket.READY_STATE_OPEN) return false;
      const a = this.readAttachment(other);
      return a?.role === "player" && a.playerId === attachment.playerId;
    });
    if (stillOpen) return;
    player.connected = false;
    await this.commit();
  }

  // --- Broadcast ---

  private readAttachment(ws: WebSocket): SocketAttachment | null {
    return (ws.deserializeAttachment() as SocketAttachment | null) ?? null;
  }

  private viewerFor(attachment: SocketAttachment): Viewer {
    if (attachment.role === "admin") return { kind: "admin" };
    if (attachment.role === "screen") return { kind: "screen" };
    return { kind: "player", playerId: attachment.playerId };
  }

  private sendState(ws: WebSocket, now = Date.now()): void {
    const attachment = this.readAttachment(ws);
    if (!attachment || !this.room) return;
    const view = toRoomView(this.room, findPuzzle(this.room.puzzleId), this.viewerFor(attachment), now);
    this.safeSend(ws, { t: "state", room: view });
  }

  private broadcastState(): void {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) this.sendState(ws, now);
  }

  private broadcast(msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) this.safeSend(ws, msg);
  }

  // One dead socket must never abort a broadcast loop.
  private safeSend(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState !== WebSocket.READY_STATE_OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error("RoomDO send failed", err);
    }
  }
}
