// The projector. Everything here is public - every team watches the same
// board - so it needs no login. It never sends anything: the socket is
// read-only on the server too.
import { useState } from 'react'
import { useRoom } from './useRoom.ts'
import { Band, Hearts, Tiles, describeGuess, teamLabel, useGuessFlash } from './Board.tsx'
import { CodeForm } from './Join.tsx'
import type { RoomView, TeamView } from '../shared/types.ts'

export function Screen({ code }: { code: string | null }) {
  const [picked, setPicked] = useState(code)
  if (!picked) {
    return (
      <main className="wrap">
        <h1>Big screen</h1>
        <p className="lede">Enter the room code from the leader's phone.</p>
        <CodeForm
          label="Show room"
          onCode={next => {
            history.replaceState(null, '', `/screen/${next}`)
            setPicked(next)
          }}
        />
      </main>
    )
  }
  return <Projector code={picked} />
}

function TeamCard({ team, view }: { team: TeamView; view: RoomView }) {
  const up = view.turn === team.id
  const captains = team.players.filter(p => p.connected).map(p => p.name)
  const won = view.result?.winner === team.id
  return (
    <div className={`team-card ${team.id}${up ? ' up' : ''}${team.out ? ' out' : ''}${won ? ' won' : ''}`}>
      <div className="team-card-head">
        <span className="team-name">{teamLabel(team.id)}</span>
        {up && <span className="tag">UP NOW</span>}
        {team.out && <span className="tag">OUT</span>}
        {won && <span className="tag">WINNER</span>}
      </div>
      {view.phase !== 'lobby' && (
        <>
          <div className="team-points">{team.points}<small> pts</small></div>
          <Hearts lives={view.lives} mistakes={team.mistakes} />
        </>
      )}
      <div className="team-captains">{captains.length > 0 ? captains.join(', ') : 'No captain yet'}</div>
      {view.round > 1 || team.total > 0 ? (
        <div className="team-total">Night total: {team.total + (view.phase === 'done' ? team.points : 0)}</div>
      ) : null}
    </div>
  )
}

function Projector({ code }: { code: string }) {
  const { status, view, guess } = useRoom(code, { role: 'screen', name: 'Screen' })
  const flash = useGuessFlash(guess)

  if (!view) {
    return (
      <main className="screen">
        <div className="big-code">{code}</div>
        <p className={`status ${status}`} aria-live="polite">
          {status === 'reconnecting' ? `Can't find room ${code} yet...` : `${status}...`}
        </p>
      </main>
    )
  }

  const joinUrl = `${location.host}/play`
  const turnTeam = view.turn ? view.teams.find(t => t.id === view.turn) : null
  const flashInfo = flash ? describeGuess(flash) : null

  return (
    <main className={`screen phase-${view.phase}`}>
      <header className="screen-head">
        <div>
          <div className="kicker">
            {view.puzzle ? (view.puzzle.kind === 'warmup' ? 'Warm-up round' : view.puzzle.scripture) : 'Connect GEM'}
          </div>
          <h1>{view.puzzle?.title ?? 'Get into teams'}</h1>
        </div>
        <div className="join-mini">
          Captains join at <strong>{joinUrl}</strong> with code <strong className="code">{code}</strong>
          {status !== 'open' && <span className={`status ${status}`}> · {status}</span>}
        </div>
      </header>

      {view.phase === 'lobby' ? (
        <section className="lobby">
          <p className="lobby-step">One captain per team: grab a phone and go to</p>
          <div className="lobby-url">{joinUrl}</div>
          <p className="lobby-step">Room code</p>
          <div className="big-code">{code}</div>
          <div className="lobby-teams">
            {view.teams.map(team => <TeamCard key={team.id} team={team} view={view} />)}
          </div>
          <p className="rules">
            Teams take turns. Find four words that share something. Harder groups score more
            (yellow 1, green 2, blue 3, purple 4). A wrong guess costs a heart and passes the turn.
          </p>
        </section>
      ) : (
        <div className="screen-body">
          <section className="stage">
            {view.phase === 'playing' && turnTeam && (
              <div className={`turn-banner ${turnTeam.id}`} aria-live="polite">
                {teamLabel(turnTeam.id)} TEAM'S TURN
                <span className="turn-sub">{view.selection.length}/4 picked</span>
              </div>
            )}
            {view.phase === 'done' && view.result && (
              <div className={`turn-banner ${view.result.winner === 'tie' ? 'tie' : view.result.winner}`} aria-live="polite">
                {view.result.winner === 'tie' ? "IT'S A TIE" : `${teamLabel(view.result.winner)} WINS`}
                <span className="turn-sub">{view.result.reason}</span>
              </div>
            )}

            {view.solved.map(group => <Band key={group.id} group={group} />)}
            {view.phase === 'done'
              ? view.leftover.map(group => <Band key={group.id} group={group} missed />)
              : <Tiles board={view.board} selection={view.selection} shaking={flashInfo?.tone === 'bad'} />}
          </section>

          <aside className="scoreboard">
            {view.teams.map(team => <TeamCard key={team.id} team={team} view={view} />)}
          </aside>
        </div>
      )}

      {flashInfo && (
        <div className={`flash-overlay ${flashInfo.tone}`} role="status">
          {flashInfo.text}
        </div>
      )}
    </main>
  )
}
