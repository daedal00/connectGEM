export { RoomDO } from "./room.ts";

import type {
  AdminLoginRequest,
  AdminLoginResponse,
  PuzzleListResponse,
  CreateRoomResponse,
  SetPuzzleRequest,
  SetConfigRequest,
  Role,
} from "../shared/types.ts";
import { isValidLives, isValidTeamCount } from "../shared/game.ts";
import { puzzleSummaries } from "../puzzles.ts";

// ADMIN_SECRET is a plain-text var/secret (see .dev.vars.example), not a
// binding declared in wrangler.jsonc, so it doesn't appear in the
// wrangler-generated Env. Augment the ambient global Env from here instead
// of touching the generated worker-configuration.d.ts.
declare global {
  interface Env {
    ADMIN_SECRET: string;
  }
}

const WS_ROUTE = /^\/api\/rooms\/([^/]+)\/ws$/;
const ROOM_ACTION_ROUTE = /^\/api\/rooms\/([^/]+)\/(puzzle|start|reset|end|skip|zero|config)$/;

// --- Admin token: stateless HMAC-signed expiry, no session storage ---

const ADMIN_TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// Fixed-length (32-byte digest) comparison with no early return on content,
// so byte-by-byte timing can't leak how much of a guess matched the secret.
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// Hashing both sides first turns a variable-length secret comparison into a
// fixed-length (32-byte) one before the constant-time compare, so a plain
// `===` on the raw password is never on the code path at all.
async function constantTimeStringEqual(a: string, b: string): Promise<boolean> {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [da, db] = await Promise.all([digest(a), digest(b)]);
  return constantTimeEqual(da, db);
}

async function mintAdminToken(env: Env): Promise<string> {
  const expiry = Date.now() + ADMIN_TOKEN_TTL_MS;
  const mac = await hmacSha256(env.ADMIN_SECRET, String(expiry));
  return `${expiry}.${toBase64Url(mac)}`;
}

function extractToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/.exec(header);
    if (match) return match[1];
  }
  // A browser WebSocket can't set headers, so the token also travels as a
  // query param for the WS join route.
  return new URL(request.url).searchParams.get("token");
}

export async function verifyAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_SECRET) return false; // fail closed: never authenticate without a configured secret
  const token = extractToken(request);
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expiryPart = token.slice(0, dot);
  const macPart = token.slice(dot + 1);
  const expiry = Number(expiryPart);
  if (!Number.isFinite(expiry)) return false;
  const providedMac = fromBase64Url(macPart);
  if (!providedMac) return false;
  const expectedMac = await hmacSha256(env.ADMIN_SECRET, expiryPart);
  return constantTimeEqual(expectedMac, providedMac) && Date.now() < expiry;
}

// --- HTTP helpers ---

function unauthorized(): Response {
  return new Response("unauthorized", { status: 401 });
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function actionResponse(result: { status: number; json?: unknown }): Response {
  return Response.json(result.json ?? {}, { status: result.status });
}

// --- Room code generation ---
// Unambiguous alphabet: no O/0, no I/1.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function handleCreateRoom(env: Env): Promise<Response> {
  // idFromName(code) is deterministic, so a regenerated code that happens to
  // collide with a live room must retry rather than clobber it - createRoom
  // on the DO refuses to overwrite an existing room and reports back.
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const created = await stub.createRoom(code);
    if (created) return Response.json({ code } satisfies CreateRoomResponse);
  }
  return new Response("could not allocate a room code", { status: 500 });
}

async function handleRoomAction(request: Request, env: Env, code: string, action: string): Promise<Response> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));

  switch (action) {
    case "puzzle": {
      const body = await readJson<Partial<SetPuzzleRequest>>(request);
      if (!body || typeof body.puzzleId !== "string" || body.puzzleId.length === 0) {
        return badRequest("puzzleId required");
      }
      return actionResponse(await stub.setPuzzle(body.puzzleId));
    }
    case "start":
      return actionResponse(await stub.startRoom());
    case "reset":
      return actionResponse(await stub.resetRoom());
    case "end":
      return actionResponse(await stub.endRoom());
    case "skip":
      return actionResponse(await stub.skipRoom());
    case "zero":
      return actionResponse(await stub.zeroScores());
    case "config": {
      const body = await readJson<SetConfigRequest>(request);
      if (!body || typeof body !== "object") return badRequest("config body required");
      const { teamCount, lives } = body;
      if (teamCount !== undefined && !isValidTeamCount(teamCount)) return badRequest("teamCount must be an integer 2..4");
      if (lives !== undefined && !isValidLives(lives)) return badRequest("lives must be an integer 1..6");
      return actionResponse(await stub.setConfig({ teamCount, lives }));
    }
    default:
      return new Response("not found", { status: 404 });
  }
}

async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Partial<AdminLoginRequest>>(request);
  if (!body || typeof body.password !== "string") return badRequest("password required");
  if (!env.ADMIN_SECRET) return unauthorized(); // fail closed: no secret configured
  const valid = await constantTimeStringEqual(body.password, env.ADMIN_SECRET);
  if (!valid) return unauthorized();
  const token = await mintAdminToken(env);
  return Response.json({ token } satisfies AdminLoginResponse);
}

// --- WebSocket join ---
// A browser WebSocket carries no headers, so identity + an optional admin
// token both arrive as query params. This is the ONLY place client-supplied
// role/name are read - everything downstream (room.ts) trusts what it's
// handed because the only path to it is this Worker's own ROOM binding call.
const NAME_MAX = 24;
const PLAYER_ID_MAX = 100;

async function handleWsRoute(request: Request, env: Env, code: string): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 400 });
  }

  const url = new URL(request.url);
  const playerId = (url.searchParams.get("playerId") ?? "").slice(0, PLAYER_ID_MAX);
  if (!playerId) return badRequest("playerId required");
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, NAME_MAX);
  const rawRole = url.searchParams.get("role");
  // The big screen shows only what every team can already see, so it needs
  // no credential. The admin view carries the answer key and may play for
  // any team, so it is verified BEFORE the socket is accepted; a failed
  // check is a plain player, never a privileged socket.
  let role: Role = "player";
  if (rawRole === "screen") role = "screen";
  else if (rawRole === "admin" && (await verifyAdmin(request, env))) role = "admin";

  const forwardUrl = new URL(request.url);
  forwardUrl.search = "";
  forwardUrl.searchParams.set("playerId", playerId);
  forwardUrl.searchParams.set("name", name);
  forwardUrl.searchParams.set("role", role);
  const forwardRequest = new Request(forwardUrl, { method: request.method, headers: request.headers });

  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return stub.fetch(forwardRequest);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    const wsMatch = pathname.match(WS_ROUTE);
    if (wsMatch) return handleWsRoute(request, env, wsMatch[1]);

    if (pathname === "/api/admin/login" && method === "POST") {
      return handleAdminLogin(request, env);
    }

    if (pathname === "/api/puzzles" && method === "GET") {
      if (!(await verifyAdmin(request, env))) return unauthorized();
      return Response.json({ puzzles: puzzleSummaries() } satisfies PuzzleListResponse);
    }

    if (pathname === "/api/rooms" && method === "POST") {
      if (!(await verifyAdmin(request, env))) return unauthorized();
      return handleCreateRoom(env);
    }

    const actionMatch = pathname.match(ROOM_ACTION_ROUTE);
    if (actionMatch && method === "POST") {
      if (!(await verifyAdmin(request, env))) return unauthorized();
      return handleRoomAction(request, env, actionMatch[1], actionMatch[2]);
    }

    // Everything else (the SPA shell, its assets, and deep links like
    // /play/:code) falls through to the static assets binding. No matching
    // asset resolves to the SPA shell via not_found_handling in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
