// End-to-end round against the real Worker + real Durable Object.
//
// Run it against a live dev server:
//   printf 'ADMIN_SECRET=test-secret-e2e\n' > .dev.vars
//   npm run dev -- --port 8799
//   npm run e2e
//
// This is the only check that exercises the admin-token gate, the
// spectator/player split, and the two-distinct-confirms rule end to end.
// The pure rules live in src/shared/game.test.ts; everything here needs a
// real DO, real sockets, and real hibernation-style attachments.
const BASE = 'http://localhost:8799'
const WS = 'ws://localhost:8799'
const PASSWORD = 'test-secret-e2e'

let failures = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
  if (!cond) failures++
}

const post = (path, body, token) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  })

function connect(code, { playerId, name, team, role, token }) {
  const q = new URLSearchParams({ playerId, name: name ?? '' })
  if (team) q.set('team', team)
  if (role) q.set('role', role)
  if (token) q.set('token', token)
  const ws = new WebSocket(`${WS}/api/rooms/${code}/ws?${q}`)
  const frames = []
  ws.addEventListener('message', e => frames.push({ raw: e.data, msg: JSON.parse(e.data) }))
  ws.frames = frames
  ws.latestView = () => [...frames].reverse().find(f => f.msg.t === 'state')?.msg.room ?? null
  return new Promise((res, rej) => {
    ws.addEventListener('open', () => res(ws))
    ws.addEventListener('error', rej)
  })
}

const send = (ws, msg) => ws.send(JSON.stringify(msg))
const settle = () => new Promise(r => setTimeout(r, 350))

// --- auth ---
const badLogin = await post('/api/admin/login', { password: 'wrong' })
check('login with wrong password rejected', badLogin.status === 401, `status=${badLogin.status}`)

const loginRes = await post('/api/admin/login', { password: PASSWORD })
check('login with correct password succeeds', loginRes.ok, `status=${loginRes.status}`)
const { token } = await loginRes.json()

const noAuth = await post('/api/rooms', {}, null)
check('room creation without token rejected', noAuth.status === 401, `status=${noAuth.status}`)

const forged = await post('/api/rooms', {}, `${Date.now() + 1e6}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
check('room creation with forged HMAC rejected', forged.status === 401, `status=${forged.status}`)

const puzzlesRes = await fetch(BASE + '/api/puzzles', { headers: { authorization: `Bearer ${token}` } })
const { puzzles } = await puzzlesRes.json()
check('puzzle list carries no answer key', !JSON.stringify(puzzles).includes('HEART'), JSON.stringify(puzzles[0]))

// --- room setup ---
const { code } = await (await post('/api/rooms', {}, token)).json()
check('room created', typeof code === 'string' && code.length === 4, `code=${code}`)
check('setPuzzle ok', (await post(`/api/rooms/${code}/puzzle`, { puzzleId: 'acts4-unity' }, token)).ok)
check('start ok', (await post(`/api/rooms/${code}/start`, {}, token)).ok)

// --- sockets ---
const red1 = await connect(code, { playerId: 'r1', name: 'Ada', team: 'red' })
const red2 = await connect(code, { playerId: 'r2', name: 'Grace', team: 'red' })
const blue1 = await connect(code, { playerId: 'b1', name: 'Linus', team: 'blue' })
// SECURITY: asks for role=screen with NO admin token.
const sneak = await connect(code, { playerId: 's1', name: 'Sneak', team: 'blue', role: 'screen' })
const screen = await connect(code, { playerId: 'tv', name: 'TV', role: 'screen', token })
await settle()

check('unauthenticated role=screen is downgraded to player', sneak.latestView().viewer === 'player', `viewer=${sneak.latestView().viewer}`)
check('authenticated role=screen is a spectator', screen.latestView().viewer === 'spectator', `viewer=${screen.latestView().viewer}`)
check('spectator sees both boards', screen.latestView().red.board.length === 16 && screen.latestView().blue.board.length === 16)

const redBoard = red1.latestView().you.board
check('red sees its own 16 tiles', redBoard.length === 16)
check('player view has no opponent board field', red1.latestView().opponent.board === undefined)
check('both teams get the identical starting order', JSON.stringify(redBoard) === JSON.stringify(blue1.latestView().you.board))

// --- shared board: a tap by one teammate reaches the other ---
const word = 'HEART'
send(red1, { t: 'tap', word })
await settle()
check('teammate sees the tap with the tapper id', red2.latestView().you.selection[word]?.includes('r1') === true, JSON.stringify(red2.latestView().you.selection))
check('opponent never sees red selection', blue1.frames.every(f => !f.raw.includes('"r1"')))

// --- two distinct confirms required ---
for (const w of ['MIND', 'SOUL', 'SPIRIT']) send(red1, { t: 'tap', word: w })
await settle()
send(red1, { t: 'submit' })
send(red1, { t: 'submit' }) // same player twice must not count twice
await settle()
check('one player cannot solve alone (idempotent confirm)', red1.latestView().you.solved.length === 0, `confirms=${JSON.stringify(red1.latestView().you.confirms)}`)
check('double submit from one player counts once', red1.latestView().you.confirms.length === 1)

send(red2, { t: 'submit' })
await settle()
check('two distinct confirms solve the group', red1.latestView().you.solved.length === 1, JSON.stringify(red1.latestView().you.solved.map(g => g.name)))
check('solved group revealed to the solving team', red1.frames.some(f => f.msg.t === 'yourResult' && f.msg.outcome.kind === 'correct'))

// --- THE leak test: nothing about the answer reaches blue ---
// Both teams race the SAME puzzle, so the four words are legitimately on
// blue's own board. The leak surface is the GROUPING, not the words: a group
// name, a group id, or red's board/selection/guesses shrinking in blue's view.
const blueText = blue1.frames.map(f => f.raw).join('\n')
for (const leak of ['ONE IN', 'g0', 'g1', 'g2', 'g3', 'difficulty', 'members'])
  check(`blue frames never contain "${leak}"`, !blueText.includes(leak))
check('blue board still has all 16 tiles after red solves', blue1.latestView().you.board.length === 16)
check('red board lost the 4 solved tiles', red1.latestView().you.board.length === 12)
check(
  'opponent object exposes only counts',
  JSON.stringify(Object.keys(blue1.latestView().opponent).sort()) ===
    JSON.stringify(['finishedAt', 'mistakes', 'playerCount', 'solvedCount']),
  JSON.stringify(blue1.latestView().opponent),
)
check('blue is told the opponent solved something', blue1.frames.some(f => f.msg.t === 'opponentResult' && f.msg.outcome.solved === true))
check('opponentResult carries no group', blue1.frames.filter(f => f.msg.t === 'opponentResult').every(f => f.msg.outcome.group === undefined))
check('blue sees opponent solvedCount only', blue1.latestView().opponent.solvedCount === 1)

// --- spectator cannot act ---
send(screen, { t: 'tap', word: 'LAND' })
await settle()
check('spectator action refused', screen.frames.some(f => f.msg.t === 'error' && f.msg.message === 'spectators cannot act'))

// --- one away + mistakes ---
send(red1, { t: 'clear' }); await settle()
for (const w of ['SOLD', 'BROUGHT', 'LAID', 'LAND']) send(red1, { t: 'tap', word: w })
await settle()
send(red1, { t: 'submit' }); send(red2, { t: 'submit' }); await settle()
check('one away detected', red1.frames.some(f => f.msg.t === 'yourResult' && f.msg.outcome.kind === 'oneAway'))
check('one away costs a mistake', red1.latestView().you.mistakes === 1)

// --- tap validation ---
send(red1, { t: 'tap', word: 'NOTAWORD' }); await settle()
check('unknown word rejected', red1.latestView().you.selection['NOTAWORD'] === undefined)
send(red1, { t: 'tap', word: 'X'.repeat(500) }); await settle()
check('over-long word rejected', Object.keys(red1.latestView().you.selection).every(k => k.length < 100))
red1.send('{"t":"tap","word":"HEART","__proto__":{}}'); await settle()
check('malformed message rejected', red1.frames.some(f => f.msg.t === 'error' && f.msg.message === 'malformed message'))

// --- clock ---
check('serverNow present and sane', Math.abs(red1.latestView().serverNow - Date.now()) < 10000)
check('solution withheld while playing', red1.latestView().solution === null && red1.latestView().result === null)

// --- an invalid (under-filled) guess must not destroy the team's selection ---
send(red1, { t: 'clear' }); await settle()
for (const w of ['HOUSES', 'MONEY']) send(red1, { t: 'tap', word: w })
await settle()
send(red1, { t: 'submit' }); send(red2, { t: 'submit' }); await settle()
check('under-filled guess costs no mistake', red1.latestView().you.mistakes === 1, `mistakes=${red1.latestView().you.mistakes}`)
check(
  'under-filled guess does not wipe the team selection',
  Object.keys(red1.latestView().you.selection).length === 2,
  JSON.stringify(red1.latestView().you.selection),
)
check('under-filled guess resets confirms', red1.latestView().you.confirms.length === 0)
send(red1, { t: 'clear' }); await settle()

// --- end the round ---
await post(`/api/rooms/${code}/end`, {}, token); await settle()
check('phase done after admin end', red1.latestView().phase === 'done')
check('solution revealed on done', red1.latestView().solution?.length === 4)
check('result computed on done', red1.latestView().result?.winner !== undefined, JSON.stringify(red1.latestView().result))

for (const ws of [red1, red2, blue1, sneak, screen]) ws.close()
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
