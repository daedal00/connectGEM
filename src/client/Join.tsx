import { useState } from 'react'
import type { FormEvent } from 'react'
import type { TeamId } from '../shared/types.ts'

export const NAME_KEY = 'connectgem:name'
export const TEAM_KEY = 'connectgem:team'

export function readTeam(): TeamId | null {
  const stored = localStorage.getItem(TEAM_KEY)
  return stored === 'red' || stored === 'blue' ? stored : null
}

export function Join({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [team, setTeam] = useState<TeamId | null>(readTeam)
  const [problem, setProblem] = useState('')

  const cleanCode = code.trim().toUpperCase()
  const cleanName = name.trim()

  function go(event: FormEvent) {
    event.preventDefault()
    if (cleanCode.length < 4) return setProblem('Enter the 4-letter room code.')
    // Teammates identify each other by name on the shared board, so a blank
    // name makes every tap anonymous and the mechanic stops working.
    if (!cleanName) return setProblem('Enter your name so your team can see your taps.')
    if (!team) return setProblem('Pick a team.')
    localStorage.setItem(NAME_KEY, cleanName)
    localStorage.setItem(TEAM_KEY, team)
    location.href = `/play/${encodeURIComponent(cleanCode)}`
  }

  return (
    <main className="wrap">
      <h1>All Things In Common</h1>
      <p className="scripture">Acts 4:32-35</p>
      <form onSubmit={go}>
        <label className="field">
          <span>Room code</span>
          <input
            className="code-input"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD"
          />
        </label>
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="Sam" />
        </label>
        <div className="teams">
          <button
            type="button"
            className={`team-btn red${team === 'red' ? ' on' : ''}`}
            aria-pressed={team === 'red'}
            onClick={() => setTeam('red')}
          >
            Red team
          </button>
          <button
            type="button"
            className={`team-btn blue${team === 'blue' ? ' on' : ''}`}
            aria-pressed={team === 'blue'}
            onClick={() => setTeam('blue')}
          >
            Blue team
          </button>
        </div>
        <button type="submit" className="action primary">Join</button>
        <p className="error" aria-live="polite">{problem}</p>
      </form>
    </main>
  )
}
