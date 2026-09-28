import { useState } from 'react'
import type { FormEvent } from 'react'

export const NAME_KEY = 'connectgem:name'

const cleanCode = (raw: string) => raw.trim().toUpperCase()

export function CodeForm({ label, onCode }: { label: string; onCode: (code: string) => void }) {
  const [code, setCode] = useState('')
  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (cleanCode(code).length === 4) onCode(cleanCode(code))
      }}
    >
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
      <button type="submit" className="action primary" disabled={cleanCode(code).length !== 4}>{label}</button>
    </form>
  )
}

// The site root and /play/:code without a saved name. Only team captains
// come here - everyone else watches the big screen.
export function Join({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [problem, setProblem] = useState('')

  function go(event: FormEvent) {
    event.preventDefault()
    const room = cleanCode(code)
    if (room.length !== 4) return setProblem('Enter the 4-letter code on the big screen.')
    // The big screen lists each team's captain by name.
    if (!name.trim()) return setProblem('Enter your name.')
    localStorage.setItem(NAME_KEY, name.trim())
    location.href = `/play/${encodeURIComponent(room)}`
  }

  return (
    <main className="wrap">
      <h1>Connect GEM</h1>
      <p className="lede">Team captains: join here. You'll tap in your team's guesses; everyone else watches the big screen.</p>
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
        <button type="submit" className="action primary">Join</button>
        <p className="error" aria-live="polite">{problem}</p>
      </form>
      <p className="footer-links">
        <a href="/admin">Leader</a> · <a href="/screen">Big screen</a>
      </p>
    </main>
  )
}
