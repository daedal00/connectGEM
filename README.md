# Connect GEM

An Acts 4:32-35 take on the New York Times "Connections" game, built for a church youth
group station. Two teams race the same 16-tile board on their own phones. See `plan.md`
for the full design.

The team mechanic is the point: every member sees the same board, taps are broadcast with
the tapper's name, and a guess needs two different people to press Submit. One loud person
cannot run the round alone.

## Running a station game

1. Open `/admin` on your laptop and log in with the leader password.
2. **New room** gives you a four-letter code. Pick a puzzle and set how many teammates must
   confirm a guess (2 is the default).
3. Put `/screen/CODE` on the TV. It needs the same password and shows both boards side by side.
4. Players go to the site root, enter the code and their name, and pick a team.
5. **Start round.** Four mistakes per team. The round ends when both teams have either solved
   all four groups or run out of mistakes, or when you press **End round**.
6. **Reset** clears both teams' progress but keeps everyone connected, ready for the next puzzle.

Winner is most groups solved, then fewest mistakes, then whoever finished first.

## Dev

```
npm install
cp .dev.vars.example .dev.vars    # set ADMIN_SECRET to anything for local work
npm run dev
```

Runs the real Worker and the real `RoomDO` Durable Object locally via `@cloudflare/vite-plugin`,
with client HMR, so dev and production behave the same.

## Verify

```
npm run typecheck   # tsc --noEmit, worker + client
npm test            # pure rules engine, node --test, no dependencies
npm run build
npm run e2e         # needs a dev server on :8799 and ADMIN_SECRET=test-secret-e2e
```

`npm test` covers the rules. `npm run e2e` drives a real round against a real Durable Object
and is the only check that covers the admin-token gate, the spectator/player split, and the
two-distinct-confirms rule:

```
printf 'ADMIN_SECRET=test-secret-e2e\n' > .dev.vars
npm run dev -- --port 8799
npm run e2e
```

## Deploy

```
npm run deploy                   # vite build, then wrangler deploy
npx wrangler secret put ADMIN_SECRET
```

The secret prompts for its value - never pass it as a CLI argument. Without it set, every
admin route fails closed and no room can be created.

Deployed to https://connect-gem.bibleboardbot.workers.dev

## Known limitation

A player is on one team at a time: joining a team leaves the other, and the abandoned tab
loses its board. Someone who clears their browser storage gets a fresh identity and can join
the other team to see its progress. Closing that properly needs a separate join code per
team, which changes what the leader hands out at the door.
