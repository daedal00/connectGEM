// Admin credential handling and the authenticated fetch wrapper. No rendering
// here - Admin.tsx and Screen.tsx both go through this so there is exactly one
// place that knows where the token lives and what an expired one looks like.
import type { AdminLoginResponse, CreateRoomResponse, PuzzleListResponse, PuzzleSummary } from '../shared/types.ts'

const TOKEN_KEY = 'connectgem:adminToken'

// sessionStorage, not localStorage: this credential drives a laptop plugged
// into a TV in a hall. It should survive an accidental refresh and die with
// the tab rather than outlive the evening on a shared machine.
export function readToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

export async function login(password: string): Promise<string> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error('Wrong password.')
  const { token } = (await res.json()) as AdminLoginResponse
  sessionStorage.setItem(TOKEN_KEY, token)
  return token
}

// The token expires after 4 hours, which is longer than a youth night but not
// longer than a laptop left open. Funnelling every admin call through here
// means a 401 clears the token in one place and the UI falls back to login.
async function adminFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    clearToken()
    throw new Error('Session expired. Log in again.')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

function adminPost<T>(path: string, token: string, body?: unknown): Promise<T> {
  return adminFetch<T>(path, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

export async function listPuzzles(token: string): Promise<PuzzleSummary[]> {
  const { puzzles } = await adminFetch<PuzzleListResponse>('/api/puzzles', token)
  return puzzles
}

export async function createRoom(token: string): Promise<string> {
  const { code } = await adminPost<CreateRoomResponse>('/api/rooms', token)
  return code
}

export type RoomAction = 'start' | 'reset' | 'end'

export const roomAction = (token: string, code: string, action: RoomAction) =>
  adminPost(`/api/rooms/${encodeURIComponent(code)}/${action}`, token)

export const setPuzzle = (token: string, code: string, puzzleId: string) =>
  adminPost(`/api/rooms/${encodeURIComponent(code)}/puzzle`, token, { puzzleId })

export const setConfirmsRequired = (token: string, code: string, confirmsRequired: number) =>
  adminPost(`/api/rooms/${encodeURIComponent(code)}/config`, token, { confirmsRequired })
