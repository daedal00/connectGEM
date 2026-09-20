import test from 'node:test'
import assert from 'node:assert/strict'
import {
  seededShuffle,
  buildOrder,
  evaluateGuess,
  isTeamDone,
  matchResult,
  toRoomView,
  parseClientMsg,
} from './game.ts'
import type { Puzzle, Room, TeamState } from './types.ts'

const PUZZLE: Puzzle = {
  id: 'test-puzzle',
  title: 'Test Puzzle',
  scripture: 'Acts 4:32-35',
  groups: [
    { id: 'g0', name: 'ONE IN ___', difficulty: 0, members: ['HEART', 'MIND', 'SOUL', 'SPIRIT'] },
    { id: 'g1', name: 'SOLD IT', difficulty: 1, members: ['SOLD', 'BROUGHT', 'LAID', 'DISTRIBUTED'] },
    { id: 'g2', name: 'OWNED', difficulty: 2, members: ['LAND', 'HOUSES', 'MONEY', 'POSSESSIONS'] },
    { id: 'g3', name: '___ GRACE', difficulty: 3, members: ['AMAZING', 'SAVING', 'SAYING', 'PERIOD'] },
  ],
}

function emptyTeam(): TeamState {
  return {
    players: {},
    selection: {},
    confirms: [],
    solved: [],
    mistakes: 0,
    pastGuesses: [],
    finishedAt: null,
  }
}

// --- seededShuffle ---

test('seededShuffle is deterministic for a given seed', () => {
  const words = PUZZLE.groups.flatMap(g => g.members)
  const a = seededShuffle(words, 'room-1:test-puzzle')
  const b = seededShuffle(words, 'room-1:test-puzzle')
  assert.deepEqual(a, b)
})

test('seededShuffle differs across seeds', () => {
  const words = PUZZLE.groups.flatMap(g => g.members)
  const a = seededShuffle(words, 'seed-a')
  const b = seededShuffle(words, 'seed-b')
  assert.notDeepEqual(a, b)
})

test('seededShuffle is a true permutation (same multiset as input)', () => {
  const words = PUZZLE.groups.flatMap(g => g.members)
  const shuffled = seededShuffle(words, 'perm-seed')
  assert.deepEqual([...shuffled].sort(), [...words].sort())
})

test('seededShuffle does not mutate its input', () => {
  const input = ['a', 'b', 'c', 'd']
  const original = [...input]
  seededShuffle(input, 'seed')
  assert.deepEqual(input, original)
})

// --- buildOrder ---

test('buildOrder gives the same order for both teams in a room', () => {
  const a = buildOrder(PUZZLE, 'ROOM1')
  const b = buildOrder(PUZZLE, 'ROOM1')
  assert.deepEqual(a, b)
})

test('buildOrder differs for a different room code', () => {
  const a = buildOrder(PUZZLE, 'ROOM1')
  const b = buildOrder(PUZZLE, 'ROOM2')
  assert.notDeepEqual(a, b)
})

// --- evaluateGuess ---

test('evaluateGuess: correct guess returns the right group', () => {
  const outcome = evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOUL', 'SPIRIT'], [], [])
  assert.equal(outcome.kind, 'correct')
  if (outcome.kind === 'correct') {
    assert.equal(outcome.group.id, 'g0')
  }
})

test('evaluateGuess: 3-of-4 match is oneAway, 2-of-4 match is wrong', () => {
  const oneAway = evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOUL', 'SOLD'], [], [])
  assert.equal(oneAway.kind, 'oneAway')

  const wrong = evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOLD', 'BROUGHT'], [], [])
  assert.equal(wrong.kind, 'wrong')
})

test('evaluateGuess: repeat guess is detected regardless of word order, distinct from wrong', () => {
  const pastGuesses = [['HEART', 'MIND', 'SOLD', 'BROUGHT']]

  const first = evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOLD', 'BROUGHT'], [], [])
  assert.equal(first.kind, 'wrong')

  const repeat = evaluateGuess(PUZZLE, ['BROUGHT', 'SOLD', 'MIND', 'HEART'], [], pastGuesses)
  assert.equal(repeat.kind, 'repeat')
})

test('evaluateGuess: invalid - wrong word count', () => {
  const outcome = evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOUL'], [], [])
  assert.equal(outcome.kind, 'invalid')
})

test('evaluateGuess: invalid - unknown word', () => {
  const outcome = evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOUL', 'BANANA'], [], [])
  assert.equal(outcome.kind, 'invalid')
})

test('evaluateGuess: invalid - duplicate word', () => {
  const outcome = evaluateGuess(PUZZLE, ['HEART', 'HEART', 'MIND', 'SOUL'], [], [])
  assert.equal(outcome.kind, 'invalid')
})

test('evaluateGuess: invalid - word already solved', () => {
  const outcome = evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOUL', 'SPIRIT'], ['g0'], [])
  assert.equal(outcome.kind, 'invalid')
})

// --- isTeamDone ---

test('isTeamDone: true at 4 groups solved', () => {
  const team = emptyTeam()
  team.solved = [
    { groupId: 'g0', at: 1 },
    { groupId: 'g1', at: 2 },
    { groupId: 'g2', at: 3 },
    { groupId: 'g3', at: 4 },
  ]
  assert.equal(isTeamDone(team), true)
})

test('isTeamDone: true at 4 mistakes', () => {
  const team = emptyTeam()
  team.mistakes = 4
  assert.equal(isTeamDone(team), true)
})

test('isTeamDone: false mid-game', () => {
  const team = emptyTeam()
  team.mistakes = 2
  team.solved = [{ groupId: 'g0', at: 1 }]
  assert.equal(isTeamDone(team), false)
})

// --- matchResult ---

test('matchResult: clear win by groups solved', () => {
  const red = emptyTeam()
  red.solved = [{ groupId: 'g0', at: 1 }, { groupId: 'g1', at: 2 }, { groupId: 'g2', at: 3 }]
  const blue = emptyTeam()
  blue.solved = [{ groupId: 'g0', at: 1 }]
  const result = matchResult({ red, blue })
  assert.equal(result.winner, 'red')
  assert.equal(result.reason, 'more groups solved')
})

test('matchResult: tie on solved broken by mistakes', () => {
  const red = emptyTeam()
  red.solved = [{ groupId: 'g0', at: 1 }, { groupId: 'g1', at: 2 }]
  red.mistakes = 1
  const blue = emptyTeam()
  blue.solved = [{ groupId: 'g0', at: 1 }, { groupId: 'g1', at: 2 }]
  blue.mistakes = 3
  const result = matchResult({ red, blue })
  assert.equal(result.winner, 'red')
  assert.equal(result.reason, 'fewer mistakes')
})

test('matchResult: tie on solved and mistakes broken by finishedAt', () => {
  const red = emptyTeam()
  red.solved = [{ groupId: 'g0', at: 1 }]
  red.mistakes = 1
  red.finishedAt = 1000
  const blue = emptyTeam()
  blue.solved = [{ groupId: 'g0', at: 1 }]
  blue.mistakes = 1
  blue.finishedAt = 2000
  const result = matchResult({ red, blue })
  assert.equal(result.winner, 'red')
  assert.equal(result.reason, 'earlier finish')
})

test('matchResult: genuine tie', () => {
  const red = emptyTeam()
  red.solved = [{ groupId: 'g0', at: 1 }]
  red.mistakes = 1
  red.finishedAt = 1000
  const blue = emptyTeam()
  blue.solved = [{ groupId: 'g0', at: 1 }]
  blue.mistakes = 1
  blue.finishedAt = 1000
  const result = matchResult({ red, blue })
  assert.equal(result.winner, 'tie')
})

// --- toRoomView: the leak tests ---

test('toRoomView (player): no unsolved group name/members leak, no opponent selection/pastGuesses leak', () => {
  const red = emptyTeam()
  red.players = { p1: { name: 'Red One', connected: true } }
  red.solved = [{ groupId: 'g0', at: 1000 }]
  red.mistakes = 1
  red.pastGuesses = [['HEART', 'MIND', 'SOLD', 'BROUGHT']]

  const blue = emptyTeam()
  blue.players = { blueSecretPlayer: { name: 'Blue Secret', connected: true } }
  blue.selection = { BROUGHT: ['blueSecretPlayer'] }
  blue.confirms = ['blueSecretPlayer']
  blue.mistakes = 2
  blue.pastGuesses = [['SOLD', 'LAND', 'AMAZING', 'HEART']]

  const room: Room = {
    code: 'ROOM1',
    phase: 'playing',
    puzzleId: PUZZLE.id,
    confirmsRequired: 2,
    startedAt: 1000,
    order: buildOrder(PUZZLE, 'ROOM1'),
    teams: { red, blue },
  }

  const view = toRoomView(room, PUZZLE, { team: 'red', role: 'player' })
  const json = JSON.stringify(view)

  assert.equal(view.viewer, 'player')

  // Unsolved group names (g1, g2, g3) must never appear.
  assert.equal(json.includes('SOLD IT'), false)
  assert.equal(json.includes('OWNED'), false)
  assert.equal(json.includes('___ GRACE'), false)

  // The solved group (g0) is fine to reveal in full - a control, so the
  // absence checks above aren't just vacuously true for any output.
  assert.equal(json.includes('ONE IN ___'), true)

  // Unsolved groups' members must never appear bundled together as a group
  // (their individual words legitimately appear as flat, ungrouped tiles -
  // checked separately below).
  assert.equal(json.includes(JSON.stringify(PUZZLE.groups[1].members)), false)
  assert.equal(json.includes(JSON.stringify(PUZZLE.groups[2].members)), false)
  assert.equal(json.includes(JSON.stringify(PUZZLE.groups[3].members)), false)

  // Board tiles are flat strings with no group association.
  if (view.viewer === 'player') {
    for (const tile of view.you.board) {
      assert.equal(typeof tile, 'string')
    }
  }

  // The opponent's identity, selection, and past guesses never appear.
  assert.equal(json.includes('blueSecretPlayer'), false)
  assert.equal(json.includes('Blue Secret'), false)
  assert.equal(json.includes(JSON.stringify(blue.pastGuesses[0])), false)

  // Structural check: the opponent field carries only the four summary numbers.
  if (view.viewer === 'player') {
    assert.deepEqual(Object.keys(view.opponent).sort(), ['finishedAt', 'mistakes', 'playerCount', 'solvedCount'])
  }
})

test('toRoomView: phase done reveals the full solution to a player', () => {
  const red = emptyTeam()
  red.solved = [{ groupId: 'g0', at: 1 }]
  red.mistakes = 4
  red.finishedAt = 2000
  const blue = emptyTeam()
  blue.solved = [
    { groupId: 'g0', at: 1 },
    { groupId: 'g1', at: 2 },
    { groupId: 'g2', at: 3 },
    { groupId: 'g3', at: 4 },
  ]
  blue.finishedAt = 1500

  const room: Room = {
    code: 'ROOM1',
    phase: 'done',
    puzzleId: PUZZLE.id,
    confirmsRequired: 2,
    startedAt: 1000,
    order: buildOrder(PUZZLE, 'ROOM1'),
    teams: { red, blue },
  }

  const view = toRoomView(room, PUZZLE, { team: 'red', role: 'player' })
  assert.notEqual(view.solution, null)
  const json = JSON.stringify(view)
  assert.equal(json.includes('SOLD IT'), true)
  assert.equal(json.includes('OWNED'), true)
  assert.equal(json.includes('___ GRACE'), true)
})

test('toRoomView (admin/screen): sees both teams in full, including unsolved names', () => {
  const red = emptyTeam()
  const blue = emptyTeam()
  const room: Room = {
    code: 'ROOM1',
    phase: 'playing',
    puzzleId: PUZZLE.id,
    confirmsRequired: 2,
    startedAt: 1000,
    order: buildOrder(PUZZLE, 'ROOM1'),
    teams: { red, blue },
  }
  const view = toRoomView(room, PUZZLE, { team: null, role: 'admin' })
  assert.equal(view.viewer, 'spectator')
  if (view.viewer === 'spectator') {
    assert.equal(view.red.board.length, 16)
    assert.equal(view.blue.board.length, 16)
  }
})

test('toRoomView (player, no team yet): no team data leaks before joining a side', () => {
  const red = emptyTeam()
  const blue = emptyTeam()
  const room: Room = {
    code: 'ROOM1',
    phase: 'lobby',
    puzzleId: null,
    confirmsRequired: 2,
    startedAt: null,
    order: [],
    teams: { red, blue },
  }
  const view = toRoomView(room, null, { team: null, role: 'player' })
  assert.equal(view.viewer, 'unassigned')
  assert.equal('you' in view, false)
  assert.equal('opponent' in view, false)
  assert.equal('red' in view, false)
  assert.equal('blue' in view, false)
})

// --- parseClientMsg ---

test('parseClientMsg: accepts valid messages', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: 'tap', word: 'HEART' })), { t: 'tap', word: 'HEART' })
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: 'clear' })), { t: 'clear' })
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: 'shuffle' })), { t: 'shuffle' })
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: 'submit' })), { t: 'submit' })
})

test('parseClientMsg: rejects malformed input without throwing', () => {
  assert.equal(parseClientMsg('not json {'), null)
  assert.equal(parseClientMsg('[1,2,3]'), null)
  assert.equal(parseClientMsg('null'), null)
  assert.equal(parseClientMsg(JSON.stringify({ t: 'nonsense' })), null)
  assert.equal(parseClientMsg(JSON.stringify({ t: 'tap', word: 5 })), null)
  assert.equal(parseClientMsg(JSON.stringify({ t: 'clear', extra: true })), null)
})
