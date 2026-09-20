import { useEffect, useRef, useState } from 'react'
import { useRoom } from './useRoom.ts'
import { DIFFICULTY_COLORS, GROUP_SIZE, MAX_MISTAKES } from '../shared/game.ts'
import type { Group, TeamId } from '../shared/types.ts'

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function Band({ group }: { group: Group }) {
  return (
    <div className="band" style={{ background: DIFFICULTY_COLORS[group.difficulty] }}>
      <div className="band-name">{group.name}</div>
      <div className="band-words">{group.members.join(', ')}</div>
    </div>
  )
}

export function Board({ code, name, team }: { code: string; name: string; team: TeamId }) {
  const { playerId, status, view, error, result, tap, clear, shuffle, submit } = useRoom(code, name, team)
  const [flash, setFlash] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)

  // The race is scored on server time. Rather than trusting the phone clock,
  // keep the offset from the last snapshot and tick locally against it.
  const offsetRef = useRef(0)
  const [, retick] = useState(0)
  const serverNow = view?.serverNow
  useEffect(() => {
    if (serverNow !== undefined) offsetRef.current = serverNow - Date.now()
  }, [serverNow])
  useEffect(() => {
    const id = setInterval(() => retick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const seq = result?.seq
  useEffect(() => {
    if (!result) return
    let message: string
    let wrong = false
    if (result.kind === 'yourResult') {
      const outcome = result.outcome
      if (outcome.kind === 'correct') message = `Solved: ${outcome.group.name}`
      else if (outcome.kind === 'oneAway') { message = 'One away...'; wrong = true }
      else if (outcome.kind === 'wrong') { message = 'Not a group'; wrong = true }
      else if (outcome.kind === 'repeat') message = 'Your team already guessed that'
      else message = outcome.reason
    } else {
      message = result.outcome.solved ? 'Other team solved one' : 'Other team missed'
    }
    setFlash(message)
    setShaking(wrong)
    const timer = setTimeout(() => { setFlash(null); setShaking(false) }, 1800)
    return () => clearTimeout(timer)
  }, [seq])

  if (!view) {
    return (
      <main className="wrap">
        <h1>Room {code}</h1>
        <p className={`status ${status}`} aria-live="polite">{status}...</p>
      </main>
    )
  }

  // An honest empty state: never render a plausible-looking board we do not have.
  if (view.viewer !== 'player') {
    return (
      <main className="wrap">
        <h1>Room {code}</h1>
        <p className={`status ${status}`} aria-live="polite">{status}</p>
        <p>Waiting to be placed on a team.</p>
      </main>
    )
  }

  const you = view.you
  const selected = Object.keys(you.selection).filter(word => you.selection[word].length > 0)
  const elapsed = view.startedAt === null ? 0 : Date.now() + offsetRef.current - view.startedAt
  const playing = view.phase === 'playing'
  const needsMoreConfirms = selected.length === GROUP_SIZE && you.confirms.length < view.confirmsRequired

  return (
    <main className="wrap">
      <div className="topbar">
        <div>
          <h1>{view.puzzle?.title ?? `Room ${code}`}</h1>
          <p className="scripture">{view.puzzle?.scripture ?? code}</p>
        </div>
        <span className="clock">{formatElapsed(elapsed)}</span>
      </div>

      <p className={`status ${status}`} aria-live="polite">
        {status === 'open' ? `${team} team - ${Object.keys(you.players).length} here` : `${status}...`}
      </p>

      {view.phase === 'done' && view.result && (
        <div className="winner">
          {view.result.winner === 'tie'
            ? 'Tie'
            : view.result.winner === team
              ? 'Your team wins'
              : 'Other team wins'}
          {' - '}
          {view.result.reason}
        </div>
      )}

      {you.solved.map(group => <Band key={group.id} group={group} />)}

      {view.phase === 'done' && view.solution
        ? view.solution
            .filter(group => !you.solved.some(s => s.id === group.id))
            .map(group => <Band key={group.id} group={group} />)
        : (
          <div className={`grid${shaking ? ' shake' : ''}`}>
            {you.board.map(word => {
              const tappers = you.selection[word] ?? []
              const mine = tappers.includes(playerId)
              const others = tappers.filter(id => id !== playerId).map(id => you.players[id]?.name ?? '?')
              const classes = ['tile']
              if (tappers.length > 0) classes.push('selected')
              if (tappers.length > 0 && !mine) classes.push('theirs')
              if (word.length > 8) classes.push('long')
              return (
                <button
                  key={word}
                  className={classes.join(' ')}
                  aria-pressed={tappers.length > 0}
                  disabled={!playing}
                  onClick={() => tap(word)}
                >
                  {word}
                  {others.length > 0 && <span className="tapper">{others.join(', ')}</span>}
                </button>
              )
            })}
          </div>
        )}

      <div className="mistakes">
        <span>Mistakes left</span>
        {Array.from({ length: MAX_MISTAKES }, (_, i) => (
          <span key={i} className={`dot${i < you.mistakes ? ' spent' : ''}`} />
        ))}
        <span className="visually-hidden">{MAX_MISTAKES - you.mistakes}</span>
      </div>

      <p className="flash" aria-live="assertive">{flash}</p>

      <div className="controls">
        <button className="action" onClick={shuffle} disabled={!playing}>Shuffle</button>
        <button className="action" onClick={clear} disabled={!playing || selected.length === 0}>Clear</button>
        <button
          className="action primary"
          onClick={submit}
          disabled={!playing || selected.length !== GROUP_SIZE}
        >
          Submit {you.confirms.length}/{view.confirmsRequired}
        </button>
      </div>

      {needsMoreConfirms && (
        <p className="hint" aria-live="polite">
          {view.confirmsRequired - you.confirms.length} more teammate
          {view.confirmsRequired - you.confirms.length === 1 ? '' : 's'} must hit Submit
        </p>
      )}

      {error && <p className="error" aria-live="assertive">{error.message}</p>}

      <div className="opponent">
        <span>Other team: {view.opponent.solvedCount}/4 solved</span>
        <span>{MAX_MISTAKES - view.opponent.mistakes} mistakes left</span>
      </div>
    </main>
  )
}
