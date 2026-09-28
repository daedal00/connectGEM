// Owns the WebSocket lifecycle for one connection to a room.
// Connection concerns only - no game-rule logic and no rendering here.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMsg, GuessEvent, Role, RoomView, ServerMsg, TeamId } from '../shared/types.ts'

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

// Guesses and errors are transient by contract - never folded into `view`.
// Each carries a monotonic `seq` so the same outcome twice in a row (two
// 'wrong' guesses) still retriggers the UI.
export type GuessNotice = GuessEvent & { seq: number }
export type ErrorNotice = { seq: number; message: string }

// A privileged role is the server's decision: `token` only asks for admin.
// The Worker verifies it before the socket is accepted and silently
// downgrades an unverified socket to a player.
export type RoomAuth = { role: Role; name?: string; token?: string }

export function useRoom(code: string, { role, name = '', token }: RoomAuth) {
  const playerId = useRef(getOrCreatePlayerId()).current
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [view, setView] = useState<RoomView | null>(null)
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [guess, setGuess] = useState<GuessNotice | null>(null)

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
      const params = new URLSearchParams({ playerId, name, role })
      if (token) params.set('token', token)
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
          case 'guess':
            seqRef.current += 1
            setGuess({ ...msg.event, seq: seqRef.current })
            break
          case 'error':
            seqRef.current += 1
            setError({ seq: seqRef.current, message: msg.message })
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

    // A locked phone (or a laptop that slept) is the normal case: force a
    // fresh attempt the moment the tab is foregrounded again, instead of
    // waiting out whatever backoff delay happened to be pending.
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
  }, [code, name, role, token, playerId])

  const send = useCallback((msg: ClientMsg) => {
    const ws = socketRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const actions = {
    join: useCallback((team: TeamId) => send({ t: 'join', team }), [send]),
    tap: useCallback((word: string) => send({ t: 'tap', word }), [send]),
    clear: useCallback(() => send({ t: 'clear' }), [send]),
    shuffle: useCallback(() => send({ t: 'shuffle' }), [send]),
    submit: useCallback(() => send({ t: 'submit' }), [send]),
  }

  return { playerId, status, view, error, guess, ...actions }
}

export type RoomHandle = ReturnType<typeof useRoom>
