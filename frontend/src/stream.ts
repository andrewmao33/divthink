import { ApiError, apiUrl, authHeaders } from './api'
import { parseBlock, type StreamHandlers } from './sse'

export type { StreamEvent, StreamHandlers } from './sse'

// Reads a canvas's server-sent events over fetch until the stream ends (resolves),
// fails (rejects with an ApiError), or `signal` aborts.
export async function readStream(
  sessionId: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(apiUrl(`/sessions/${encodeURIComponent(sessionId)}/stream`), {
      // fetch rather than EventSource, which can't send the Authorization header.
      headers: { accept: 'text/event-stream', ...(await authHeaders()) },
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
