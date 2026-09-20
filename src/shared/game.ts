import type {
  Puzzle,
  Group,
  Room,
  TeamState,
  TeamId,
  Viewer,
  MatchResult,
  GuessOutcome,
  RoomView,
  RevealedGroup,
  TeamFullView,
  OpponentView,
  ClientMsg,
} from './types.ts'

export const GROUP_COUNT = 4
export const GROUP_SIZE = 4
export const MAX_MISTAKES = 4
export const DEFAULT_CONFIRMS = 2
// Puzzle words are single short tokens. The cap is defence in depth against a
// phone sending a megabyte string that the Durable Object would then persist
// as a `selection` key.
export const MAX_WORD_LENGTH = 40
export const DIFFICULTY_COLORS = ['#F9DF6D', '#A0C35A', '#B0C4EF', '#BA81C5'] as const

// --- Seeded shuffle ---
// The platform has no seedable RNG, so we derive one: djb2 turns the seed
// string into a 32-bit int, mulberry32 turns that int into a stream of
// floats. Both are ~5 lines - not cryptographic, just deterministic and
// unbiased enough to drive a fair Fisher-Yates for both teams' tile order.

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

export function buildOrder(puzzle: Puzzle, roomCode: string): string[] {
  const words = puzzle.groups.flatMap(group => group.members)
  return seededShuffle(words, `${roomCode}:${puzzle.id}`)
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
    return { kind: 'invalid', reason: `must submit exactly ${GROUP_SIZE} words` }
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

// --- Round state ---

export function isTeamDone(team: TeamState): boolean {
  return team.solved.length >= GROUP_COUNT || team.mistakes >= MAX_MISTAKES
}

export function isRoundOver(room: Room): boolean {
  return isTeamDone(room.teams.red) && isTeamDone(room.teams.blue)
}

// A tap arrives from a phone. Only a word that is actually on that team's
// live board may be recorded - otherwise the Durable Object persists
// attacker-chosen keys in `selection`.
export function isLegalTap(room: Room, puzzle: Puzzle, team: TeamId, word: string): boolean {
  if (typeof word !== 'string' || word.length === 0 || word.length > MAX_WORD_LENGTH) return false
  if (!room.order.includes(word)) return false
  const group = indexWords(puzzle).get(word)
  if (!group) return false
  return !room.teams[team].solved.some(s => s.groupId === group.id)
}

export function isValidConfirms(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= GROUP_SIZE
}

export function matchResult(teams: Record<TeamId, TeamState>): MatchResult {
  const red = teams.red
  const blue = teams.blue

  if (red.solved.length !== blue.solved.length) {
    return { winner: red.solved.length > blue.solved.length ? 'red' : 'blue', reason: 'more groups solved' }
  }
  if (red.mistakes !== blue.mistakes) {
    return { winner: red.mistakes < blue.mistakes ? 'red' : 'blue', reason: 'fewer mistakes' }
  }
  if (red.finishedAt !== blue.finishedAt) {
    // A missing finish time cannot be "earlier" than a recorded one.
    if (red.finishedAt === null) return { winner: 'blue', reason: 'earlier finish' }
    if (blue.finishedAt === null) return { winner: 'red', reason: 'earlier finish' }
    return { winner: red.finishedAt < blue.finishedAt ? 'red' : 'blue', reason: 'earlier finish' }
  }
  return { winner: 'tie', reason: 'tie' }
}

// --- Redaction boundary ---
// A player's RoomView can only ever carry a TeamFullView for their own team
// and an OpponentView for the other - never a Record<TeamId, TeamFullView>
// filtered at send time. There is no field the client could reach that would
// carry the opponent's tiles, selection, or guesses.

function fullTeamView(room: Room, puzzle: Puzzle | null, team: TeamId): TeamFullView {
  const state = room.teams[team]
  const wordIndex = puzzle ? indexWords(puzzle) : null
  const solvedIds = new Set(state.solved.map(s => s.groupId))

  const board = room.order.filter(word => {
    const group = wordIndex?.get(word)
    return !group || !solvedIds.has(group.id)
  })

  const solved = state.solved
    .map(s => {
      const group = puzzle?.groups.find(g => g.id === s.groupId)
      return group ? { ...group, at: s.at } : null
    })
    .filter((g): g is RevealedGroup => g !== null)

  return {
    players: state.players,
    board,
    selection: state.selection,
    confirms: state.confirms,
    solved,
    mistakes: state.mistakes,
    pastGuesses: state.pastGuesses,
    finishedAt: state.finishedAt,
  }
}

function toOpponentView(state: TeamState): OpponentView {
  return {
    solvedCount: state.solved.length,
    mistakes: state.mistakes,
    playerCount: Object.keys(state.players).length,
    finishedAt: state.finishedAt,
  }
}

export function toRoomView(room: Room, puzzle: Puzzle | null, viewer: Viewer, serverNow: number): RoomView {
  const base = {
    code: room.code,
    phase: room.phase,
    puzzleId: room.puzzleId,
    puzzle: puzzle ? { title: puzzle.title, scripture: puzzle.scripture } : null,
    confirmsRequired: room.confirmsRequired,
    startedAt: room.startedAt,
    serverNow,
    result: room.phase === 'done' ? matchResult(room.teams) : null,
    solution: room.phase === 'done' && puzzle ? puzzle.groups : null,
  }

  if (viewer.kind === 'spectator') {
    return {
      ...base,
      viewer: 'spectator',
      red: fullTeamView(room, puzzle, 'red'),
      blue: fullTeamView(room, puzzle, 'blue'),
    }
  }

  if (viewer.team === null) {
    return { ...base, viewer: 'unassigned' }
  }

  const opponentId: TeamId = viewer.team === 'red' ? 'blue' : 'red'
  return {
    ...base,
    viewer: 'player',
    team: viewer.team,
    you: fullTeamView(room, puzzle, viewer.team),
    opponent: toOpponentView(room.teams[opponentId]),
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
    default:
      return null
  }
}
