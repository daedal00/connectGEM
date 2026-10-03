// A team captain's phone. The captain is the team's hands: the team talks it
// over in front of the big screen, the captain taps it in. Tiles only work
// on the team's own turn - the server enforces that too.
import { useEffect, useState } from 'react'
import { useRoom } from './useRoom.ts'
import { Band, Hearts, Tiles, TurnClock, describeGuess, teamLabel, useGuessFlash, useTurnClock } from './Board.tsx'
import { GROUP_SIZE } from '../shared/game.ts'
import type { RoomView, TeamId } from '../shared/types.ts'
import type { RoomHandle } from './useRoom.ts'

export function TeamPicker({ view, current, onPick }: { view: RoomView; current: TeamId | null; onPick: (team: TeamId) => void }) {
  return (
    <div className="teams">
      {view.teams.map(team => (
        <button
          key={team.id}
          type="button"
          className={`team-btn ${team.id}${current === team.id ? ' on' : ''}`}
          aria-pressed={current === team.id}
          onClick={() => onPick(team.id)}
        >
          {teamLabel(team.id)}
          <small>{team.players.length === 0 ? 'open' : team.players.map(p => p.name).join(', ')}</small>
        </button>
      ))}
    </div>
  )
}

export function Scores({ view }: { view: RoomView }) {
  return (
    <div className="scores">
      {view.teams.map(team => (
        <div key={team.id} className={`score ${team.id}${view.turn === team.id ? ' up' : ''}${team.out ? ' out' : ''}`}>
          <strong>{teamLabel(team.id)}</strong> {team.points} pts
          <Hearts lives={view.lives} mistakes={team.mistakes} />
        </div>
      ))}
    </div>
  )
}

// Board + Shuffle/Clear/Submit for whoever is allowed to act. Shared with
// the leader's console, which can play for the team on turn.
export function PlayControls({ room, view, enabled }: { room: RoomHandle; view: RoomView; enabled: boolean }) {
  const flash = useGuessFlash(room.guess)
  const flashInfo = flash ? describeGuess(flash) : null
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (!room.error) return
    setProblem(room.error.message)
    const timer = setTimeout(() => setProblem(null), 2500)
    return () => clearTimeout(timer)
  }, [room.error?.seq])

  return (
    <>
      {view.solved.map(group => <Band key={group.id} group={group} />)}
      {view.phase === 'done'
        ? view.leftover.map(group => <Band key={group.id} group={group} missed />)
        : <Tiles
            board={view.board}
            selection={view.selection}
            onTap={enabled ? room.tap : undefined}
            shaking={flashInfo?.tone === 'bad'}
          />}
      <p className={`flash ${flashInfo?.tone ?? ''}`} aria-live="assertive">{flashInfo?.text}</p>
      {view.phase === 'playing' && (
        <div className="controls">
          <button className="action" onClick={room.shuffle} disabled={!enabled}>Shuffle</button>
          <button className="action" onClick={room.clear} disabled={!enabled || view.selection.length === 0}>Clear</button>
          <button className="action primary" onClick={room.submit} disabled={!enabled || view.selection.length !== GROUP_SIZE}>
            Submit
          </button>
        </div>
      )}
      {problem && <p className="error" aria-live="assertive">{problem}</p>}
    </>
  )
}

export function Play({ code, name }: { code: string; name: string }) {
  const room = useRoom(code, { role: 'player', name })
  const { status, view } = room
  const seconds = useTurnClock(view)

  if (!view || !view.you) {
    return (
      <main className="wrap">
        <h1>Room {code}</h1>
        <p className={`status ${status}`} aria-live="polite">{status}...</p>
        {status === 'reconnecting' && <p className="hint">Can't reach room {code}. Check the code on the big screen.</p>}
        <p className="footer-links"><a href="/">Different room</a></p>
      </main>
    )
  }

  const team = view.you.team
  if (!team) {
    return (
      <main className="wrap">
        <h1>Hi {name}</h1>
        <p className="lede">Which team are you captain for?</p>
        <TeamPicker view={view} current={null} onPick={room.join} />
        {room.error && <p className="error">{room.error.message}</p>}
      </main>
    )
  }

  const turnTeam = view.turn
  return (
    <main className={`wrap captain ${team}`}>
      <div className="topbar">
        <div>
          <h1>{view.puzzle?.title ?? `Room ${code}`}</h1>
          <p className="scripture">
            {view.puzzle ? (view.puzzle.kind === 'warmup' ? 'Warm-up round' : view.puzzle.scripture) : code}
          </p>
        </div>
        <span className={`team-pill ${team}`}>{teamLabel(team)} captain</span>
      </div>
      {status !== 'open' && <p className={`status ${status}`} aria-live="polite">{status}...</p>}

      {view.phase === 'lobby' && (
        <>
          <p className="lede">You're in. Wait for the leader to start, then tap in your team's guesses on your turn.</p>
          <p className="hint">Wrong team?</p>
          <TeamPicker view={view} current={team} onPick={room.join} />
        </>
      )}

      {view.phase === 'playing' && (
        <div className={`turn-strip ${turnTeam ?? ''}${view.you.canAct ? ' mine' : ''}`} aria-live="polite">
          {view.you.canAct
            ? 'YOUR TURN - pick 4 and submit'
            : turnTeam
              ? `${teamLabel(turnTeam)} is up. Watch the big screen.`
              : ''}
          <TurnClock seconds={seconds} />
        </div>
      )}

      {view.phase === 'done' && view.result && (
        <div className="winner">
          {view.result.winner === 'tie'
            ? "It's a tie"
            : view.result.winner === team ? 'Your team wins!' : `${teamLabel(view.result.winner)} wins`}
          <div className="hint">{view.result.reason} - waiting for the next round</div>
        </div>
      )}

      {view.phase !== 'lobby' && (
        <>
          <PlayControls room={room} view={view} enabled={view.you.canAct} />
          <Scores view={view} />
        </>
      )}
    </main>
  )
}
