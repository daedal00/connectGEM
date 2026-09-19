# Connect GEM

Acts 4 "Connections" clone for a church youth group. See `plan.md` for the full design.
This is Wave 0: hosting scaffold only, no game logic yet.

## Dev

```
npm install
npm run dev
```

Runs the real Worker and the `RoomDO` Durable Object locally (via `@cloudflare/vite-plugin`)
with client HMR. Copy `.dev.vars.example` to `.dev.vars` and fill in a real value if a route
needs `ADMIN_SECRET` (unused until a later wave).

## Deploy

```
npm run deploy
```

Builds the client, then runs `wrangler deploy`. Deployed to:

https://connect-gem.bibleboardbot.workers.dev

## Secrets

```
npx wrangler secret put ADMIN_SECRET
```

Sets the secret on the deployed Worker (prompts for the value; never pass it as a CLI arg).

## Verify

```
npm run typecheck   # tsc --noEmit, worker + client
npm run build       # vite build
npm test            # node --test src/shared/*.test.ts (no shared logic yet in Wave 0)
```
