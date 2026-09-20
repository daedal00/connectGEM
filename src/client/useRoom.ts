// Owns the WebSocket lifecycle for a player's connection to a room.
// Connection concerns only - no game-rule logic and no rendering here.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMsg, GuessOutcome, PublicOutcome, RoomView, ServerMsg, TeamId } from '../shared/types.ts'

const PLAYER_ID_KEY = 'connectgem:playerId'
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 15_000

// A reload or a dropped signal must rejoin as the SAME person, not a new
// roster entry - so the id lives in localStorage, not component state.
function getOrCreatePlayerId(): string {
  const existing = localStorage.getItem(PLAYER_ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(PLAYER_ID_KEY, id)
  return id
}

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

// yourResult/opponentResult are transient by contract - they are never folded
// into `view`. Each carries a monotonic `seq` so the same outcome arriving
// twice in a row (e.g. two 'wrong' guesses) still retriggers UI feedback.
export type ResultEvent =
  | { seq: number; kind: 'yourResult'; outcome: GuessOutcome }
  | { seq: number; kind: 'opponentResult'; team: TeamId; outcome: PublicOutcome }

export type ErrorEvent = { seq: number; message: string }

export type UseRoomResult = {
  playerId: string
  status: ConnectionStatus
  view: RoomView | null
  error: ErrorEvent | null
  result: ResultEvent | null
  tap: (word: string) => void
  clear: () => void
  shuffle: () => void
  submit: () => void
}

// A privileged role is the server's decision, never the client's: passing an
// `auth` here only asks for it. The Worker verifies the token before the
// socket is accepted and silently downgrades an unverified socket to a
// player, so a bad token yields a player view, not a spectator one.
export type RoomAuth = { role: 'screen' | 'admin'; token: string }

export function useRoom(code: string, name: string, team: TeamId | null, auth?: RoomAuth): UseRoomResult {
  const playerId = useRef(getOrCreatePlayerId()).current
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [view, setView] = useState<RoomView | null>(null)
  const [error, setError] = useState<ErrorEvent | null>(null)
  const [result, setResult] = useState<ResultEvent | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)
  const everOpenedRef = useRef(false)
  const seqRef = useRef(0)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false

    const connect = () => {
      if (unmountedRef.current) return
      setStatus(everOpenedRef.current ? 'reconnecting' : 'connecting')

      // Page's own origin, scheme picked from it - works under `vite dev` and
      // the deployed worker alike, never a hardcoded host.
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
      const params = new URLSearchParams({ playerId, name })
      if (team) params.set('team', team)
      if (auth) {
        params.set('role', auth.role)
        params.set('token', auth.token)
      }
      const ws = new WebSocket(
        `${scheme}://${location.host}/api/rooms/${encodeURIComponent(code)}/ws?${params.toString()}`,
      )
      socketRef.current = ws

      ws.addEventListener('open', () => {
        everOpenedRef.current = true
        attemptRef.current = 0
        setStatus('open')
      })

      ws.addEventListener('message', event => {
        let msg: ServerMsg
        try {
          msg = JSON.parse(String(event.data))
        } catch {
          return
        }
        switch (msg.t) {
          case 'state':
            setView(msg.room)
            break
          case 'yourResult':
            seqRef.current += 1
            setResult({ seq: seqRef.current, kind: 'yourResult', outcome: msg.outcome })
            break
          case 'opponentResult':
            seqRef.current += 1
            setResult({ seq: seqRef.current, kind: 'opponentResult', team: msg.team, outcome: msg.outcome })
            break
          case 'error':
            seqRef.current += 1
            setError({ seq: seqRef.current, message: msg.message })
            break
          default:
            break
        }
      })

      ws.addEventListener('close', () => {
        socketRef.current = null
        if (unmountedRef.current) return
        const attempt = attemptRef.current++
        setStatus('reconnecting')
        const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
        timerRef.current = setTimeout(connect, delay)
      })

      // A socket 'error' is always followed by 'close' per the WebSocket spec -
      // the close handler owns reconnection, so there is nothing to add here.
      ws.addEventListener('error', () => {})
    }

    // A locked phone is the normal case, not an edge case: force a fresh
    // attempt the moment the tab is foregrounded again, instead of waiting
    // out whatever backoff delay happened to be pending.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const ws = socketRef.current
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
      if (timerRef.current) clearTimeout(timerRef.current)
      attemptRef.current = 0
      connect()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    connect()

    return () => {
      unmountedRef.current = true
      document.removeEventListener('visibilitychange', handleVisibility)
      if (timerRef.current) clearTimeout(timerRef.current)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [code, name, team, playerId, auth?.role, auth?.token])

  const send = useCallback((msg: ClientMsg) => {
    const ws = socketRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const tap = useCallback((word: string) => send({ t: 'tap', word }), [send])
  const clear = useCallback(() => send({ t: 'clear' }), [send])
  const shuffle = useCallback(() => send({ t: 'shuffle' }), [send])
  const submit = useCallback(() => send({ t: 'submit' }), [send])

  return { playerId, status, view, error, result, tap, clear, shuffle, submit }
}
