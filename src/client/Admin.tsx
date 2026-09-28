// The leader's remote control, built for a phone: runs the room, drives the
// big screen, and can tap in a guess for whichever team is on turn.
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useRoom } from './useRoom.ts'
import * as api from './adminApi.ts'
import { Band, teamLabel } from './Board.tsx'
import { CodeForm } from './Join.tsx'
import { PlayControls, Scores } from './Play.tsx'
import { MAX_LIVES, MAX_TEAMS, MIN_LIVES, MIN_TEAMS } from '../shared/game.ts'
import type { PuzzleSummary } from '../shared/types.ts'

const ROOM_KEY = 'connectgem:adminRoom'

function Login({ onToken }: { onToken: (token: string) => void }) {
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  async function go(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem('')
    try {
      onToken(await api.login(password))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="wrap">
      <h1>Leader</h1>
      <form onSubmit={go}>
        <label className="field">
          <span>Leader password</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button type="submit" className="action primary" disabled={busy || password.length === 0}>
          {busy ? 'Checking...' : 'Log in'}
        </button>
        <p className="error" aria-live="assertive">{problem}</p>
      </form>
    </main>
  )
}

function Stepper({ label, value, min, max, disabled, onPick }: {
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  onPick: (n: number) => void
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="stepper">
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(n => (
          <button
            key={n}
            type="button"
            className={`step${value === n ? ' on' : ''}`}
            aria-pressed={value === n}
            disabled={disabled}
            onClick={() => onPick(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

function AdminRoom({
  token,
  code,
  puzzles,
  onExpired,
  onLeave,
}: {
  token: string
  code: string
  puzzles: PuzzleSummary[]
  onExpired: () => void
  onLeave: () => void
}) {
  const room = useRoom(code, { role: 'admin', name: 'Leader', token })
  const { status, view } = room
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)

  // Every admin call funnels through here so an expired token drops back to
  // the login form from one place.
  const run = useCallback(
    async (work: () => Promise<unknown>) => {
      setBusy(true)
      setProblem('')
      try {
        await work()
      } catch (err) {
        setProblem(err instanceof Error ? err.message : 'Action failed.')
        if (!api.readToken()) onExpired()
      } finally {
        setBusy(false)
      }
    },
    [onExpired],
  )

  if (!view) {
    return (
      <main className="wrap">
        <h1 className="room-code">{code}</h1>
        <p className={`status ${status}`} aria-live="polite">{status}...</p>
        {status === 'reconnecting' && <p className="hint">Room {code} may have expired. Start a new one.</p>}
        <button className="action" onClick={onLeave}>Back</button>
      </main>
    )
  }
  // A non-admin view means the token was rejected at the upgrade.
  if (view.viewer !== 'admin') {
    return (
      <main className="wrap">
        <h1 className="room-code">{code}</h1>
        <p className="error">This room did not accept the leader session. Log in again.</p>
        <button className="action" onClick={onExpired}>Log in</button>
      </main>
    )
  }

  const phase = view.phase
  const playing = phase === 'playing'
  const currentIndex = puzzles.findIndex(p => p.id === view.puzzle?.id)
  const nextPuzzle = puzzles[(currentIndex + 1) % Math.max(puzzles.length, 1)]
  const warmups = puzzles.filter(p => p.kind === 'warmup')
  const scripture = puzzles.filter(p => p.kind === 'scripture')
  const solvedIds = new Set(view.solved.map(g => g.id))

  return (
    <main className="wrap admin">
      <div className="topbar">
        <h1 className="room-code">{code}</h1>
        <span className={`status ${status}`} aria-live="polite">{status === 'open' ? phase : status}</span>
      </div>
      <p className="hint left">
        Big screen: <strong>{location.host}/screen/{code}</strong>
        <br />
        Captains: <strong>{location.host}/play</strong>, code {code}
      </p>

      {playing && (
        <section className="panel">
          <div className={`turn-strip ${view.turn ?? ''} mine`}>
            {view.turn ? `${teamLabel(view.turn)}'S TURN - you can tap for them` : ''}
          </div>
          <PlayControls room={room} view={view} enabled />
          <div className="controls">
            <button className="action" disabled={busy} onClick={() => run(() => api.roomAction(token, code, 'skip'))}>
              Skip turn
            </button>
            <button
              className="action"
              disabled={busy}
              onClick={() => {
                if (confirm('End the round now? Unsolved groups are revealed.')) run(() => api.roomAction(token, code, 'end'))
              }}
            >
              End round
            </button>
          </div>
        </section>
      )}

      {phase === 'done' && view.result && (
        <section className="panel">
          <div className="winner">
            {view.result.winner === 'tie' ? "It's a tie" : `${teamLabel(view.result.winner)} wins`}
            <div className="hint">{view.result.reason}</div>
          </div>
          {view.solved.map(group => <Band key={group.id} group={group} />)}
          {view.leftover.map(group => <Band key={group.id} group={group} missed />)}
        </section>
      )}

      <Scores view={view} />
      <ul className="roster">
        {view.teams.map(team => (
          <li key={team.id}>
            <strong className={`team-text ${team.id}`}>{teamLabel(team.id)}</strong>{' '}
            {team.players.length === 0
              ? <span className="hint">no captain - you can tap for them</span>
              : team.players.map((p, i) => (
                  <span key={i} className={p.connected ? '' : 'away'}>{i > 0 ? ', ' : ''}{p.name}{p.connected ? '' : ' (away)'}</span>
                ))}
            {view.round > 0 && <span className="hint"> · night total {team.total + (phase === 'done' ? team.points : 0)}</span>}
          </li>
        ))}
      </ul>

      {!playing && (
        <section className="panel">
          <h2>Next round</h2>
          <label className="field">
            <span>Puzzle</span>
            <select
              value={view.puzzle?.id ?? ''}
              disabled={busy}
              onChange={e => {
                const puzzleId = e.target.value
                run(() => api.setPuzzle(token, code, puzzleId))
              }}
            >
              <option value="" disabled>Pick a puzzle</option>
              <optgroup label="Warm-up (start here)">
                {warmups.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </optgroup>
              <optgroup label="Acts 4">
                {scripture.map(p => <option key={p.id} value={p.id}>{p.title} ({p.scripture})</option>)}
              </optgroup>
            </select>
          </label>
          {nextPuzzle && (
            <button
              className="action wide"
              disabled={busy}
              onClick={() => run(() => api.setPuzzle(token, code, nextPuzzle.id))}
            >
              {view.puzzle ? 'Next puzzle' : 'First puzzle'}: {nextPuzzle.title}
            </button>
          )}

          <Stepper
            label="Teams"
            value={view.teams.length}
            min={MIN_TEAMS}
            max={MAX_TEAMS}
            disabled={busy}
            onPick={n => run(() => api.setConfig(token, code, { teamCount: n }))}
          />
          <Stepper
            label="Lives per team"
            value={view.lives}
            min={MIN_LIVES}
            max={MAX_LIVES}
            disabled={busy}
            onPick={n => run(() => api.setConfig(token, code, { lives: n }))}
          />

          <button
            className="action primary wide"
            disabled={busy || !view.puzzle}
            onClick={() => run(() => api.roomAction(token, code, 'start'))}
          >
            {view.puzzle ? `Start "${view.puzzle.title}"` : 'Pick a puzzle first'}
          </button>
        </section>
      )}

      <p className="error" aria-live="assertive">{problem}</p>

      {view.answerKey && phase !== 'done' && (
        <section className="panel">
          <button className="action wide" onClick={() => setShowKey(s => !s)}>
            {showKey ? 'Hide answers' : 'Show answers (keep your phone off the projector)'}
          </button>
          {showKey && view.answerKey.map(group => (
            <div key={group.id} className={solvedIds.has(group.id) ? 'key-row solved' : 'key-row'}>
              <Band group={group} />
            </div>
          ))}
        </section>
      )}

      <div className="controls">
        <button
          className="action"
          disabled={busy || !view.puzzle}
          onClick={() => {
            // Wipes the round in progress. Cheap to redo, expensive to do by
            // accident with twenty teenagers watching.
            if (confirm('Reset this round? The board goes back to the start.')) run(() => api.roomAction(token, code, 'reset'))
          }}
        >
          Reset round
        </button>
        <button
          className="action"
          disabled={busy}
          onClick={() => {
            if (confirm('Zero every team\'s night total?')) run(() => api.roomAction(token, code, 'zero'))
          }}
        >
          Zero totals
        </button>
      </div>
      <button className="action wide" onClick={onLeave}>Switch room</button>
    </main>
  )
}

export function Admin() {
  const [token, setToken] = useState<string | null>(api.readToken)
  const [code, setCode] = useState<string | null>(() => localStorage.getItem(ROOM_KEY))
  const [puzzles, setPuzzles] = useState<PuzzleSummary[]>([])
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  const forgetToken = useCallback(() => {
    api.clearToken()
    setToken(null)
  }, [])

  useEffect(() => {
    if (!token) return
    let live = true
    api
      .listPuzzles(token)
      .then(list => live && setPuzzles(list))
      .catch(() => {
        if (live && !api.readToken()) forgetToken()
      })
    return () => {
      live = false
    }
  }, [token, forgetToken])

  const open = useCallback((next: string) => {
    localStorage.setItem(ROOM_KEY, next)
    setCode(next)
  }, [])

  if (!token) return <Login onToken={setToken} />

  if (code) {
    return (
      <AdminRoom
        token={token}
        code={code}
        puzzles={puzzles}
        onExpired={forgetToken}
        onLeave={() => {
          localStorage.removeItem(ROOM_KEY)
          setCode(null)
        }}
      />
    )
  }

  async function makeRoom() {
    if (!token) return
    setBusy(true)
    setProblem('')
    try {
      open(await api.createRoom(token))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not create a room.')
      if (!api.readToken()) forgetToken()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="wrap">
      <h1>Leader</h1>
      <button className="action primary wide" onClick={makeRoom} disabled={busy}>
        {busy ? 'Creating...' : 'New room'}
      </button>
      <p className="hint">Or pick up a room you already made:</p>
      <CodeForm label="Open room" onCode={open} />
      <p className="error" aria-live="assertive">{problem}</p>
      <button className="action wide" onClick={forgetToken}>Log out</button>
    </main>
  )
}
