// Read-only spectator view for a laptop plugged into a TV. Both boards at
// once, which is exactly the view a player must never have - so it is built
// only from a socket the Worker has already verified as a spectator.
import { useState } from 'react'
import { useRoom } from './useRoom.ts'
import { Band, formatElapsed, useElapsed } from './Board.tsx'
import { Login } from './Admin.tsx'
import * as api from './adminApi.ts'
import { GROUP_COUNT, MAX_MISTAKES } from '../shared/game.ts'
import type { Group, MatchResult, TeamFullView, TeamId } from '../shared/types.ts'

function TeamColumn({
  team,
  state,
  solution,
  winner,
}: {
  team: TeamId
  state: TeamFullView
  solution: readonly Group[] | null
  winner: MatchResult | null
}) {
  const here = Object.values(state.players).filter(p => p.connected).length
  // Once the round is over, fill the gaps with the groups this team never got,
  // so both columns end up showing the whole puzzle side by side.
  const missed = solution?.filter(group => !state.solved.some(s => s.id === group.id)) ?? []

  return (
    <section className={`column ${team}${winner && winner.winner === team ? ' won' : ''}`}>
      <header className="column-head">
        <h2>{team} team</h2>
        <span className="hint">
          {state.solved.length}/{GROUP_COUNT} solved - {here} here
        </span>
      </header>

      {state.solved.map(group => <Band key={group.id} group={group} />)}
      {missed.map(group => <Band key={group.id} group={group} />)}

      {missed.length === 0 && (
        <div className="grid">
          {state.board.map(word => {
            const tapped = (state.selection[word] ?? []).length > 0
            return (
              <div key={word} className={`tile${tapped ? ' selected' : ''}${word.length > 8 ? ' long' : ''}`}>
                {word}
              </div>
            )
          })}
        </div>
      )}

      <div className="mistakes">
        <span>Mistakes left</span>
        {Array.from({ length: MAX_MISTAKES }, (_, i) => (
          <span key={i} className={`dot${i < state.mistakes ? ' spent' : ''}`} />
        ))}
      </div>
    </section>
  )
}

export function Screen({ code }: { code: string }) {
  const [token, setToken] = useState<string | null>(api.readToken)
  if (!token) return <Login heading={`Big screen - room ${code}`} onToken={setToken} />
  return <SpectatorScreen code={code} token={token} onExpired={() => { api.clearToken(); setToken(null) }} />
}

function SpectatorScreen({ code, token, onExpired }: { code: string; token: string; onExpired: () => void }) {
  const { status, view } = useRoom(code, 'Screen', null, { role: 'screen', token })
  const elapsed = useElapsed(view?.serverNow, view?.startedAt)

  if (!view) {
    return (
      <main className="wrap screen">
        <h1 className="room-code">{code}</h1>
        <p className={`status ${status}`} aria-live="polite">{status}...</p>
      </main>
    )
  }

  // A player-shaped view here means the token was rejected at the upgrade and
  // the Worker downgraded the socket. Never dress that up as a spectator view.
  if (view.viewer !== 'spectator') {
    return (
      <main className="wrap screen">
        <h1 className="room-code">{code}</h1>
        <p className="error">This screen is not signed in as a leader.</p>
        <button className="action" onClick={onExpired}>Log in</button>
      </main>
    )
  }

  return (
    <main className="wrap screen">
      <div className="topbar">
        <div>
          <h1 className="room-code">{view.puzzle?.title ?? code}</h1>
          <p className="scripture">{view.puzzle?.scripture ?? `Room ${code}`}</p>
        </div>
        <span className="clock">{formatElapsed(elapsed)}</span>
      </div>

      {view.phase === 'lobby' && (
        <p className="hint">Join at <strong>{location.origin}/play/{code}</strong></p>
      )}

      {view.phase === 'done' && view.result && (
        <div className="winner" aria-live="polite">
          {view.result.winner === 'tie' ? 'Tie' : `${view.result.winner} team wins`} - {view.result.reason}
        </div>
      )}

      <div className="boards">
        <TeamColumn team="red" state={view.red} solution={view.solution} winner={view.result} />
        <TeamColumn team="blue" state={view.blue} solution={view.solution} winner={view.result} />
      </div>
    </main>
  )
}
