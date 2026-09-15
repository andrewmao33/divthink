import { ApiError, type ApiEdge, type ApiNode } from './api'

// Events on a canvas's live stream (design.md, "SSE bus").
export type StreamEvent =
  | { type: 'node_created'; data: { node_id: string; node: ApiNode; edges: ApiEdge[] } }
  | { type: 'nodes_deleted'; data: { node_ids: string[] } }
  | { type: 'thinking'; data: { node_id: string } }
  | { type: 'thought'; data: { node_id: string; heading: string } }
  | { type: 'token'; data: { node_id: string; text: string } }
  | {
      type: 'done'
      data: {
        node_id: string
        content: string
        thought_headings: string[]
        thinking_seconds: number | null
      }
    }
  | { type: 'error'; data: { node_id: string; message: string } }

const EVENT_TYPES = new Set([
  'node_created',
  'nodes_deleted',
  'thinking',
  'thought',
  'token',
  'done',
  'error',
])

export type StreamHandlers = {
  // The server has registered this listener (its ": connected" comment).
  onOpen: () => void
  onEvent: (event: StreamEvent) => void
}

// Reads a canvas's server-sent events over fetch until the stream ends (resolves),
// fails (rejects with an ApiError), or `signal` aborts.
export async function readStream(
  sessionId: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/stream`, {
      headers: { accept: 'text/event-stream' },
      signal,
    })
  } catch {
    throw new ApiError(0, "Can't reach the server.")
  }
  if (res.status === 502) {
    throw new ApiError(502, "Can't reach the server. Is the backend running on port 8000?")
  }
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `Live updates failed (${res.status})`)
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    // Events are separated by a blank line.
    let end = buffer.indexOf('\n\n')
    while (end !== -1) {
      parseBlock(buffer.slice(0, end), handlers)
      buffer = buffer.slice(end + 2)
      end = buffer.indexOf('\n\n')
    }
  }
}

// One event block: comment lines (": ..."), an "event:" line, and "data:" lines.
export function parseBlock(block: string, handlers: StreamHandlers): void {
  let type = ''
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      if (line.slice(1).trim() === 'connected') handlers.onOpen()
    } else if (line.startsWith('event:')) {
      type = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart())
    }
  }
  if (EVENT_TYPES.has(type) && data.length > 0) {
    handlers.onEvent({ type, data: JSON.parse(data.join('\n')) } as StreamEvent)
  }
}
