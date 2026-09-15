// Live stream event types and parsing. Pure (no app imports), so it can be tested directly.
import type { ApiEdge, ApiNode } from './api'

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
