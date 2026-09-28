// Wire contract and internal Room shape for the turn-based Connections game.
// Pure logic (shuffle, guess evaluation, turn order, redaction) lives in
// game.ts; this file is shapes only.
//
// The game: one board on the projector, shared by every team. Teams take
// turns; on its turn a team's captain picks four words on their phone and
// submits. Everything on the board is public - the only secret is the
// answer key for groups nobody has solved yet.

export type Difficulty = 0 | 1 | 2 | 3
export type TeamId = 'red' | 'blue' | 'orange' | 'teal'
export type Phase = 'lobby' | 'playing' | 'done'
export type Role = 'player' | 'screen' | 'admin'
export type PlayerId = string
export type PuzzleKind = 'warmup' | 'scripture'

export type Group = { id: string; name: string; difficulty: Difficulty; members: [string, string, string, string] }
export type Puzzle = {
  id: string
  title: string
  kind: PuzzleKind
  scripture: string | null   // null for warm-up rounds
  groups: [Group, Group, Group, Group]
}

// What the admin puzzle picker and every view render. Deliberately omits
// `groups`: it must not ship an answer key before the round is played.
export type PuzzleSummary = { id: string; title: string; kind: PuzzleKind; scripture: string | null }

export type Player = { name: string; team: TeamId | null; connected: boolean }

// `by: null` is the last group, which reveals itself for no points once the
// other three are solved, as in the real game.
export type SolvedEntry = { groupId: string; by: TeamId | null; points: number; at: number }

export type Room = {   // INTERNAL Durable Object state. Never sent over the wire as-is.
  code: string
  phase: Phase
  puzzleId: string | null
  teamCount: number                  // 2..4, the first N of TEAM_IDS
  lives: number                      // wrong guesses a team may make before it is out
  round: number                      // rounds started so far; rotates who goes first
  order: string[]                    // the shared tile order, all 16 words
  turn: TeamId | null                // null outside 'playing'
  selection: string[]                // words picked by the team on turn, at most 4
  solved: SolvedEntry[]
  mistakes: Record<TeamId, number>
  pastGuesses: string[][]            // shared: the board is shared, so is its history
  totals: Record<TeamId, number>     // points carried across finished rounds
  players: Record<PlayerId, Player>
}

export type GuessOutcome =
  | { kind: 'correct'; group: Group }
  | { kind: 'oneAway' }
  | { kind: 'wrong' }
  | { kind: 'repeat' }
  | { kind: 'invalid'; reason: string }

export type MatchResult = { winner: TeamId | 'tie'; reason: string }

// --- Wire view ---

export type RevealedGroup = Group & { by: TeamId | null; points: number }

export type TeamView = {
  id: TeamId
  points: number         // this round
  total: number          // carried from earlier rounds, not including this one
  mistakes: number
  out: boolean
  players: { name: string; connected: boolean }[]   // no ids: a playerId is a rejoin credential
}

// Who is asking. `admin` carries the answer key, so it must only ever be
// constructed on a code path that has already verified the admin token.
// NEVER derive it from a WebSocket query parameter alone.
export type Viewer =
  | { kind: 'admin' }
  | { kind: 'screen' }
  | { kind: 'player'; playerId: PlayerId }

export type RoomView = {
  code: string
  phase: Phase
  puzzle: PuzzleSummary | null
  lives: number
  round: number
  turn: TeamId | null
  teams: TeamView[]                 // active teams, in turn order
  board: string[]                   // unsolved words; empty in the lobby so nobody gets a head start
  selection: string[]
  solved: RevealedGroup[]
  leftover: Group[]                 // groups nobody got; populated only once phase === 'done'
  result: MatchResult | null        // populated only once phase === 'done'
  serverNow: number
  viewer: Role
  you: { team: TeamId | null; canAct: boolean } | null   // player sockets only
  answerKey: Group[] | null                              // admin sockets only
}

// --- Wire protocol ---

export type ClientMsg =
  | { t: 'join'; team: TeamId }
  | { t: 'tap'; word: string }
  | { t: 'clear' }
  | { t: 'shuffle' }
  | { t: 'submit' }

// A guess is public now: every team watches the same board, and a one-away
// on someone else's turn is information the next team is meant to use.
export type GuessEvent = {
  team: TeamId
  outcome: 'correct' | 'oneAway' | 'wrong' | 'repeat'
  words: string[]
  group: RevealedGroup | null   // only for 'correct'
}

export type ServerMsg =
  | { t: 'state'; room: RoomView }
  | { t: 'guess'; event: GuessEvent }
  | { t: 'error'; message: string }

// --- Admin HTTP API ---

export type AdminLoginRequest = { password: string }
export type AdminLoginResponse = { token: string }
export type PuzzleListResponse = { puzzles: PuzzleSummary[] }
export type CreateRoomResponse = { code: string }
export type SetPuzzleRequest = { puzzleId: string }
export type SetConfigRequest = { teamCount?: number; lives?: number }
