import type {
  Puzzle,
  PuzzleSummary,
  Group,
  Room,
  TeamId,
  Viewer,
  MatchResult,
  GuessOutcome,
  RoomView,
  RevealedGroup,
  TeamView,
  ClientMsg,
} from './types.ts'

export const TEAM_IDS: readonly TeamId[] = ['red', 'blue', 'orange', 'teal']
export const GROUP_COUNT = 4
export const GROUP_SIZE = 4
export const MIN_TEAMS = 2
export const MAX_TEAMS = TEAM_IDS.length
export const DEFAULT_TEAMS = 2
export const MIN_LIVES = 1
export const MAX_LIVES = 6
export const DEFAULT_LIVES = 4
// Puzzle words are single short tokens. The cap is defence in depth against a
// phone sending a megabyte string that the Durable Object would then persist.
export const MAX_WORD_LENGTH = 40
export const DIFFICULTY_COLORS = ['#F9DF6D', '#A0C35A', '#B0C4EF', '#BA81C5'] as const
// Harder groups are worth more, so a team has a reason to go for purple
// instead of always taking the easy yellow.
export const DIFFICULTY_POINTS = [1, 2, 3, 4] as const

// --- Seeded shuffle ---
// The platform has no seedable RNG, so we derive one: djb2 turns the seed
// string into a 32-bit int, mulberry32 turns that int into a stream of
// floats. Not cryptographic, just deterministic and unbiased enough to drive
// a fair Fisher-Yates.

function hashSeed(seed: string): number {
  let h = 5381
  for (let i = 0; i < seed.length; i++) {
    h = (h * 33) ^ seed.charCodeAt(i)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = items.slice()
  const rand = mulberry32(hashSeed(seed))
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function buildOrder(puzzle: Puzzle, seed: string): string[] {
  const words = puzzle.groups.flatMap(group => group.members)
  return seededShuffle(words, `${seed}:${puzzle.id}`)
}

export function summarize({ id, title, kind, scripture }: Puzzle): PuzzleSummary {
  return { id, title, kind, scripture }
}

// --- Guess evaluation: the trust boundary for client input ---

function indexWords(puzzle: Puzzle): Map<string, Group> {
  const index = new Map<string, Group>()
  for (const group of puzzle.groups) {
    for (const word of group.members) index.set(word, group)
  }
  return index
}

function isRepeatGuess(words: string[], pastGuesses: string[][]): boolean {
  const sorted = [...words].sort()
  return pastGuesses.some(
    past => past.length === sorted.length && [...past].sort().every((word, i) => word === sorted[i]),
  )
}

export function evaluateGuess(
  puzzle: Puzzle,
  words: string[],
  solvedGroupIds: string[],
  pastGuesses: string[][],
): GuessOutcome {
  if (words.length !== GROUP_SIZE) {
    return { kind: 'invalid', reason: `pick exactly ${GROUP_SIZE} words` }
  }
  if (new Set(words).size !== words.length) {
    return { kind: 'invalid', reason: 'duplicate word in guess' }
  }

  const wordIndex = indexWords(puzzle)
  const solvedIds = new Set(solvedGroupIds)
  const groups: Group[] = []
  for (const word of words) {
    const group = wordIndex.get(word)
    if (!group) return { kind: 'invalid', reason: `unknown word: ${word}` }
    if (solvedIds.has(group.id)) return { kind: 'invalid', reason: `word already solved: ${word}` }
    groups.push(group)
  }

  // Validate before checking for a repeat: a malformed or stale guess must
  // fail as invalid, never silently pass through as a free (non-mistake) repeat.
  if (isRepeatGuess(words, pastGuesses)) return { kind: 'repeat' }

  const counts = new Map<string, number>()
  for (const group of groups) counts.set(group.id, (counts.get(group.id) ?? 0) + 1)

  for (const [groupId, count] of counts) {
    if (count === GROUP_SIZE) return { kind: 'correct', group: groups.find(g => g.id === groupId)! }
    if (count === 3) return { kind: 'oneAway' }
  }
  return { kind: 'wrong' }
}

// --- Room lifecycle ---

function perTeam<T>(value: T): Record<TeamId, T> {
  return { red: value, blue: value, orange: value, teal: value }
}

export function newRoom(code: string): Room {
  return {
    code,
    phase: 'lobby',
    puzzleId: null,
    teamCount: DEFAULT_TEAMS,
    lives: DEFAULT_LIVES,
    round: 0,
    order: [],
    turn: null,
    selection: [],
    solved: [],
    mistakes: perTeam(0),
    pastGuesses: [],
    totals: perTeam(0),
    players: {},
  }
}

export function activeTeams(room: Room): TeamId[] {
  return TEAM_IDS.slice(0, room.teamCount)
}

export function isOut(room: Room, team: TeamId): boolean {
  return room.mistakes[team] >= room.lives
}

// The team after `from` that still has lives, wrapping round to `from`
// itself last - so a lone surviving team keeps playing on its own.
export function nextTurn(room: Room, from: TeamId): TeamId | null {
  const order = activeTeams(room)
  const start = order.indexOf(from)
  for (let step = 1; step <= order.length; step++) {
    const team = order[(start + step) % order.length]
    if (!isOut(room, team)) return team
  }
  return null
}

// Back to the lobby on `puzzle` (or none) with every trace of the last
// round's progress gone. Totals from finished rounds are kept.
export function resetRound(room: Room, puzzle: Puzzle | null): void {
  // A reset mid-round is a do-over, not a new round: hand back the round
  // startRound counted, so the same team goes first on the same board.
  if (room.phase === 'playing') room.round -= 1
  room.phase = 'lobby'
  room.puzzleId = puzzle?.id ?? null
  room.order = puzzle ? buildOrder(puzzle, `${room.code}:${room.round}`) : []
  room.turn = null
  room.selection = []
  room.solved = []
  room.mistakes = perTeam(0)
  room.pastGuesses = []
}

export function startRound(room: Room, puzzle: Puzzle): void {
  resetRound(room, puzzle)
  const teams = activeTeams(room)
  // Whoever goes first has an edge (they see the fresh board and most
  // choices). Rotate it so a multi-round night evens out.
  room.turn = teams[room.round % teams.length]
  room.round += 1
  room.phase = 'playing'
}

export function finishRound(room: Room): void {
  if (room.phase !== 'playing') return
  const points = roundPoints(room)
  for (const team of activeTeams(room)) room.totals[team] += points[team]
  room.phase = 'done'
  room.turn = null
  room.selection = []
}

export function skipTurn(room: Room): void {
  if (room.phase !== 'playing' || !room.turn) return
  room.selection = []
  room.turn = nextTurn(room, room.turn)
  if (!room.turn) finishRound(room)
}

export function roundPoints(room: Room): Record<TeamId, number> {
  const points = perTeam(0)
  for (const entry of room.solved) if (entry.by) points[entry.by] += entry.points
  return points
}

function unsolvedGroups(room: Room, puzzle: Puzzle): Group[] {
  const solvedIds = new Set(room.solved.map(s => s.groupId))
  return puzzle.groups.filter(g => !solvedIds.has(g.id))
}

// A word the team on turn may select: on the board and not already solved.
export function isLegalTap(room: Room, puzzle: Puzzle, word: string): boolean {
  if (typeof word !== 'string' || word.length === 0 || word.length > MAX_WORD_LENGTH) return false
  if (!room.order.includes(word)) return false
  return unsolvedGroups(room, puzzle).some(g => g.members.includes(word))
}

export function toggleTap(room: Room, puzzle: Puzzle, word: string): boolean {
  if (room.phase !== 'playing' || !isLegalTap(room, puzzle, word)) return false
  if (room.selection.includes(word)) {
    room.selection = room.selection.filter(w => w !== word)
    return true
  }
  if (room.selection.length >= GROUP_SIZE) return false // full, must deselect first
  room.selection = [...room.selection, word]
  return true
}

// Scores the current selection for the team on turn and moves the game on.
export function applyGuess(room: Room, puzzle: Puzzle, now: number): GuessOutcome {
  const team = room.turn
  if (room.phase !== 'playing' || !team) return { kind: 'invalid', reason: 'round is not running' }

  const words = [...room.selection]
  const outcome = evaluateGuess(puzzle, words, room.solved.map(s => s.groupId), room.pastGuesses)
  // An invalid guess is not a play: an under-filled submit must not cost the
  // team its selection, a mistake, or its turn.
  if (outcome.kind === 'invalid') return outcome

  room.selection = []
  if (outcome.kind === 'repeat') return outcome   // free, and still your turn

  room.pastGuesses = [...room.pastGuesses, words]
  if (outcome.kind === 'correct') {
    room.solved = [
      ...room.solved,
      { groupId: outcome.group.id, by: team, points: DIFFICULTY_POINTS[outcome.group.difficulty], at: now },
    ]
    // The last four words are forced once three groups are out, so nobody
    // gets points for them.
    const left = unsolvedGroups(room, puzzle)
    if (left.length === 1) room.solved = [...room.solved, { groupId: left[0].id, by: null, points: 0, at: now }]
    if (room.solved.length >= GROUP_COUNT) {
      finishRound(room)
      return outcome
    }
  } else {
    room.mistakes = { ...room.mistakes, [team]: room.mistakes[team] + 1 }
  }

  room.turn = nextTurn(room, team)
  if (!room.turn) finishRound(room)
  return outcome
}

export function matchResult(room: Room): MatchResult {
  const points = roundPoints(room)
  const ranked = [...activeTeams(room)].sort(
    (a, b) => points[b] - points[a] || room.mistakes[a] - room.mistakes[b],
  )
  const [first, second] = ranked
  if (points[first] !== points[second]) return { winner: first, reason: 'most points' }
  if (room.mistakes[first] !== room.mistakes[second]) return { winner: first, reason: 'fewer mistakes' }
  return { winner: 'tie', reason: 'level on points and mistakes' }
}

export function isValidTeamCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_TEAMS && n <= MAX_TEAMS
}

export function isValidLives(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_LIVES && n <= MAX_LIVES
}

export function isTeamId(value: unknown): value is TeamId {
  return typeof value === 'string' && (TEAM_IDS as readonly string[]).includes(value)
}

// --- Redaction boundary ---
// The board is public, so every viewer gets the same view with two
// exceptions: `answerKey` (unsolved groups in full) exists only on the admin
// variant, and `you` only on a player's. Unsolved group names and members
// reach nobody else until the round is over.

export function toRoomView(room: Room, puzzle: Puzzle | null, viewer: Viewer, serverNow: number): RoomView {
  const groupById = new Map(puzzle?.groups.map(g => [g.id, g]) ?? [])
  const solvedIds = new Set(room.solved.map(s => s.groupId))
  const solvedWords = new Set(room.solved.flatMap(s => groupById.get(s.groupId)?.members ?? []))
  const points = roundPoints(room)
  const done = room.phase === 'done'

  const teams: TeamView[] = activeTeams(room).map(id => ({
    id,
    points: points[id],
    // Totals already include this round once it has been scored.
    total: room.totals[id] - (done ? points[id] : 0),
    mistakes: room.mistakes[id],
    out: isOut(room, id),
    players: Object.values(room.players)
      .filter(p => p.team === id)
      .map(({ name, connected }) => ({ name, connected })),
  }))

  const solved = room.solved
    .map(s => {
      const group = groupById.get(s.groupId)
      return group ? { ...group, by: s.by, points: s.points } : null
    })
    .filter((g): g is RevealedGroup => g !== null)

  let you: RoomView['you'] = null
  if (viewer.kind === 'player') {
    const team = room.players[viewer.playerId]?.team ?? null
    you = { team, canAct: room.phase === 'playing' && team !== null && team === room.turn }
  }

  return {
    code: room.code,
    phase: room.phase,
    puzzle: puzzle ? summarize(puzzle) : null,
    lives: room.lives,
    round: room.round,
    turn: room.turn,
    teams,
    board: room.phase === 'lobby' ? [] : room.order.filter(word => !solvedWords.has(word)),
    selection: room.selection,
    solved,
    leftover: done && puzzle ? puzzle.groups.filter(g => !solvedIds.has(g.id)) : [],
    result: done ? matchResult(room) : null,
    serverNow,
    viewer: viewer.kind,
    you,
    answerKey: viewer.kind === 'admin' && puzzle ? puzzle.groups : null,
  }
}

// --- Wire parsing: untrusted input straight off a WebSocket ---

export function parseClientMsg(raw: string): ClientMsg | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null

  const obj = data as Record<string, unknown>
  const keys = Object.keys(obj)

  switch (obj.t) {
    case 'clear':
    case 'shuffle':
    case 'submit':
      return keys.length === 1 ? { t: obj.t } : null
    case 'tap':
      return keys.length === 2 && typeof obj.word === 'string' && obj.word.length > 0 && obj.word.length <= MAX_WORD_LENGTH
        ? { t: 'tap', word: obj.word }
        : null
    case 'join':
      return keys.length === 2 && isTeamId(obj.team) ? { t: 'join', team: obj.team } : null
    default:
      return null
  }
}
