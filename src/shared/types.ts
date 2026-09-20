// Wire contract and internal Room shape for the Acts 4 Connections game.
// Pure logic (shuffle, guess evaluation, redaction) lives in game.ts; this
// file is shapes only, aside from re-use across the worker/client.

export type Difficulty = 0 | 1 | 2 | 3
export type TeamId = 'red' | 'blue'
export type Phase = 'lobby' | 'playing' | 'done'
export type Role = 'player' | 'screen' | 'admin'
export type PlayerId = string

export type Group = { id: string; name: string; difficulty: Difficulty; members: [string, string, string, string] }
export type Puzzle = { id: string; title: string; scripture: string; groups: [Group, Group, Group, Group] }

// What the admin puzzle picker renders. Deliberately omits `groups`: the
// picker must not ship an answer key to a browser before the round starts.
export type PuzzleSummary = { id: string; title: string; scripture: string }

export type TeamState = {
  players: Record<PlayerId, { name: string; connected: boolean }>
  selection: Record<string, PlayerId[]>   // word -> teammates who have tapped it
  confirms: PlayerId[]                    // distinct members who pressed submit on the CURRENT selection
  solved: { groupId: string; at: number }[]
  mistakes: number
  pastGuesses: string[][]
  finishedAt: number | null
}

export type Room = {   // INTERNAL Durable Object state. Never sent over the wire as-is.
  code: string
  phase: Phase
  puzzleId: string | null
  confirmsRequired: number  // default 2, admin-settable 1..4
  startedAt: number | null
  order: string[]           // the seeded tile order, all 16 words
  teams: Record<TeamId, TeamState>
}

// Result of a single guess. Declared here (not game.ts) because ServerMsg
// below references it - keeps the import direction one-way, game.ts depends
// on types.ts and never the reverse.
//
// The `correct` variant carries a Group, i.e. that group's ANSWER KEY. Both
// teams race the same puzzle, so this must only ever reach the team that
// guessed. See ServerMsg.
export type GuessOutcome =
  | { kind: 'correct'; group: Group }
  | { kind: 'oneAway' }
  | { kind: 'wrong' }
  | { kind: 'repeat' }
  | { kind: 'invalid'; reason: string }

// The same event with every trace of the answer removed, so it is safe to
// show the opposing team. Carries no group id, name, or word.
export type PublicOutcome = { solved: boolean }

export type MatchResult = { winner: TeamId | 'tie'; reason: string }

// --- Wire view: THE SECURITY BOUNDARY ---
// RoomView is what actually goes over the socket. It is shaped so that
// leaking an opponent's board or an unsolved answer is a structural
// impossibility rather than a filtering bug: the 'player' variant has no
// field that could ever hold the opponent's selection/pastGuesses or an
// unsolved group's name/members, because those shapes don't appear in it.

export type RevealedGroup = Group & { at: number }   // a group this viewer is allowed to see in full

export type TeamFullView = {
  players: Record<PlayerId, { name: string; connected: boolean }>
  board: string[]                         // remaining words, flat - no group association, solved or not
  selection: Record<string, PlayerId[]>
  confirms: PlayerId[]
  solved: RevealedGroup[]
  mistakes: number
  pastGuesses: string[][]
  finishedAt: number | null
}

export type OpponentView = {
  solvedCount: number
  mistakes: number
  playerCount: number
  finishedAt: number | null
}

// Who is asking. `spectator` grants BOTH teams' boards in full, so it must
// only ever be constructed on a code path that has already verified the admin
// token. NEVER derive this from a WebSocket query parameter or any other
// client-supplied value: a player would open /screen/:code on their phone and
// read the opponent's board. `Role` is intentionally not accepted here - the
// privileged case has to be written out deliberately.
export type Viewer =
  | { kind: 'player'; team: TeamId | null }
  | { kind: 'spectator' }

export type RoomView = {
  code: string
  phase: Phase
  puzzleId: string | null
  puzzle: { title: string; scripture: string } | null
  confirmsRequired: number
  startedAt: number | null
  serverNow: number                               // authoritative clock: phone clocks drift and the race has a time tiebreak
  result: MatchResult | null                      // populated only once phase === 'done'
  solution: [Group, Group, Group, Group] | null   // populated only once phase === 'done'
} & (
  | { viewer: 'player'; team: TeamId; you: TeamFullView; opponent: OpponentView }
  | { viewer: 'spectator'; red: TeamFullView; blue: TeamFullView }
  | { viewer: 'unassigned' }   // a player socket that has not joined a team yet
)

// --- Wire protocol ---

export type ClientMsg =
  | { t: 'tap'; word: string }
  | { t: 'clear' }
  | { t: 'shuffle' }
  | { t: 'submit' }

export type ServerMsg =
  | { t: 'state'; room: RoomView }
  // ONLY to the sockets of the team that guessed. Carries the solved Group,
  // which is that group's answer key. Sending this room-wide hands the
  // opposing team a free answer - they are racing the same puzzle.
  | { t: 'yourResult'; outcome: GuessOutcome }
  // Safe to broadcast room-wide: no group, no words, just "they got one".
  | { t: 'opponentResult'; team: TeamId; outcome: PublicOutcome }
  | { t: 'error'; message: string }

// --- Admin HTTP API ---
// The worker routes and the admin page are written independently, so these
// shapes are the contract between them.

export type AdminLoginRequest = { password: string }
export type AdminLoginResponse = { token: string }
export type PuzzleListResponse = { puzzles: PuzzleSummary[] }
export type CreateRoomResponse = { code: string }
export type SetPuzzleRequest = { puzzleId: string }
export type SetConfigRequest = { confirmsRequired: number }
