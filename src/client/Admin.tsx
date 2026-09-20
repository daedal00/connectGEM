import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useRoom } from './useRoom.ts'
import * as api from './adminApi.ts'
import { GROUP_SIZE, MAX_MISTAKES } from '../shared/game.ts'
import type { PuzzleSummary, TeamId } from '../shared/types.ts'

const ROOM_KEY = 'connectgem:adminRoom'

export function Login({ heading, onToken }: { heading: string; onToken: (token: string) => void }) {
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
      <h1>{heading}</h1>
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

function Roster({ team, players }: { team: TeamId; players: Record<string, { name: string; connected: boolean }> }) {
  const entries = Object.entries(players)
  return (
    <div className={`roster ${team}`}>
      <h3>{team} team ({entries.filter(([, p]) => p.connected).length} here)</h3>
      {entries.length === 0 ? (
        <p className="hint">Nobody yet.</p>
      ) : (
        <ul>
          {entries.map(([id, player]) => (
            <li key={id} className={player.connected ? '' : 'away'}>
              {player.name}
              {!player.connected && <span className="hint"> away</span>}
            </li>
          ))}
        </ul>
      )}
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
  const { status, view } = useRoom(code, 'Leader', null, { role: 'admin', token })
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  // Every admin call funnels through here so an expired token drops back to
  // the login form from one place instead of each button growing its own
  // copy of the same catch.
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

  // The admin socket is a verified spectator. Anything else means the token
  // was rejected at the upgrade, so say so rather than render a blank console.
  if (!view) {
    return (
      <main className="wrap">
        <h1>Room {code}</h1>
        <p className={`status ${status}`} aria-live="polite">{status}...</p>
        <button className="action" onClick={onLeave}>Back</button>
      </main>
    )
  }
  if (view.viewer !== 'spectator') {
    return (
      <main className="wrap">
        <h1>Room {code}</h1>
        <p className="error">This room did not accept the leader session. Log in again.</p>
        <button className="action" onClick={onExpired}>Log in</button>
      </main>
    )
  }

  const phase = view.phase
  return (
    <main className="wrap">
      <div className="topbar">
        <div>
          <h1 className="room-code">{code}</h1>
          <p className="scripture">{view.puzzle ? `${view.puzzle.title} - ${view.puzzle.scripture}` : 'No puzzle yet'}</p>
        </div>
        <span className={`status ${status}`} aria-live="polite">{phase}</span>
      </div>

      <p className="hint">
        Players join at <strong>{location.origin}/play/{code}</strong> - big screen at{' '}
        <a href={`/screen/${code}`} target="_blank" rel="noreferrer">/screen/{code}</a>
      </p>

      <label className="field">
        <span>Puzzle</span>
        <select
          value={view.puzzleId ?? ''}
          disabled={busy || phase === 'playing'}
          onChange={e => {
            const puzzleId = e.target.value
            run(() => api.setPuzzle(token, code, puzzleId))
          }}
        >
          <option value="" disabled>Pick a puzzle</option>
          {puzzles.map(puzzle => (
            <option key={puzzle.id} value={puzzle.id}>{puzzle.title} ({puzzle.scripture})</option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Teammates needed to submit</span>
        <div className="teams">
          {Array.from({ length: GROUP_SIZE }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              type="button"
              className={`team-btn${view.confirmsRequired === n ? ' on' : ''}`}
              aria-pressed={view.confirmsRequired === n}
              disabled={busy}
              onClick={() => run(() => api.setConfirmsRequired(token, code, n))}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="controls">
        <button
          className="action primary"
          disabled={busy || phase !== 'lobby' || !view.puzzleId}
          onClick={() => run(() => api.roomAction(token, code, 'start'))}
        >
          Start round
        </button>
        <button
          className="action"
          disabled={busy || phase !== 'playing'}
          onClick={() => run(() => api.roomAction(token, code, 'end'))}
        >
          End round
        </button>
        <button
          className="action"
          disabled={busy}
          onClick={() => {
            // Wipes both teams' progress. Cheap to redo, expensive to do by
            // accident mid-round with twenty teenagers watching.
            if (confirm(`Reset room ${code}? Both teams lose all progress.`)) {
              run(() => api.roomAction(token, code, 'reset'))
            }
          }}
        >
          Reset
        </button>
      </div>

      <p className="error" aria-live="assertive">{problem}</p>

      {phase === 'done' && view.result && (
        <div className="winner">
          {view.result.winner === 'tie' ? 'Tie' : `${view.result.winner} team wins`} - {view.result.reason}
        </div>
      )}

      <div className="boards">
        {(['red', 'blue'] as const).map(team => (
          <div key={team} className="column">
            <Roster team={team} players={view[team].players} />
            <p className="hint">
              {view[team].solved.length}/{GROUP_SIZE} solved,{' '}
              {MAX_MISTAKES - view[team].mistakes} mistakes left
            </p>
          </div>
        ))}
      </div>

      <button className="action" onClick={onLeave}>Manage a different room</button>
    </main>
  )
}

export function Admin() {
  const [token, setToken] = useState<string | null>(api.readToken)
  const [code, setCode] = useState<string | null>(() => sessionStorage.getItem(ROOM_KEY))
  const [puzzles, setPuzzles] = useState<PuzzleSummary[]>([])
  const [typedCode, setTypedCode] = useState('')
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
    sessionStorage.setItem(ROOM_KEY, next)
    setCode(next)
  }, [])

  if (!token) return <Login heading="Leader" onToken={setToken} />

  if (code) {
    return (
      <AdminRoom
        token={token}
        code={code}
        puzzles={puzzles}
        onExpired={forgetToken}
        onLeave={() => {
          sessionStorage.removeItem(ROOM_KEY)
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
      <button className="action primary" onClick={makeRoom} disabled={busy}>
        {busy ? 'Creating...' : 'New room'}
      </button>
      <form
        onSubmit={e => {
          e.preventDefault()
          const clean = typedCode.trim().toUpperCase()
          if (clean.length === 4) open(clean)
        }}
      >
        <label className="field">
          <span>Or manage an existing room</span>
          <input
            className="code-input"
            value={typedCode}
            onChange={e => setTypedCode(e.target.value.toUpperCase())}
            maxLength={4}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD"
          />
        </label>
        <button type="submit" className="action" disabled={typedCode.trim().length !== 4}>Open</button>
      </form>
      <p className="error" aria-live="assertive">{problem}</p>
      <button className="action" onClick={forgetToken}>Log out</button>
    </main>
  )
}
