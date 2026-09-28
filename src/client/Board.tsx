// Pieces shared by the big screen, the captain's phone and the leader's
// phone. All three render the same board; they differ in who may tap it.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DIFFICULTY_COLORS } from '../shared/game.ts'
import type { Group, RevealedGroup, TeamId } from '../shared/types.ts'
import type { GuessNotice } from './useRoom.ts'

export const teamLabel = (team: TeamId) => team.toUpperCase()

export function Band({ group, missed = false }: { group: Group | RevealedGroup; missed?: boolean }) {
  let badge: ReactNode = null
  if (missed) badge = <span className="band-badge free">unsolved</span>
  else if ('by' in group) {
    badge = group.by
      ? <span className={`band-badge ${group.by}`}>{teamLabel(group.by)} +{group.points}</span>
      : <span className="band-badge free">last group</span>
  }
  return (
    <div className={`band${missed ? ' missed' : ''}`} style={{ background: DIFFICULTY_COLORS[group.difficulty] }}>
      <div className="band-name">{group.name}</div>
      <div className="band-words">{group.members.join(', ')}</div>
      {badge}
    </div>
  )
}

export function Tiles({
  board,
  selection,
  onTap,
  shaking = false,
}: {
  board: string[]
  selection: string[]
  onTap?: (word: string) => void
  shaking?: boolean
}) {
  return (
    <div className={`grid${shaking ? ' shake' : ''}`}>
      {board.map(word => {
        const picked = selection.includes(word)
        const classes = `tile${picked ? ' selected' : ''}${word.length > 8 ? ' long' : ''}`
        return onTap ? (
          <button key={word} className={classes} aria-pressed={picked} onClick={() => onTap(word)}>
            {word}
          </button>
        ) : (
          <div key={word} className={classes}>{word}</div>
        )
      })}
    </div>
  )
}

export function Hearts({ lives, mistakes }: { lives: number; mistakes: number }) {
  const left = Math.max(0, lives - mistakes)
  return (
    <span className="hearts" aria-label={`${left} of ${lives} lives left`}>
      {Array.from({ length: lives }, (_, i) => (
        <span key={i} className={i < left ? 'heart' : 'heart spent'} aria-hidden="true">♥</span>
      ))}
    </span>
  )
}

export function describeGuess(g: GuessNotice): { text: string; tone: 'good' | 'bad' | 'meh' } {
  const team = teamLabel(g.team)
  switch (g.outcome) {
    case 'correct':
      return { text: `${team} +${g.group?.points ?? 0}: ${g.group?.name ?? 'Solved'}`, tone: 'good' }
    case 'oneAway':
      return { text: `${team}: one away...`, tone: 'bad' }
    case 'wrong':
      return { text: `${team}: not a group`, tone: 'bad' }
    case 'repeat':
      return { text: 'Already guessed - try again', tone: 'meh' }
  }
}

// Holds the latest guess on screen for a moment, then clears it.
export function useGuessFlash(guess: GuessNotice | null, ms = 2200) {
  const [shown, setShown] = useState<GuessNotice | null>(null)
  useEffect(() => {
    if (!guess) return
    setShown(guess)
    const timer = setTimeout(() => setShown(null), ms)
    return () => clearTimeout(timer)
  }, [guess?.seq])
  return shown
}
