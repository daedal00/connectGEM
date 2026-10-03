# Connect GEM

A take on the New York Times "Connections" game for a church youth group, played on one
projected screen. Teams take turns on a shared board: a warm-up round with everyday words
teaches the game, then Acts 4:29-37 rounds build on the passage.

## How a round works

- One 16-word board on the projector, shared by every team (2-4 teams).
- Teams take turns. The team talks it over, and its **captain** taps the four words on
  their phone and submits. Everyone watches the picks appear live on the big screen.
- **Correct:** the team scores by difficulty (yellow 1, green 2, blue 3, purple 4) and the
  turn passes. Harder groups are worth more, so going for purple is a real choice.
- **Wrong or one away:** the team loses a heart and the turn passes. The next team hears the
  "one away" too, and is meant to use it.
- **Turn timer:** each turn has a time limit (60 seconds by default), counted down on the
  big screen and the captain's phone. If it runs out the turn passes, with **no heart
  lost**. The leader can set it to 30, 45, 60, 90 or 120 seconds, or off, at any time; a
  change mid-round applies from the next turn.
- Once three groups are solved, the last four words reveal themselves for no points.
- A team with no hearts left sits out. The round ends when the board is cleared or every
  team is out, or when the leader ends it.
- **Winner:** most points, then fewest mistakes. Points also add up to a night total
  across rounds, and the first turn rotates each round so no team always goes first.

## Running the night

1. **Leader phone:** open `/admin`, log in with the leader password, and tap **New room**.
2. **Projector:** open `/screen` on the laptop and type the room code. No login needed:
   the screen shows only what every team can already see.
3. **Captains:** one per team goes to `/play` (it's on the screen), enters the code and
   their name, and picks a team.
4. **Leader phone:** pick a puzzle (the warm-ups are listed first), set the number of teams,
   lives and seconds per turn, and **Start**. Between rounds, **Next puzzle** goes down the list.

From the leader phone you can also **Skip turn**, **End round**, **Reset round**, or
**Zero totals**. While a round runs you can tap in a guess for whichever team is up, for a
team without a phone or a captain whose battery died. **Show answers** reveals the key on
your phone only. It never reaches the screen or the captains.

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
and is the only check that covers the admin-token gate, the screen/player/admin split, turn
enforcement on real sockets, and the leader playing for a team:

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

## Adding puzzles

Puzzles live in `src/puzzles.ts`. Each one is `warmup` or `scripture`, and has exactly four
groups of four with no word repeated. That rule is checked when the module loads. The list order is
the order **Next puzzle** walks, so keep the warm-ups first.
