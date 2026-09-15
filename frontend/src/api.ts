// Talks to the backend. Locally that's the /api dev proxy (vite.config.ts); in
// production VITE_API_URL points at the API (e.g. https://api.divthink.com).
// Types mirror the backend's response shapes (backend/app/schemas.py).
import { accessToken } from './auth'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '/api'

export function apiUrl(path: string): string {
  return `${API_URL.replace(/\/$/, '')}${path}`
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export type NodeType = 'user' | 'assistant' | 'highlight'
export type NodeStatus = 'pending' | 'streaming' | 'complete' | 'error'

export type ApiNode = {
  id: string
  type: NodeType
  content: string
  model: string | null
  position_x: number
  position_y: number
  status: NodeStatus
  metadata: Record<string, unknown>
  created_at: string
}

export type ApiEdge = {
  id: string
  parent_id: string
  child_id: string
}

export type Session = {
  id: string
  title: string
  default_model: string | null
  created_at: string
  updated_at: string
}

export type SessionGraph = Session & {
  nodes: ApiNode[]
  edges: ApiEdge[]
}

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
    throw new ApiError(res.status, detail)
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

export function getSession(id: string): Promise<SessionGraph> {
  return request(`/sessions/${encodeURIComponent(id)}`)
}

export type GenerateRequest = {
  prompt: string
  parent_ids?: string[]
  model?: string
  // Branching from highlighted text in a reply.
  highlight?: { source_node_id: string; text: string }
}

export type GenerateResponse = {
  user_node_id: string
  assistant_node_id: string
  highlight_node_id: string | null
  session_title: string
}

export function generate(sessionId: string, body: GenerateRequest): Promise<GenerateResponse> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/generate`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Deletes nodes plus descendants left with no parents. With dryRun, only reports
// which nodes would go.
export function deleteNodes(
  sessionId: string,
  nodeIds: string[],
  dryRun: boolean,
): Promise<{ deleted_node_ids: string[] }> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/nodes/delete`, {
    method: 'POST',
    body: JSON.stringify({ node_ids: nodeIds, dry_run: dryRun }),
  })
}

export function savePositions(
  sessionId: string,
  positions: { id: string; x: number; y: number }[],
): Promise<void> {
  return request(`/sessions/${encodeURIComponent(sessionId)}/positions`, {
    method: 'PATCH',
    body: JSON.stringify({ positions }),
  })
}

export type ModelInfo = {
  id: string
  label: string
  provider: string
  available: boolean // the user has an API key for its provider
}

export function listModels(): Promise<{ models: ModelInfo[]; default: string }> {
  return request('/models')
}

export type KeyStatus = {
  provider: string
  label: string
  configured: boolean
}

// Which providers have a saved key. The keys themselves never come back.
export function listKeys(): Promise<KeyStatus[]> {
  return request('/keys')
}

// The server checks the key with the provider before saving it (encrypted).
export function saveKey(provider: string, key: string): Promise<void> {
  return request(`/keys/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    body: JSON.stringify({ key }),
  })
}

export function deleteKey(provider: string): Promise<void> {
  return request(`/keys/${encodeURIComponent(provider)}`, { method: 'DELETE' })
}
