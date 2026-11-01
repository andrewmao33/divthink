// Talks to the backend. Locally that's the /api dev proxy (vite.config.ts); in
// production VITE_API_URL points at the API (e.g. https://api.divthink.com).
// Types come from the backend's schema: api-types.ts is generated, never edited.
// After changing a request or response model there, run `npm run gen:types`.
import type { components } from './api-types'
import { accessToken } from './auth'

type Schemas = components['schemas']

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '/api'

export function apiUrl(path: string): string {
  return `${API_URL.replace(/\/$/, '')}${path}`
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export type ApiNode = Schemas['Node'] // one card: a prompt and the model's response to it
export type NodeStatus = ApiNode['status']
export type ApiEdge = Schemas['Edge']
export type Repo = Schemas['Repo']
export type SessionGraph = Schemas['SessionGraph']
// A canvas without its cards. `repo` only comes with a loaded canvas.
export type Session = Omit<SessionGraph, 'nodes' | 'edges'>

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: { 'content-type': 'application/json', ...(await authHeaders()), ...init?.headers },
    })
  } catch {
    throw new ApiError(0, "Can't reach the server.")
  }

  if (res.status === 502) {
    throw new ApiError(502, "Can't reach the server. Is the backend running on port 8000?")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : `Request failed (${res.status})`
    const wait = res.status === 429 ? res.headers.get('retry-after') : null
    throw new ApiError(
      res.status,
      wait ? `${detail} Try again in ${wait} ${wait === '1' ? 'second' : 'seconds'}.` : detail,
    )
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function listSessions(): Promise<Session[]> {
  return request('/sessions')
}

export function createSession(): Promise<Session> {
  return request('/sessions', { method: 'POST', body: '{}' })
}

export function renameSession(id: string, title: string): Promise<void> {
  return request(`/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title } satisfies Schemas['SessionRename']),
  })
}

// Deletes a canvas and everything on it. There is no undo.
export function deleteSession(id: string): Promise<void> {
  return request(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// Downloads a public GitHub repo and connects it to the canvas, replacing any
// connected before. Takes a few seconds.
export function connectRepo(sessionId: string, url: string): Promise<Repo> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/repo`, {
    method: 'PUT',
    body: JSON.stringify({ url } satisfies Schemas['ConnectRepo']),
  })
}

export function disconnectRepo(sessionId: string): Promise<void> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/repo`, { method: 'DELETE' })
}

export function getSession(id: string): Promise<SessionGraph> {
  return request(`/sessions/${encodeURIComponent(id)}`)
}

export type GenerateRequest = Schemas['GenerateRequest']
export type GenerateResponse = Schemas['GenerateResponse']
export type AttachmentType = Schemas['Attachment']['media_type']

export function generate(sessionId: string, body: GenerateRequest): Promise<GenerateResponse> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/generate`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Renames a card. An empty title falls back to whatever the model wrote.
export function setTitle(sessionId: string, nodeId: string, title: string): Promise<void> {
  return request(
    `/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}/title`,
    { method: 'PATCH', body: JSON.stringify({ title } satisfies Schemas['TitleRequest']) },
  )
}

// Deletes nodes plus descendants left with no parents. With dryRun, only reports
// which nodes would go.
export function deleteNodes(
  sessionId: string,
  nodeIds: string[],
  dryRun: boolean,
): Promise<Schemas['DeleteNodesResponse']> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/nodes/delete`, {
    method: 'POST',
    body: JSON.stringify({ node_ids: nodeIds, dry_run: dryRun } satisfies Schemas['DeleteNodesRequest']),
  })
}

// Where a card was dragged to and how big it was made. Any part may be missing;
// what is missing is decided by the automatic layout.
// (The API also accepts null for "missing"; the browser never sends it.)
export type CardLayout = {
  [K in keyof Schemas['CardLayout']]: NonNullable<Schemas['CardLayout'][K]>
}

// Saves a card's hand-made layout. null puts it back under the automatic one.
export function saveLayout(
  sessionId: string,
  cards: { id: string; layout: CardLayout | null }[],
): Promise<void> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/layout`, {
    method: 'PATCH',
    body: JSON.stringify({ cards } satisfies Schemas['SaveLayoutRequest']),
  })
}

// Images are fetched with the session token, so they can't go straight in an
// <img src>. This returns the URL the fetch should use.
export function attachmentUrl(sessionId: string, attachmentId: string): string {
  return apiUrl(
    `/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`,
  )
}

export type ModelInfo = Schemas['ModelInfo']

export function listModels(): Promise<Schemas['ModelsResponse']> {
  return request('/models')
}

export type KeyStatus = Schemas['KeyStatus']

// Which providers have a saved key. The keys themselves never come back.
export function listKeys(): Promise<KeyStatus[]> {
  return request('/keys')
}

// The server checks the key with the provider before saving it (encrypted).
export function saveKey(provider: string, key: string): Promise<void> {
  return request(`/keys/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    body: JSON.stringify({ key } satisfies Schemas['SaveKeyRequest']),
  })
}

export function deleteKey(provider: string): Promise<void> {
  return request(`/keys/${encodeURIComponent(provider)}`, { method: 'DELETE' })
}

// Deletes the signed-in account and everything in it, including the login.
export function deleteAccount(): Promise<void> {
  return request('/account', { method: 'DELETE' })
}

export type Account = Schemas['Account']

export function getAccount(): Promise<Account> {
  return request('/account')
}

// The profile picture, as a data URL already shrunk by the browser (profile.ts).
export function setAvatar(image: string): Promise<void> {
  return request('/account/avatar', { method: 'PUT', body: JSON.stringify({ image } satisfies Schemas['AvatarRequest']) })
}

export function removeAvatar(): Promise<void> {
  return request('/account/avatar', { method: 'DELETE' })
}

// Continuing on Free from the plans shown after signing up.
export function choosePlanFree(): Promise<void> {
  return request('/account/plan-chosen', { method: 'POST' })
}

// Upgrading: Stripe's own checkout page; the browser goes there.
export function startCheckout(): Promise<Schemas['Redirect']> {
  return request('/billing/checkout', { method: 'POST' })
}

// Managing a subscription: Stripe's own page; the browser goes there.

export function openBillingPortal(): Promise<Schemas['Redirect']> {
  return request('/billing/portal', { method: 'POST' })
}
