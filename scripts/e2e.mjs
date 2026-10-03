// End-to-end round against the real Worker + real Durable Object.
//
// Run it against a live dev server:
//   printf 'ADMIN_SECRET=test-secret-e2e\n' > .dev.vars
//   npm run dev -- --port 8799
//   npm run e2e
//
// This is the only check that exercises the admin-token gate, the
// screen/player/admin split, turn enforcement on real sockets, and the
// leader playing for a team. Pure rules live in src/shared/game.test.ts.
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

function connect(code, { playerId, name, role, token }) {
  const q = new URLSearchParams({ playerId, name: name ?? '' })
  if (role) q.set('role', role)
  if (token) q.set('token', token)
  const ws = new WebSocket(`${WS}/api/rooms/${code}/ws?${q}`)
  const frames = []
  ws.addEventListener('message', e => frames.push({ raw: e.data, msg: JSON.parse(e.data) }))
  ws.frames = frames
  ws.view = () => [...frames].reverse().find(f => f.msg.t === 'state')?.msg.room ?? null
  ws.errors = () => frames.filter(f => f.msg.t === 'error').map(f => f.msg.message)
  ws.guesses = () => frames.filter(f => f.msg.t === 'guess').map(f => f.msg.event)
  return new Promise((res, rej) => {
    ws.addEventListener('open', () => res(ws))
    ws.addEventListener('error', rej)
  })
}

const send = (ws, msg) => ws.send(JSON.stringify(msg))
const settle = () => new Promise(r => setTimeout(r, 300))
async function pick(ws, words) {
  send(ws, { t: 'clear' })
  for (const word of words) send(ws, { t: 'tap', word })
  await settle()
}

// Answer key for acts4-unity, from src/puzzles.ts.
const ONE = ['HEART', 'MIND', 'SOUL', 'SPIRIT']
const DID = ['SOLD', 'BROUGHT', 'LAID', 'DISTRIBUTED']
const OWNED = ['LAND', 'HOUSES', 'MONEY', 'POSSESSIONS']
const WRONG = ['SOLD', 'LAND', 'AMAZING', 'SAVING']

// --- auth ---
check('login with wrong password rejected', (await post('/api/admin/login', { password: 'wrong' })).status === 401)
const loginRes = await post('/api/admin/login', { password: PASSWORD })
check('login with correct password succeeds', loginRes.ok)
const { token } = await loginRes.json()
check('room creation without token rejected', (await post('/api/rooms', {}, null)).status === 401)
check(
  'room creation with forged HMAC rejected',
  (await post('/api/rooms', {}, `${Date.now() + 1e6}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).status === 401,
)
const { puzzles } = await (await fetch(BASE + '/api/puzzles', { headers: { authorization: `Bearer ${token}` } })).json()
check('puzzle list carries no answer key', !JSON.stringify(puzzles).includes('HEART'))
check('warm-ups are listed before scripture', puzzles[0].kind === 'warmup' && puzzles.at(-1).kind === 'scripture')

// --- room + sockets ---
const { code } = await (await post('/api/rooms', {}, token)).json()
check('room created', typeof code === 'string' && code.length === 4, `code=${code}`)
check('setPuzzle ok', (await post(`/api/rooms/${code}/puzzle`, { puzzleId: 'acts4-unity' }, token)).ok)
check('config rejects 5 teams', (await post(`/api/rooms/${code}/config`, { teamCount: 5 }, token)).status === 400)
check('config: 3 teams, 2 lives', (await post(`/api/rooms/${code}/config`, { teamCount: 3, lives: 2 }, token)).ok)

const screen = await connect(code, { playerId: 'tv', name: 'TV', role: 'screen' })
const red = await connect(code, { playerId: 'r1', name: 'Ada', role: 'player' })
const blue = await connect(code, { playerId: 'b1', name: 'Linus', role: 'player' })
const admin = await connect(code, { playerId: 'admin1', name: 'Leader', role: 'admin', token })
const fake = await connect(code, { playerId: 'fake1', name: 'Fake', role: 'admin', token: `${Date.now() + 1e6}.bm90YXJlYWxtYWM` })
await settle()

check('screen needs no login', screen.view()?.viewer === 'screen')
check('admin with a valid token is admin', admin.view()?.viewer === 'admin')
check('admin view carries the answer key', admin.view()?.answerKey?.length === 4)
check('forged admin token is downgraded to a player', fake.view()?.viewer === 'player')
check('no answer key anywhere but the admin socket',
  [screen, red, blue, fake].every(ws => ws.frames.every(f => !f.raw.includes('"members"') && !f.raw.includes('ONE ___'))))
check('lobby board is empty', screen.view().board.length === 0)
check('three teams in the view', screen.view().teams.map(t => t.id).join() === 'red,blue,orange')

send(red, { t: 'join', team: 'red' })
send(blue, { t: 'join', team: 'blue' })
send(fake, { t: 'join', team: 'teal' })
await settle()
send(fake, { t: 'join', team: 'red' }); await settle()
check('a team has only one captain', fake.errors().includes('Ada is already captain of that team') && fake.view().you.team === null)
check('captain joins red', red.view().you.team === 'red')
check('captain names reach the screen', screen.view().teams[0].players[0]?.name === 'Ada')
check('an inactive team cannot be joined', fake.errors().includes('that team is not playing'))
check('player ids never reach the screen', screen.frames.every(f => !f.raw.includes('"r1"') && !f.raw.includes('"b1"')))
fake.close()

for (const path of ['/admin', '/screen', `/screen/${code}`, `/play/${code}`]) {
  const res = await fetch(BASE + path)
  check(`${path} serves the SPA shell`, res.ok && (res.headers.get('content-type') ?? '').includes('text/html'))
}

// --- the round ---
check('start ok', (await post(`/api/rooms/${code}/start`, {}, token)).ok)
await settle()
check('red goes first', screen.view().turn === 'red' && red.view().you.canAct && !blue.view().you.canAct)
check('board has 16 words', screen.view().board.length === 16)

send(blue, { t: 'join', team: 'red' }); await settle()
check('teams are locked mid-round', blue.errors().includes('teams are locked until the round ends'))
send(blue, { t: 'tap', word: 'HEART' }); await settle()
check('blue cannot tap on red\'s turn', blue.errors().includes('not your turn') && screen.view().selection.length === 0)
send(screen, { t: 'tap', word: 'HEART' }); await settle()
check('the screen is read-only', screen.errors().includes('the big screen is read-only'))

await pick(red, ONE)
check('red\'s picks show live on the screen', screen.view().selection.length === 4)
send(red, { t: 'submit' }); await settle()
const solved = screen.guesses().at(-1)
check('correct guess is announced to everyone', solved?.outcome === 'correct' && solved.team === 'red' && blue.guesses().length === 1)
check('red scores 1 for yellow', screen.view().teams[0].points === 1)
check('turn passes to blue', screen.view().turn === 'blue')
check('12 words left', screen.view().board.length === 12)

await pick(blue, WRONG)
send(blue, { t: 'submit' }); await settle()
check('wrong guess costs blue a heart', screen.view().teams[1].mistakes === 1)
check('turn passes to orange', screen.view().turn === 'orange')

// Orange has no captain: the leader plays for them.
await pick(admin, DID)
send(admin, { t: 'submit' }); await settle()
check('leader can play for the team on turn', screen.view().teams[2].points === 2)
check('back to red', screen.view().turn === 'red')

check('skip ok', (await post(`/api/rooms/${code}/skip`, {}, token)).ok)
await settle()
check('skip passes the turn without a penalty', screen.view().turn === 'blue' && screen.view().teams[0].mistakes === 0)

send(blue, { t: 'tap', word: 'LAND' }); send(blue, { t: 'submit' }); await settle()
check('under-filled submit is refused, selection kept', blue.errors().includes('pick exactly 4 words') && screen.view().selection.length === 1)

await pick(blue, OWNED)
send(blue, { t: 'submit' }); await settle()
const view = screen.view()
check('third group ends the round', view.phase === 'done')
check('last group auto-revealed for nobody', view.solved.at(-1)?.by === null && view.solved.length === 4)
check('blue wins on points', view.result?.winner === 'blue', JSON.stringify(view.result))

// --- settings are locked on the results screen ---
check('teams cannot change on the results screen', (await post(`/api/rooms/${code}/config`, { teamCount: 2 }, token)).status === 400)
check('lives cannot change on the results screen', (await post(`/api/rooms/${code}/config`, { lives: 6 }, token)).status === 400)
await settle()
check('finished result is untouched', screen.view().result?.winner === 'blue' && screen.view().teams.length === 3)

// --- next round ---
check('puzzle change ok', (await post(`/api/rooms/${code}/puzzle`, { puzzleId: 'warmup-space' }, token)).ok)
await settle()
check('new puzzle is back in the lobby', screen.view().phase === 'lobby' && screen.view().solved.length === 0)
check('night totals carried over', screen.view().teams.map(t => t.total).join() === '1,3,2')
check('captains kept their teams', red.view().you.team === 'red')
check('start round 2 ok', (await post(`/api/rooms/${code}/start`, {}, token)).ok)
await settle()
check('round 2 starts with blue', screen.view().turn === 'blue')
const round2Board = screen.view().board.join()
check('config rejected mid-round', (await post(`/api/rooms/${code}/config`, { lives: 3 }, token)).status === 400)
check('reset mid-round ok', (await post(`/api/rooms/${code}/reset`, {}, token)).ok)
check('restart ok', (await post(`/api/rooms/${code}/start`, {}, token)).ok)
await settle()
check('a mid-round reset keeps the same first team', screen.view().turn === 'blue')
check('a mid-round reset keeps the same board', screen.view().board.join() === round2Board)
check('zero ok', (await post(`/api/rooms/${code}/zero`, {}, token)).ok)
await settle()
check('totals zeroed', screen.view().teams.every(t => t.total === 0))
check('end ok', (await post(`/api/rooms/${code}/end`, {}, token)).ok)
await settle()
check('leftover groups revealed after end', screen.view().leftover.length === 4)
check('zero on the results screen ok', (await post(`/api/rooms/${code}/zero`, {}, token)).ok)
await settle()
check('no negative totals after zeroing a finished round', screen.view().teams.every(t => t.total === 0))

// --- turn timer: the Durable Object alarm passes the turn on its own ---
check('timer rejects an odd value', (await post(`/api/rooms/${code}/config`, { turnSeconds: 7 }, token)).status === 400)
check('timer can change on the results screen', (await post(`/api/rooms/${code}/config`, { turnSeconds: 30 }, token)).ok)
check('restart with a 30s timer ok', (await post(`/api/rooms/${code}/puzzle`, { puzzleId: 'acts4-unity' }, token)).ok
  && (await post(`/api/rooms/${code}/start`, {}, token)).ok)
await settle()
const timed = screen.view()
const timedTeam = timed.turn
check('the turn has a 30s deadline', timed.turnEndsAt - timed.serverNow > 28_000 && timed.turnEndsAt - timed.serverNow <= 30_000)
const guessesBefore = screen.guesses().length
console.log('      waiting out the 30s turn...')
await new Promise(r => setTimeout(r, timed.turnEndsAt - timed.serverNow + 2_000))
const timeout = screen.guesses().slice(guessesBefore).find(g => g.outcome === 'timeout')
check('time-out is announced', timeout?.team === timedTeam)
check('time-out passes the turn', screen.view().turn !== timedTeam && screen.view().turn !== null)
check('time-out costs no heart', screen.view().teams.find(t => t.id === timedTeam).mistakes === 0)
check('the next team gets a fresh clock', screen.view().turnEndsAt - screen.view().serverNow > 25_000)
check('timer off mid-round ok', (await post(`/api/rooms/${code}/config`, { turnSeconds: 0 }, token)).ok)
await settle()
check('timer off stops the clock now', screen.view().turnEndsAt === null)

for (const ws of [screen, red, blue, admin]) ws.close()
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
