# Connect GEM - Acts 4 Connections Game

## Context

The repository is empty (no commits). We are building from scratch a clone of the New York Times
"Connections" word game, re-themed for a church youth group around Acts 4:32-35 ("All things in
common"). The passage is the hook: the game is about finding what words have *in common*, and the
team mechanic is about holding the board *in common*.

It runs as a **station game**: two teams of roughly 10 people face off. The open question was how a
10-person team plays a 16-tile board without 9 people watching one person tap. The answer chosen is a
**shared live board** - every member joins on their own phone, sees the same board, and taps are
broadcast to teammates in real time. Submitting a guess requires two different members to confirm, so
no single loud person can run the whole round.

Constraints: free hosting, real time, admin page to manage rooms and start rounds, players join from
their phones.

Outcome: one Cloudflare Worker, deployed to a free `*.workers.dev` URL, that serves the app and hosts
authoritative per-room game state in a Durable Object.

---

## Decisions (confirmed with user)

| Area | Decision |
|---|---|
| Team model | Shared board, all phones. Taps broadcast with the tapper's name. Submit needs 2 distinct member confirms (admin-adjustable 1-4). |
| Match format | Simultaneous race. Both teams get the same puzzle and the same tile shuffle. Live opponent progress (groups solved + mistakes left only, never their tiles). 4 mistakes each. |
| Content | Typed JSON file in the repo. Admin picks which puzzle a room plays. No content CRUD UI. |
| Big screen | Yes. Read-only `/screen/:code` showing both boards side by side, for a laptop plugged into a TV. |

---

## Technology stack

| Layer | Choice | Why |
|---|---|---|
| Runtime / host | **Cloudflare Workers**, free plan, `*.workers.dev` | Free tier is 100k requests/day. No cold-start cost, no credit card. |
| Real-time state | **Durable Objects (SQLite-backed)**, one per room | Single-threaded authoritative game state, native WebSocket support, strongly consistent. No external DB, no Redis, no polling. |
| WebSockets | DO **Hibernation API** (`acceptWebSocket`) | Idle rooms do not bill wall-clock duration. Required to stay comfortably inside the free tier. |
| Static hosting | **Workers Assets** (`assets` binding in `wrangler.jsonc`) | Same Worker serves the SPA and the API. No separate Pages project, asset requests are unbilled. |
| Frontend | **React + TypeScript + Vite** | Four screens of live-updating state. |
| Dev server | **`@cloudflare/vite-plugin`** | Runs the real Worker + real DO inside `vite dev` with HMR. Dev and prod behave identically. |
| Styling | **One plain CSS file** | Four screens. Tailwind is not worth a build-chain dependency here. |
| Routing (client) | `switch` on `location.pathname` | Four routes. Not worth `react-router`. |
| Tests | **`node --test`** (built into Node 26) | Zero dependencies. |
| Admin auth | Password -> HMAC-SHA256 token via `crypto.subtle` | Stateless, ~15 lines, and the password is never re-sent after login. |

**Total new runtime dependencies: `react`, `react-dom`.** Everything else is dev tooling or built in.

### Free-tier gotcha to get right on day one

Durable Objects are only free on **SQLite-backed** classes. The migration in `wrangler.jsonc` must be
`new_sqlite_classes`, **not** `new_classes` - the latter is KV-backed and requires a paid plan and
will fail at deploy time.

```jsonc
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomDO"] }]
```

Expected load per session: ~20 phones x ~200 messages = ~4,000 DO requests. The free allowance is
1M/month.

---

## Architecture

```
Browser (phone)  ──WS──┐
Browser (phone)  ──WS──┤
Browser (screen) ──WS──┼──▶ Worker (router + assets + admin auth)
Admin laptop     ──WS──┘         │
                                 │ idFromName(roomCode)
                                 ▼
                          RoomDO  ← authoritative state
                          (hibernating WebSockets)
```

One Worker. One Durable Object class. Room code maps to a DO via `env.ROOM.idFromName(code)`, so
routing needs no lookup table.

### Routes

| Path | Who | Purpose |
|---|---|---|
| `/` | player | Enter room code + name, choose team |
| `/play/:code` | player | The shared board |
| `/admin` | leader | Create rooms, pick puzzle, start / reset / end |
| `/screen/:code` | TV | Read-only side-by-side spectator view |
| `POST /api/admin/login` | leader | `{password}` -> `{token}` |
| `POST /api/rooms` | leader | Create room -> `{code}` |
| `POST /api/rooms/:code/{puzzle,start,reset,end,config}` | leader | Round control |
| `GET /api/rooms/:code/ws?...` | all | WebSocket upgrade |

Admin actions are plain HTTP POSTs (bearer token) rather than WebSocket message types - fewer message
kinds to define, and the admin still opens a read-only WS to watch live state.

### Joining

No player accounts. The WS query string carries `playerId`, `name`, `team`, `role`. `playerId` is a
random id kept in `localStorage`, so a phone that locks its screen or drops signal rejoins as the same
person instead of appearing twice.

### Per-socket identity across hibernation

Each socket's `{playerId, team, role}` is written with `ws.serializeAttachment()` at accept time and
read back with `deserializeAttachment()` in the handlers. Without this, identity is silently lost the
first time the DO is evicted - this is the single most common Durable Object WebSocket bug and it only
shows up after the room sits idle, which is exactly what happens between rounds at a station.

---

## Game model

```ts
type Puzzle = {
  id: string
  title: string
  scripture: string                    // "Acts 4:32-35"
  groups: [Group, Group, Group, Group] // exactly 4
}
type Group = {
  id: string
  name: string                         // revealed label, e.g. "WHAT THEY SHARED"
  difficulty: 0 | 1 | 2 | 3            // yellow, green, blue, purple
  members: [string, string, string, string]
}

type Room = {
  code: string
  phase: 'lobby' | 'playing' | 'done'
  puzzleId: string | null
  confirmsRequired: number             // default 2
  startedAt: number | null
  teams: { red: TeamState; blue: TeamState }
}
type TeamState = {
  players: Record<PlayerId, { name: string; connected: boolean }>
  selection: Record<Word, PlayerId[]>  // which teammates have tapped which tile
  confirms: PlayerId[]                 // reset whenever selection changes
  solved: { groupId: string; at: number }[]
  mistakes: number
  pastGuesses: string[][]              // to reject repeat guesses
  finishedAt: number | null
}
```

**Same shuffle for both teams.** Tile order comes from a seeded shuffle keyed on
`roomCode + puzzleId`, so the race is fair - neither team gets a friendlier layout. A 5-line
`mulberry32` PRNG; there is no seedable RNG in the platform.

### Wire protocol

Client -> server: `{t:'tap', word}`, `{t:'clear'}`, `{t:'shuffle'}`, `{t:'submit'}`.

Server -> client: `{t:'state', room}` - a full snapshot on every change - plus a transient
`{t:'result', team, correct, oneAway?, groupId?}` used only to drive the shake / reveal animation.

> `ponytail:` full-state broadcast on every tap. The snapshot is ~2KB across ~20 sockets, which is
> nothing. Switch to deltas only if the payload grows.

Opponent state is **redacted server-side** before sending: the other team's `selection` and
`pastGuesses` are stripped, leaving only solved count and mistakes. Redacting in the client would ship
the answers to anyone who opens devtools, and these are teenagers.

### Rules

- 4 mistakes per team, then that team is out; the other team plays on.
- "One away" feedback when exactly 3 of 4 tapped tiles share a group (as in NYT).
- Repeat guesses are rejected without costing a mistake.
- Round ends when both teams have either solved all 4 groups or used 4 mistakes. Admin can end early.
- Winner: most groups solved; tiebreak fewer mistakes, then earlier `finishedAt`.
- On `done`, reveal the full solution to everyone.

---

## Theme

Copy the NYT Connections look, which is deliberately plain: tile grid, uppercase condensed labels,
solved rows collapsing into coloured bands, shake on a wrong guess.

```
yellow #F9DF6D   green #A0C35A   blue #B0C4EF   purple #BA81C5
tile   #EFEFE6   selected #5A594E (white text)   page #FFFFFF
```

Use a system font stack or Libre Franklin. Do **not** copy the NYT wordmark, logo, or puzzle content -
reimplementing game mechanics is fine, shipping their branding is not.

---

## File layout

```
wrangler.jsonc
package.json  tsconfig.json  vite.config.ts  index.html
src/
  shared/types.ts        Puzzle, Room, wire messages
  shared/game.ts         PURE: seededShuffle, evaluateGuess, redactOpponent, winner
  shared/game.test.ts    node --test
  puzzles.json           Acts 4 content
  worker/index.ts        router, assets fallback, admin auth, WS upgrade
  worker/room.ts         RoomDO
  client/main.tsx        pathname switch
  client/useRoom.ts      WS hook: connect, reconnect with backoff
  client/Board.tsx       grid, selection badges, solved rows
  client/Join.tsx  client/Admin.tsx  client/Screen.tsx
  client/theme.css
```

All rule logic lives in `src/shared/game.ts` as pure functions with no DO or network access, so it is
testable without a runtime and reusable by the client for optimistic UI.

---

## Build phases

**Phase 0 - Prove the hosting path.** Scaffold, a trivial `RoomDO` that echoes, `wrangler deploy` to
`*.workers.dev`, open it on a phone. Do this before writing any game code; discovering a free-tier or
`new_sqlite_classes` problem after building the game is the expensive order.

**Phase 1 - Pure logic + tests.** `shared/types.ts`, `shared/game.ts`, `shared/game.test.ts`.
Cases: correct guess, one-away, repeat guess, 4th mistake, both-teams-done winner and each tiebreak,
seeded shuffle determinism, opponent redaction leaks nothing.

**Phase 2 - RoomDO.** Hibernating WebSockets, attachment identity, join/leave, tap/clear/confirm/submit,
broadcast. Admin HTTP endpoints + HMAC auth.

**Phase 3 - Player client.** Join screen, board, name badges on tiles, confirm counter, mistake dots,
opponent progress bar, reconnect on background/resume.

**Phase 4 - Admin page.** Login, create room, show code large, puzzle picker, confirms-required slider,
start / reset / end, live roster per team.

**Phase 5 - Spectator screen.** Side-by-side boards, large type, winner banner.

**Phase 6 - Content + field test.** Write 8 puzzles, test with real phones.

Each phase is one commit, roughly 100-200 lines.

---

## Execution: agent orchestration

Implementation is delegated to subagents. Sonnet 5 writes, Opus 5 reviews. The orchestrator (this
session) holds the contract, sequences the waves, and relays findings - it does not write application
code itself.

Note on configuration: the `Agent` tool exposes a `model` override (`sonnet` / `opus`) but no
per-call reasoning-effort knob; effort comes from the agent definition. Model selection is therefore
explicit per wave, and "high effort" is requested in the prompt body.

| Wave | Agent | Model | Scope | Depends on |
|---|---|---|---|---|
| 0 | `general-purpose` | sonnet | Scaffold, all config, deps, trivial echo `RoomDO`, deploy to `*.workers.dev` | - |
| 1 | `general-purpose` | sonnet | `shared/types.ts`, `shared/game.ts`, `shared/game.test.ts` | 0 |
| **R1** | `general-purpose` | **opus** | Review the contract only | 1 |
| 2a | `general-purpose` | sonnet | `worker/index.ts`, `worker/room.ts` - DO, hibernation, auth | R1 |
| 2b | `general-purpose` | sonnet | `client/useRoom.ts`, `Join.tsx`, `Board.tsx`, `theme.css` | R1 |
| 3 | `general-purpose` | sonnet | `client/Admin.tsx`, `client/Screen.tsx`, `puzzles.json` | 2a, 2b |
| **R2** | `general-purpose` | **opus** | Adversarial review of the whole system | 3 |
| 4 | `general-purpose` | sonnet | Apply R2 findings | R2 |
| **R3** | `general-purpose` | **opus** | Verify fixes, confirm no regressions | 4 |

### Why the waves are shaped this way

**Wave 1 is the interface boundary gate.** `shared/types.ts` plus the pure functions in
`shared/game.ts` *are* the seam between server and client. Freezing and reviewing that contract before
either side is written is what makes wave 2 safe to parallelise.

**R1 exists because a wrong contract poisons both sides.** It is the cheapest review in the sequence
and the most expensive one to skip - a field renamed after 2a and 2b have shipped means rewriting
both.

**2a and 2b run in parallel in the same working directory.** Their file sets are disjoint
(`src/worker/*` vs `src/client/*`), and wave 0 has already locked `package.json`, `vite.config.ts` and
`wrangler.jsonc`, so neither agent installs dependencies or edits shared config. No git worktrees, no
merge step. Both are instructed: **do not modify `src/shared/` - if the contract is wrong, stop and
report it.** A contract change mid-wave is a boundary problem and comes back to the orchestrator.

**Reviewers never fix.** R1/R2/R3 return findings as `path:line: severity: problem. fix.` and nothing
else. Fixes are a separate Sonnet pass, so the model that wrote the code is not the model grading it
and the reviewer is not rationalising its own diff.

### What every implementation agent is handed

Agents start cold. Each prompt carries, inline: the relevant section of this plan, the full current
contents of `src/shared/types.ts` (from wave 1 onward), the exact verification command for its scope,
and its file allowlist. No agent is asked to re-derive a decision already made here.

### R2 adversarial checklist

Beyond correctness, R2 is explicitly asked to hunt:

- **Answer leakage** - does any frame reaching a player contain the opponent's tiles, the solution, or
  the unredacted puzzle before `phase === 'done'`?
- **Hibernation identity** - is `serializeAttachment` used, and is it read back on *every* handler?
- **Races** - two phones tapping the same tile in the same tick; submit firing as the round ends;
  double-confirm from one `playerId` counting twice.
- **Reconnect** - duplicate player entries after a dropped socket; stale `connected` flags.
- **Trust boundary** - is the admin token verified on every admin route, with a constant-time compare?
  Can a player forge a `team` or drive the other team's board?
- **Free-tier** - `new_sqlite_classes` present; no unbounded broadcast loop.

### Orchestrator rules

- Report agent results verbatim in substance. Never predict or fabricate a pending agent's output.
- A failing verification command blocks the next wave. Do not proceed past red.
- If an agent reports a boundary problem, stop the wave and bring it here rather than letting the agent
  redesign the contract on its own.

---

## Content: example puzzles

```jsonc
{
  "id": "acts4-unity",
  "title": "All Things In Common",
  "scripture": "Acts 4:32-35",
  "groups": [
    { "difficulty": 0, "name": "ONE IN ___",           "members": ["HEART", "MIND", "SOUL", "SPIRIT"] },
    { "difficulty": 1, "name": "WHAT THEY DID WITH IT", "members": ["SOLD", "BROUGHT", "LAID", "DISTRIBUTED"] },
    { "difficulty": 2, "name": "WHAT THEY OWNED",       "members": ["LAND", "HOUSES", "MONEY", "POSSESSIONS"] },
    { "difficulty": 3, "name": "___ GRACE",             "members": ["AMAZING", "SAVING", "SAYING", "PERIOD"] }
  ]
}
```

The purple group is always the wordplay trap, matching how NYT builds a puzzle: some of its words
must look like they belong to an easier group. Here `SAYING GRACE` and `GRACE PERIOD` pull away from
the passage vocabulary.

Second draft puzzle: `NEEDY/LACK/WANT/POOR` - `BARNABAS/PETER/JOHN/ANANIAS` -
`TEACHING/FELLOWSHIP/BREAKING/PRAYER` (Acts 2:42) - `___ FEET: APOSTLES'/BARE/COLD/SQUARE`.

---

## Verification

1. **Unit:** `node --test src/shared/*.test.ts` - all rule logic green.
2. **Local multiplayer:** `vite dev`, then four browser windows: two players on Team Red, one admin,
   one screen. Confirm a tap on one phone appears on the other within a frame, that one member alone
   cannot submit, and that the opponent's tiles are absent from the WebSocket frames in devtools.
3. **Hibernation:** leave a room idle 15 minutes, then tap. The board must still know who you are - if
   `serializeAttachment` is wrong, this is where it surfaces.
4. **Deploy:** `npx wrangler deploy`, `npx wrangler secret put ADMIN_SECRET`.
5. **Field test:** three real phones on **cellular, not wifi**, one locked and unlocked mid-round, to
   exercise reconnect and backoff.
6. **Budget:** `wrangler tail` during a full round, confirm request count is in the thousands.

---

## Explicitly skipped

| Skipped | Add when |
|---|---|
| Round timer / DO alarms | A round needs a hard cap. Admin ends rounds manually for now. |
| More than 2 teams | A third group shows up at the station. |
| Puzzle editor UI | You want to write puzzles from a phone rather than the repo. |
| Persistent scores across rounds | You run a multi-round tournament. |
| Custom domain | `*.workers.dev` is fine for a station game. |
| Hint tokens, sound, animation polish | After the first real play test tells you what actually drags. |

---

## First action after approval

Copy this plan to `plan.md` at the repo root and commit it as the initial commit.
