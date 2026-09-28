import test from 'node:test'
import assert from 'node:assert/strict'
import {
  seededShuffle,
  buildOrder,
  evaluateGuess,
  newRoom,
  startRound,
  resetRound,
  finishRound,
  skipTurn,
  toggleTap,
  applyGuess,
  nextTurn,
  matchResult,
  toRoomView,
  parseClientMsg,
  isValidTeamCount,
  isValidLives,
  MAX_WORD_LENGTH,
} from './game.ts'
import type { Puzzle, Room } from './types.ts'

const PUZZLE: Puzzle = {
  id: 'test-puzzle',
  title: 'Test Puzzle',
  kind: 'scripture',
  scripture: 'Acts 4:32-35',
  groups: [
    { id: 'g0', name: 'ONE ___', difficulty: 0, members: ['HEART', 'MIND', 'SOUL', 'SPIRIT'] },
    { id: 'g1', name: 'SOLD IT', difficulty: 1, members: ['SOLD', 'BROUGHT', 'LAID', 'DISTRIBUTED'] },
    { id: 'g2', name: 'OWNED', difficulty: 2, members: ['LAND', 'HOUSES', 'MONEY', 'POSSESSIONS'] },
    { id: 'g3', name: '___ GRACE', difficulty: 3, members: ['AMAZING', 'SAVING', 'SAYING', 'GREAT'] },
  ],
}
const [G0, G1, G2, G3] = PUZZLE.groups
const NOW = 1_000

function playing(teamCount = 2, lives = 4): Room {
  const room = newRoom('ABCD')
  room.teamCount = teamCount
  room.lives = lives
  startRound(room, PUZZLE)
  return room
}

function guess(room: Room, words: readonly string[]) {
  room.selection = []
  for (const w of words) toggleTap(room, PUZZLE, w)
  return applyGuess(room, PUZZLE, NOW)
}

const WRONG = ['HEART', 'SOLD', 'LAND', 'AMAZING']
const WRONG2 = ['MIND', 'BROUGHT', 'HOUSES', 'SAVING']
const WRONG3 = ['SOUL', 'LAID', 'MONEY', 'SAYING']
const ONE_AWAY = ['HEART', 'MIND', 'SOUL', 'LAND']

// --- shuffle ---

test('seededShuffle is a deterministic permutation that does not mutate input', () => {
  const words = PUZZLE.groups.flatMap(g => g.members)
  const copy = [...words]
  const a = seededShuffle(words, 'seed')
  assert.deepEqual(a, seededShuffle(words, 'seed'))
  assert.notDeepEqual(a, seededShuffle(words, 'other-seed'))
  assert.deepEqual([...a].sort(), [...words].sort())
  assert.deepEqual(words, copy)
})

test('buildOrder contains all 16 words', () => {
  assert.equal(new Set(buildOrder(PUZZLE, 'ROOM')).size, 16)
})

// --- evaluateGuess ---

test('evaluateGuess: correct, one away, wrong', () => {
  assert.deepEqual(evaluateGuess(PUZZLE, [...G0.members], [], []), { kind: 'correct', group: G0 })
  assert.equal(evaluateGuess(PUZZLE, ONE_AWAY, [], []).kind, 'oneAway')
  assert.equal(evaluateGuess(PUZZLE, WRONG, [], []).kind, 'wrong')
})

test('evaluateGuess: repeat in any order, but only after validation', () => {
  assert.equal(evaluateGuess(PUZZLE, [...WRONG].reverse(), [], [WRONG]).kind, 'repeat')
  assert.equal(evaluateGuess(PUZZLE, ['HEART'], [], [['HEART']]).kind, 'invalid')
})

test('evaluateGuess rejects bad input', () => {
  assert.equal(evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOUL'], [], []).kind, 'invalid')
  assert.equal(evaluateGuess(PUZZLE, ['HEART', 'HEART', 'SOUL', 'MIND'], [], []).kind, 'invalid')
  assert.equal(evaluateGuess(PUZZLE, ['HEART', 'MIND', 'SOUL', 'NOPE'], [], []).kind, 'invalid')
  assert.equal(evaluateGuess(PUZZLE, [...G0.members], ['g0'], []).kind, 'invalid')
})

// --- round lifecycle ---

test('startRound gives the first turn to the first team, then rotates across rounds', () => {
  const room = newRoom('ABCD')
  room.teamCount = 3
  startRound(room, PUZZLE)
  assert.equal(room.turn, 'red')
  assert.equal(room.phase, 'playing')
  finishRound(room)
  startRound(room, PUZZLE)
  assert.equal(room.turn, 'blue')
  finishRound(room)
  startRound(room, PUZZLE)
  assert.equal(room.turn, 'orange')
  finishRound(room)
  startRound(room, PUZZLE)
  assert.equal(room.turn, 'red')
})

test('a correct guess scores by difficulty and passes the turn', () => {
  const room = playing()
  const outcome = guess(room, G3.members)
  assert.equal(outcome.kind, 'correct')
  assert.deepEqual(room.solved, [{ groupId: 'g3', by: 'red', points: 4, at: NOW }])
  assert.equal(room.turn, 'blue')
  assert.deepEqual(room.selection, [])
})

test('a wrong or one-away guess costs a life and passes the turn', () => {
  const room = playing()
  assert.equal(guess(room, ONE_AWAY).kind, 'oneAway')
  assert.equal(room.mistakes.red, 1)
  assert.equal(room.turn, 'blue')
  assert.equal(guess(room, WRONG).kind, 'wrong')
  assert.equal(room.mistakes.blue, 1)
  assert.equal(room.turn, 'red')
})

test('a repeat is free and keeps the turn, even if another team made it', () => {
  const room = playing()
  guess(room, WRONG)                  // red misses
  assert.equal(room.turn, 'blue')
  assert.equal(guess(room, [...WRONG].reverse()).kind, 'repeat')
  assert.equal(room.turn, 'blue')
  assert.equal(room.mistakes.blue, 0)
})

test('an invalid submit changes nothing, not even the selection', () => {
  const room = playing()
  toggleTap(room, PUZZLE, 'HEART')
  toggleTap(room, PUZZLE, 'MIND')
  assert.equal(applyGuess(room, PUZZLE, NOW).kind, 'invalid')
  assert.deepEqual(room.selection, ['HEART', 'MIND'])
  assert.equal(room.turn, 'red')
  assert.equal(room.mistakes.red, 0)
})

test('the last group reveals itself for no points and ends the round', () => {
  const room = playing()
  guess(room, G0.members)   // red +1
  guess(room, G1.members)   // blue +2
  guess(room, G2.members)   // red +3, G3 is forced
  assert.equal(room.phase, 'done')
  assert.deepEqual(room.solved.at(-1), { groupId: 'g3', by: null, points: 0, at: NOW })
  assert.equal(room.turn, null)
  assert.deepEqual(room.totals, { red: 4, blue: 2, orange: 0, teal: 0 })
  assert.deepEqual(matchResult(room), { winner: 'red', reason: 'most points' })
})

test('a team out of lives is skipped; the survivor plays on alone', () => {
  const room = playing(2, 1)
  guess(room, WRONG)          // red out
  assert.equal(room.turn, 'blue')
  guess(room, G0.members)     // blue scores, red is out, so blue again
  assert.equal(room.turn, 'blue')
  assert.equal(nextTurn(room, 'blue'), 'blue')
})

test('the round ends when every team is out', () => {
  const room = playing(2, 1)
  guess(room, WRONG)
  guess(room, WRONG2)
  assert.equal(room.phase, 'done')
  assert.equal(room.turn, null)
})

test('three teams rotate in order', () => {
  const room = playing(3)
  guess(room, WRONG)
  assert.equal(room.turn, 'blue')
  guess(room, WRONG2)
  assert.equal(room.turn, 'orange')
  guess(room, WRONG3)
  assert.equal(room.turn, 'red')
})

test('skipTurn passes without a penalty', () => {
  const room = playing()
  toggleTap(room, PUZZLE, 'HEART')
  skipTurn(room)
  assert.equal(room.turn, 'blue')
  assert.equal(room.mistakes.red, 0)
  assert.deepEqual(room.selection, [])
})

test('finishRound adds points to totals exactly once', () => {
  const room = playing()
  guess(room, G3.members)
  finishRound(room)
  finishRound(room)
  assert.equal(room.totals.red, 4)
})

test('resetRound wipes progress but keeps totals and players', () => {
  const room = playing()
  room.players.p1 = { name: 'Ada', team: 'red', connected: true }
  guess(room, G3.members)
  finishRound(room)
  resetRound(room, PUZZLE)
  assert.equal(room.phase, 'lobby')
  assert.deepEqual(room.solved, [])
  assert.equal(room.totals.red, 4)
  assert.equal(room.players.p1.team, 'red')
})

test('matchResult: equal points fall to fewer mistakes, then a tie', () => {
  const room = playing()
  guess(room, G1.members)          // red +2
  guess(room, WRONG)               // blue miss
  guess(room, WRONG2)              // red miss
  guess(room, G1.members.slice(0)) // blue: invalid, G1 is solved
  assert.equal(room.turn, 'blue')
  guess(room, G2.members)          // blue +3
  assert.deepEqual(matchResult(room), { winner: 'blue', reason: 'most points' })

  const tie = playing()
  assert.deepEqual(matchResult(tie), { winner: 'tie', reason: 'level on points and mistakes' })
  guess(tie, WRONG)
  assert.deepEqual(matchResult(tie), { winner: 'blue', reason: 'fewer mistakes' })
})

// --- taps ---

test('toggleTap caps at four, toggles off, and ignores solved or unknown words', () => {
  const room = playing()
  for (const w of ['HEART', 'SOLD', 'LAND', 'AMAZING', 'MIND']) toggleTap(room, PUZZLE, w)
  assert.deepEqual(room.selection, ['HEART', 'SOLD', 'LAND', 'AMAZING'])
  toggleTap(room, PUZZLE, 'SOLD')
  assert.deepEqual(room.selection, ['HEART', 'LAND', 'AMAZING'])
  assert.equal(toggleTap(room, PUZZLE, 'NOPE'), false)
  assert.equal(toggleTap(room, PUZZLE, 'X'.repeat(MAX_WORD_LENGTH + 1)), false)
  room.selection = []
  guess(room, G0.members)
  assert.equal(toggleTap(room, PUZZLE, 'HEART'), false)
})

test('toggleTap does nothing outside a running round', () => {
  const room = newRoom('ABCD')
  resetRound(room, PUZZLE)
  assert.equal(toggleTap(room, PUZZLE, 'HEART'), false)
})

// --- redaction ---

test('only the admin view carries the answer key', () => {
  const room = playing()
  room.players.p1 = { name: 'Ada', team: 'red', connected: true }
  const player = JSON.stringify(toRoomView(room, PUZZLE, { kind: 'player', playerId: 'p1' }, NOW))
  const screen = JSON.stringify(toRoomView(room, PUZZLE, { kind: 'screen' }, NOW))
  for (const text of [player, screen]) {
    for (const secret of ['ONE ___', 'SOLD IT', 'OWNED', '___ GRACE', '"members"', '"g0"']) {
      assert.ok(!text.includes(secret), `leaked ${secret}`)
    }
  }
  assert.equal(toRoomView(room, PUZZLE, { kind: 'admin' }, NOW).answerKey?.length, 4)
})

test('a solved group is revealed to everyone, the rest are not', () => {
  const room = playing()
  guess(room, G0.members)
  const view = toRoomView(room, PUZZLE, { kind: 'screen' }, NOW)
  assert.deepEqual(view.solved.map(g => [g.id, g.by, g.points]), [['g0', 'red', 1]])
  assert.equal(view.board.length, 12)
  assert.ok(!JSON.stringify(view).includes('SOLD IT'))
  assert.deepEqual(view.leftover, [])
})

test('the lobby shows no words; done shows the leftover groups', () => {
  const room = newRoom('ABCD')
  resetRound(room, PUZZLE)
  assert.deepEqual(toRoomView(room, PUZZLE, { kind: 'screen' }, NOW).board, [])
  startRound(room, PUZZLE)
  guess(room, G0.members)
  finishRound(room)
  const view = toRoomView(room, PUZZLE, { kind: 'screen' }, NOW)
  assert.deepEqual(view.leftover.map(g => g.id), ['g1', 'g2', 'g3'])
  assert.equal(view.result?.winner, 'red')
})

test('player view: canAct only for the team on turn; no player ids on the wire', () => {
  const room = playing()
  room.players['secret-id-1'] = { name: 'Ada', team: 'red', connected: true }
  room.players['secret-id-2'] = { name: 'Bo', team: 'blue', connected: true }
  const red = toRoomView(room, PUZZLE, { kind: 'player', playerId: 'secret-id-1' }, NOW)
  const blue = toRoomView(room, PUZZLE, { kind: 'player', playerId: 'secret-id-2' }, NOW)
  assert.deepEqual(red.you, { team: 'red', canAct: true })
  assert.deepEqual(blue.you, { team: 'blue', canAct: false })
  assert.ok(!JSON.stringify(red).includes('secret-id'))
  assert.equal(red.teams[0].players[0].name, 'Ada')
})

test('team totals exclude the current round until it is scored, and never double count', () => {
  const room = playing()
  guess(room, G3.members)
  assert.equal(toRoomView(room, PUZZLE, { kind: 'screen' }, NOW).teams[0].total, 0)
  finishRound(room)
  const done = toRoomView(room, PUZZLE, { kind: 'screen' }, NOW).teams[0]
  assert.equal(done.total + done.points, 4)
})

// --- wire parsing and config ---

test('parseClientMsg accepts exactly the protocol', () => {
  assert.deepEqual(parseClientMsg('{"t":"tap","word":"HEART"}'), { t: 'tap', word: 'HEART' })
  assert.deepEqual(parseClientMsg('{"t":"join","team":"teal"}'), { t: 'join', team: 'teal' })
  assert.deepEqual(parseClientMsg('{"t":"submit"}'), { t: 'submit' })
  assert.equal(parseClientMsg('{"t":"join","team":"green"}'), null)
  assert.equal(parseClientMsg('{"t":"submit","extra":1}'), null)
  assert.equal(parseClientMsg(`{"t":"tap","word":"${'X'.repeat(MAX_WORD_LENGTH + 1)}"}`), null)
  assert.equal(parseClientMsg('not json'), null)
  assert.equal(parseClientMsg('[]'), null)
})

test('config validators', () => {
  assert.ok(isValidTeamCount(2) && isValidTeamCount(4))
  assert.ok(!isValidTeamCount(1) && !isValidTeamCount(5) && !isValidTeamCount(2.5) && !isValidTeamCount('3'))
  assert.ok(isValidLives(1) && isValidLives(6))
  assert.ok(!isValidLives(0) && !isValidLives(7))
})
