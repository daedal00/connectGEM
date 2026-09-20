import { DurableObject } from "cloudflare:workers";
import type { Room, TeamId, TeamState, Role, Viewer, RoomView, ServerMsg } from "../shared/types.ts";
import {
  buildOrder,
  seededShuffle,
  evaluateGuess,
  isTeamDone,
  isRoundOver,
  isLegalTap,
  isValidConfirms,
  toRoomView,
  GROUP_SIZE,
  parseClientMsg,
  DEFAULT_CONFIRMS,
} from "../shared/game.ts";
import { PUZZLES } from "../puzzles.ts";

// Shape written to each socket at accept time and read back in every handler.
// `playerId`/`name`/`team`/`role`/`authenticated` are resolved and verified by
// the Worker (index.ts) BEFORE the socket is ever accepted here - this object
// is never re-derived from a later client message, so a socket can't
// re-assert a different identity mid-session.
interface SocketAttachment {
  playerId: string;
  name: string;
  team: TeamId | null;
  role: Role;
  authenticated: boolean;
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

function emptyTeamState(): TeamState {
  return { players: {}, selection: {}, confirms: [], solved: [], mistakes: 0, pastGuesses: [], finishedAt: null };
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
// plan for a room that sits open between rounds. The cost is that eviction
// wipes ordinary instance fields, so any per-connection identity has to be
// persisted on the socket itself via serializeAttachment and re-read with
// deserializeAttachment in every handler, rather than kept in a class field.
//
// Room state has the same problem, solved the same way: `this.room` and
// `this.teamOrder` are an in-memory read-through cache that the constructor
// repopulates from ctx.storage via blockConcurrencyWhile every time this
// object is (re)constructed after an eviction. Every mutation is written
// back to storage before any socket sees it, so eviction can never observe a
// state the storage doesn't already have.
export class RoomDO extends DurableObject {
  private room: Room | null = null;
  // Per-team TILE ORDER, deliberately NOT part of `Room` (whose single
  // `order` field is shared, frozen wire-contract shape). See handleShuffle
  // for why this has to live outside `Room.order`.
  private teamOrder: Record<TeamId, string[]> = { red: [], blue: [] };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const [room, teamOrder] = await Promise.all([
        ctx.storage.get<Room>("room"),
        ctx.storage.get<Record<TeamId, string[]>>("teamOrder"),
      ]);
      this.room = room ?? null;
      this.teamOrder = teamOrder ?? { red: [], blue: [] };
    });
  }

  private async persist(): Promise<void> {
    if (!this.room) return;
    // Single multi-key put so room + teamOrder land in one atomic write -
    // never await between the two, or an eviction mid-write could persist
    // one without the other.
    await this.ctx.storage.put<Room | Record<TeamId, string[]>>({
      room: this.room,
      teamOrder: this.teamOrder,
    });
  }

  // --- Admin RPC methods (invoked directly by index.ts via the stub) ---
  // Compatibility date is well past 2024-04-03, so plain public methods on a
  // DurableObject subclass are callable as RPC - no need to hand-roll an
  // internal fetch() sub-protocol for these.

  async createRoom(code: string): Promise<boolean> {
    // idFromName(code) is deterministic: the same code always maps to this
    // same DO. A collision on room-code generation must never clobber a
    // room that already exists here.
    if (this.room) return false;
    this.room = {
      code,
      phase: "lobby",
      puzzleId: null,
      confirmsRequired: DEFAULT_CONFIRMS,
      startedAt: null,
      order: [],
      teams: { red: emptyTeamState(), blue: emptyTeamState() },
    };
    this.teamOrder = { red: [], blue: [] };
    await this.persist();
    return true;
  }

  async setPuzzle(puzzleId: string): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    const puzzle = findPuzzle(puzzleId);
    if (!puzzle) return notFound("puzzle not found");
    if (this.room.phase === "playing") return badRequest("cannot change puzzle mid-round");
    this.room.puzzleId = puzzleId;
    this.room.order = buildOrder(puzzle, this.room.code);
    this.teamOrder = { red: [...this.room.order], blue: [...this.room.order] };
    // Progress is scored against a specific puzzle: solved group ids from the
    // old one are meaningless here and would still count toward isTeamDone.
    // Changing the puzzle is starting a different game - keep only the roster.
    for (const team of ["red", "blue"] as const) {
      this.room.teams[team] = { ...emptyTeamState(), players: this.room.teams[team].players };
    }
    await this.persist();
    await this.broadcastState();
    return ok();
  }

  async startRoom(): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    if (!this.room.puzzleId) return badRequest("no puzzle assigned");
    if (this.room.phase !== "lobby") return badRequest("room is not in lobby");
    this.room.phase = "playing";
    this.room.startedAt = Date.now();
    await this.persist();
    await this.broadcastState();
    return ok();
  }

  async resetRoom(): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    const puzzle = findPuzzle(this.room.puzzleId);
    this.room.phase = "lobby";
    this.room.startedAt = null;
    this.room.order = puzzle ? buildOrder(puzzle, this.room.code) : [];
    this.teamOrder = { red: [...this.room.order], blue: [...this.room.order] };
    for (const team of ["red", "blue"] as const) {
      // Keep the connected roster, wipe game progress.
      this.room.teams[team] = { ...emptyTeamState(), players: this.room.teams[team].players };
    }
    await this.persist();
    await this.broadcastState();
    return ok();
  }

  async endRoom(): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    this.room.phase = "done";
    await this.persist();
    await this.broadcastState();
    return ok();
  }

  async setConfig(confirmsRequired: number): Promise<ActionResult> {
    if (!this.room) return notFound("room not found");
    if (!isValidConfirms(confirmsRequired)) return badRequest("confirmsRequired must be an integer 1..4");
    this.room.confirmsRequired = confirmsRequired;
    await this.persist();
    await this.broadcastState();
    return ok();
  }

  // --- WebSocket join ---
  // playerId/name/team/role/authenticated arrive as query params already
  // resolved and verified by index.ts. This object trusts them because the
  // only way to reach this fetch() is through the Worker's own ROOM binding
  // call - never directly from the internet - so by the time a request lands
  // here, index.ts has already done the untrusted-input validation.
  async fetch(request: Request): Promise<Response> {
    if (!this.room) return new Response("room not found", { status: 404 });

    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId") ?? "";
    if (!playerId) return new Response("missing playerId", { status: 400 });
    const name = url.searchParams.get("name") ?? "";
    const rawTeam = url.searchParams.get("team");
    const team: TeamId | null = rawTeam === "red" || rawTeam === "blue" ? rawTeam : null;
    const rawRole = url.searchParams.get("role");
    const authenticated = url.searchParams.get("authenticated") === "1";
    const role: Role = (rawRole === "screen" || rawRole === "admin") && authenticated ? rawRole : "player";

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const attachment: SocketAttachment = { playerId, name, team, role, authenticated };
    server.serializeAttachment(attachment);

    if (role === "player" && team) {
      // A phone can open a second tab and ask to join the other team, which
      // would hand it the board it is racing against. A playerId is on
      // exactly one team at a time: joining one leaves the other, and every
      // view follows current membership rather than what a socket asked for
      // (see currentTeam), so the abandoned socket loses its board.
      const other: TeamId = team === "red" ? "blue" : "red";
      delete this.room.teams[other].players[playerId];
      const existing = this.room.teams[team].players[playerId];
      // Reconnecting playerId UPDATES the existing entry - Record<PlayerId,
      // ...> is keyed by playerId, so this can never duplicate a player.
      this.room.teams[team].players[playerId] = { name: name || existing?.name || "Player", connected: true };
      await this.persist();
    }
    await this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const attachment = this.readAttachment(ws);
    if (!attachment) {
      ws.close(1011, "missing socket attachment");
      return;
    }
    if (!this.room) {
      this.safeSend(ws, { t: "error", message: "room not found" });
      return;
    }

    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const msg = parseClientMsg(text);
    if (!msg) {
      this.safeSend(ws, { t: "error", message: "malformed message" });
      return;
    }

    // Spectators (verified screen/admin) are read-only observers.
    if (attachment.role !== "player") {
      this.safeSend(ws, { t: "error", message: "spectators cannot act" });
      return;
    }
    const team = this.currentTeam(attachment);
    if (!team) {
      this.safeSend(ws, { t: "error", message: "join a team first" });
      return;
    }

    switch (msg.t) {
      case "tap":
        await this.handleTap(team, attachment.playerId, msg.word);
        break;
      case "clear":
        await this.handleClear(team);
        break;
      case "shuffle":
        await this.handleShuffle(team);
        break;
      case "submit":
        await this.handleSubmit(team, attachment.playerId);
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    await this.markDisconnected(ws);
    // 1005 ("no status received") and 1006 ("abnormal closure") are receive-only
    // pseudo-codes: the spec forbids sending them in an actual Close frame, and
    // ws.close(1005, ...) throws InvalidAccessError. Echo the code back to
    // complete the handshake only when it is a real, sendable code.
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

  // --- Gameplay message handlers ---

  private async handleTap(team: TeamId, playerId: string, word: string): Promise<void> {
    const room = this.room;
    if (!room) return;
    const puzzle = findPuzzle(room.puzzleId);
    const state = room.teams[team];
    if (room.phase !== "playing" || !puzzle || isTeamDone(state)) return;
    if (!isLegalTap(room, puzzle, team, word)) return;

    const current = state.selection[word] ?? [];
    const already = current.includes(playerId);
    const selectedWordCount = Object.keys(state.selection).length;
    if (!already && selectedWordCount >= GROUP_SIZE) return; // board full, must deselect first

    const updated = already ? current.filter(id => id !== playerId) : [...current, playerId];
    const selection = { ...state.selection };
    if (updated.length === 0) delete selection[word];
    else selection[word] = updated;

    state.selection = selection;
    // Any selection change clears confirms - the inclusivity mechanic: a
    // changed guess needs everyone to re-confirm it.
    state.confirms = [];
    await this.persist();
    await this.broadcastState();
  }

  private async handleClear(team: TeamId): Promise<void> {
    const room = this.room;
    if (!room) return;
    const state = room.teams[team];
    if (room.phase !== "playing" || isTeamDone(state)) return;
    state.selection = {};
    state.confirms = [];
    await this.persist();
    await this.broadcastState();
  }

  private async handleShuffle(team: TeamId): Promise<void> {
    const room = this.room;
    if (!room) return;
    const state = room.teams[team];
    if (room.phase !== "playing" || isTeamDone(state)) return;
    const current = this.teamOrder[team];
    if (current.length === 0) return;
    // Fresh seed each click so seededShuffle (still the only shuffle logic
    // in play - reused, not reimplemented) produces a new-looking order
    // every time rather than the same deterministic permutation.
    const seed = `${room.code}:${room.puzzleId}:${team}:${crypto.randomUUID()}`;
    this.teamOrder = { ...this.teamOrder, [team]: seededShuffle(current, seed) };
    await this.persist();
    await this.broadcastState();
  }

  private async handleSubmit(team: TeamId, playerId: string): Promise<void> {
    const room = this.room;
    if (!room) return;
    const puzzle = findPuzzle(room.puzzleId);
    const state = room.teams[team];
    if (room.phase !== "playing" || !puzzle || isTeamDone(state)) return;

    // Idempotent: the same player confirming twice on an unchanged
    // selection must not count twice.
    if (!state.confirms.includes(playerId)) {
      state.confirms = [...state.confirms, playerId];
    }

    if (state.confirms.length < room.confirmsRequired) {
      await this.persist();
      await this.broadcastState();
      return;
    }

    const words = Object.keys(state.selection);
    const outcome = evaluateGuess(
      puzzle,
      words,
      state.solved.map(s => s.groupId),
      state.pastGuesses,
    );

    if (outcome.kind === "correct") {
      state.solved = [...state.solved, { groupId: outcome.group.id, at: Date.now() }];
      state.pastGuesses = [...state.pastGuesses, words];
    } else if (outcome.kind === "oneAway" || outcome.kind === "wrong") {
      state.mistakes += 1;
      state.pastGuesses = [...state.pastGuesses, words];
    }
    // 'repeat' costs no mistake and is already recorded. 'invalid' (a
    // malformed selection slipping past isLegalTap, e.g. stale/replayed
    // state) is not the team's fault and costs nothing either.

    // An invalid guess is not a play: a crafted socket can submit while the
    // selection is under-filled, and that must not destroy the team's work.
    if (outcome.kind !== "invalid") state.selection = {};
    state.confirms = [];

    if (isTeamDone(state) && state.finishedAt === null) {
      state.finishedAt = Date.now();
    }
    if (isRoundOver(room)) {
      room.phase = "done";
    }

    await this.persist();

    // yourResult carries the solved Group (the answer key) - only the team
    // that guessed may ever see it.
    this.sendToTeam(team, { t: "yourResult", outcome });
    // opponentResult is the redacted signal, and only for a genuine change
    // in that team's progress - a free repeat/invalid attempt isn't real
    // information and would misrepresent the team's mistake count.
    if (outcome.kind === "correct" || outcome.kind === "oneAway" || outcome.kind === "wrong") {
      this.broadcastExceptTeam(team, { t: "opponentResult", team, outcome: { solved: outcome.kind === "correct" } });
    }
    await this.broadcastState();
  }

  private async markDisconnected(ws: WebSocket): Promise<void> {
    const attachment = this.readAttachment(ws);
    if (!attachment || !this.room || attachment.role !== "player" || !attachment.team) return;
    const player = this.room.teams[attachment.team].players[attachment.playerId];
    if (!player || !player.connected) return;
    // ponytail: this flips connected:false as soon as ANY socket for this
    // playerId closes, even if the same player has a second tab still open.
    // Room state has no open-socket count to check against - track one per
    // playerId if multi-tab-per-player becomes a real scenario.
    this.room.teams[attachment.team].players[attachment.playerId] = { ...player, connected: false };
    await this.persist();
    await this.broadcastState();
  }

  // --- Broadcast: the redaction boundary lives here as much as in game.ts ---

  private readAttachment(ws: WebSocket): SocketAttachment | null {
    return (ws.deserializeAttachment() as SocketAttachment | null) ?? null;
  }

  // The attachment records the team this socket ASKED for at accept time.
  // Membership can move afterwards, so every send path resolves the team
  // through the live roster instead of trusting the socket's original claim.
  private currentTeam(attachment: SocketAttachment): TeamId | null {
    const team = attachment.team;
    if (attachment.role !== "player" || team === null) return null;
    return this.room?.teams[team].players[attachment.playerId] ? team : null;
  }

  private viewerFor(attachment: SocketAttachment): Viewer {
    return attachment.role !== "player" && attachment.authenticated
      ? { kind: "spectator" }
      : { kind: "player", team: this.currentTeam(attachment) };
  }

  // Builds one viewer's RoomView. `Room.order` is the single shared field on
  // the frozen wire-contract Room shape, but each team's live tile order is
  // independent (see handleShuffle) - so a per-team-ordered *copy* of Room is
  // what actually gets fed into the pure, reused toRoomView/fullTeamView.
  // For a spectator we need both teams' own orders in the SAME RoomView, and
  // toRoomView only takes one Room, so build each side via the 'player'
  // branch and splice the two TeamFullViews together.
  private buildView(viewer: Viewer, now: number): RoomView {
    const room = this.room;
    if (!room) throw new Error("buildView called with no room");
    const puzzle = findPuzzle(room.puzzleId);

    if (viewer.kind === "player") {
      const order = viewer.team ? this.teamOrder[viewer.team] : room.order;
      return toRoomView({ ...room, order }, puzzle, viewer, now);
    }

    const redView = toRoomView({ ...room, order: this.teamOrder.red }, puzzle, { kind: "player", team: "red" }, now);
    const blueView = toRoomView({ ...room, order: this.teamOrder.blue }, puzzle, { kind: "player", team: "blue" }, now);
    if (redView.viewer !== "player" || blueView.viewer !== "player") {
      throw new Error("unreachable: player viewer produced a non-player RoomView");
    }
    const shell = toRoomView(room, puzzle, { kind: "spectator" }, now);
    if (shell.viewer !== "spectator") {
      throw new Error("unreachable: spectator viewer produced a non-spectator RoomView");
    }
    return { ...shell, red: redView.you, blue: blueView.you };
  }

  private async broadcastState(): Promise<void> {
    if (!this.room) return;
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.readAttachment(ws);
      if (!attachment) continue;
      const view = this.buildView(this.viewerFor(attachment), now);
      this.safeSend(ws, { t: "state", room: view });
    }
  }

  private sendToTeam(team: TeamId, msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.readAttachment(ws);
      if (attachment && this.currentTeam(attachment) === team) this.safeSend(ws, msg);
    }
  }

  private broadcastExceptTeam(team: TeamId, msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.readAttachment(ws);
      if (!attachment) continue;
      if (this.currentTeam(attachment) === team) continue;
      this.safeSend(ws, msg);
    }
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
