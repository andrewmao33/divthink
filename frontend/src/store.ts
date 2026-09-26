import { applyNodeChanges, type Edge, type NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import {
  ApiError,
  createSession,
  deleteNodes,
  generate,
  getSession,
  listModels,
  listSessions,
  savePositions as savePositionsRequest,
  type ModelInfo,
  type Session,
} from './api'
import { addMissing, applyEvent, fromServer, removeNodes, selectOnly, type BoxNode } from './graph'
import { readStream, type StreamEvent } from './stream'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

// Text highlighted in a reply that the next prompt branches from.
export type Highlight = { sourceNodeId: string; text: string }

// A delete waiting for "Delete N boxes?" confirmation.
type PendingDelete = { nodeIds: string[]; count: number }

type CanvasState = {
  status: LoadStatus
  error: string | null
  session: Session | null
  nodes: BoxNode[]
  edges: Edge[]
  // Live updates: 'reconnecting' after the stream drops, until it's back.
  connection: 'live' | 'reconnecting'
  highlight: Highlight | null
  models: ModelInfo[]
  model: string | null // chosen for the next prompt; null until /models loads
  sending: boolean
  // One-line message above the chat box: a failed send, a refused delete, …
  notice: string | null
  pendingDelete: PendingDelete | null
  // Boxes the view should move to, set after sending a prompt.
  focusNodeIds: string[] | null
  keysOpen: boolean // the API keys dialog
  openKeys: () => void
  closeKeys: () => void
  loadSession: (id: string | null) => Promise<void>
  newSession: () => Promise<void>
  loadModels: () => Promise<void>
  setModel: (id: string) => void
  // Sends a prompt whose parents are the selected boxes (none: a new tree).
  sendPrompt: (prompt: string) => Promise<boolean>
  deleteSelected: () => Promise<void>
  // Deletes specific boxes (the right-click menu), with the same confirmation.
  deleteNodeIds: (nodeIds: string[]) => Promise<void>
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
  savePositions: (boxes: BoxNode[]) => void
  clearSelection: () => void
  startBranch: (sourceNodeId: string, text: string) => void
  clearHighlight: () => void
  onNodesChange: (changes: NodeChange<BoxNode>[]) => void
}

const MODEL_STORAGE_KEY = 'divthink.model'

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  status: 'idle',
  error: null,
  session: null,
  nodes: [],
  edges: [],
  connection: 'live',
  highlight: null,
  models: [],
  model: null,
  sending: false,
  notice: null,
  pendingDelete: null,
  focusNodeIds: null,
  keysOpen: false,

  openKeys: () => set({ keysOpen: true }),
  closeKeys: () => set({ keysOpen: false }),

  loadSession: async (id) => {
    // React StrictMode runs effects twice in development; load only once.
    if (get().status === 'loading') return
    // Switching canvases starts clean: nothing from the last one carries over.
    set({
      status: 'loading',
      error: null,
      nodes: [],
      edges: [],
      highlight: null,
      notice: null,
      pendingDelete: null,
      focusNodeIds: null,
    })
    try {
      await sync(id ?? (await latestOrNewSessionId()))
    } catch (e) {
      const missing = e instanceof ApiError && (e.status === 404 || e.status === 422)
      set({ status: 'error', error: missing ? "That canvas doesn't exist." : messageFor(e) })
    }
  },

  newSession: async () => {
    try {
      const created = await createSession()
      await get().loadSession(created.id)
    } catch (e) {
      set({ notice: messageFor(e) })
    }
  },

  loadModels: async () => {
    try {
      const { models, default: fallback } = await listModels()
      const usable = (id: string | null) => models.some((m) => m.id === id && m.available)
      const saved = readSavedModel()
      // Last choice if its key is set, else the default, else anything with a key.
      const model = usable(saved)
        ? saved
        : usable(fallback)
          ? fallback
          : (models.find((m) => m.available)?.id ?? fallback)
      set({ models, model })
    } catch {
      // No picker then; the server's default model is used.
    }
  },

  setModel: (id) => {
    set({ model: id })
    saveModel(id)
  },

  sendPrompt: async (prompt) => {
    const { session, sending, nodes, highlight, model } = get()
    if (!session || sending) return false
    const parentIds = nodes.filter((box) => box.selected).map((box) => box.id)
    set({ sending: true, notice: null, pendingDelete: null })
    try {
      const created = await generate(session.id, {
        prompt,
        parent_ids: parentIds,
        parent_heights: measuredHeights(nodes, [...parentIds, highlight?.sourceNodeId]),
        ...(model && { model }),
        ...(highlight && {
          highlight: { source_node_id: highlight.sourceNodeId, text: highlight.text },
        }),
      })
      // The stream normally delivers the new boxes (node_created). If they haven't
      // arrived yet, fetch them so they show up regardless; duplicates are skipped.
      if (!get().nodes.some((box) => box.id === created.assistant_node_id)) {
        const graph = await getSession(session.id)
        set((s) => addMissing(s, graph))
      }
      set((s) => ({
        // Select the new reply, so pressing Enter again continues this thread.
        nodes: selectOnly(s.nodes, created.assistant_node_id),
        session: s.session && { ...s.session, title: created.session_title },
        highlight: null,
        sending: false,
        focusNodeIds: [created.user_node_id, created.assistant_node_id],
      }))
      return true
    } catch (e) {
      set({ sending: false, notice: messageFor(e) })
      return false
    }
  },

  deleteSelected: async () => {
    const selected = get().nodes.filter((box) => box.selected).map((box) => box.id)
    await get().deleteNodeIds(selected)
  },

  deleteNodeIds: async (nodeIds) => {
    const { session, pendingDelete } = get()
    if (!session || nodeIds.length === 0 || pendingDelete) return
    set({ notice: null })
    try {
      // Ask the server what would go. Confirm only when it's more than what was asked for.
      const { deleted_node_ids } = await deleteNodes(session.id, nodeIds, true)
      if (deleted_node_ids.length > nodeIds.length) {
        set({ pendingDelete: { nodeIds, count: deleted_node_ids.length } })
      } else {
        await deleteForGood(nodeIds)
      }
    } catch (e) {
      set({ notice: messageFor(e) })
    }
  },

  confirmDelete: async () => {
    const pending = get().pendingDelete
    if (!pending) return
    set({ pendingDelete: null })
    await deleteForGood(pending.nodeIds)
  },

  cancelDelete: () => set({ pendingDelete: null }),

  savePositions: (boxes) => {
    const { session } = get()
    if (!session || boxes.length === 0) return
    const positions = boxes.map((box) => ({ id: box.id, x: box.position.x, y: box.position.y }))
    savePositionsRequest(session.id, positions).catch(() =>
      set({ notice: "Couldn't save where the boxes were moved. They'll jump back on refresh." }),
    )
  },

  clearSelection: () => set((s) => ({ nodes: selectOnly(s.nodes, null) })),

  // Branching selects the source reply, so the quote's context is that reply and its ancestors.
  startBranch: (sourceNodeId, text) =>
    set((s) => ({ highlight: { sourceNodeId, text }, nodes: selectOnly(s.nodes, sourceNodeId), notice: null })),

  clearHighlight: () => set({ highlight: null }),

  // Dragging and selecting update boxes locally; positions are saved on drag stop.
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
}))

// Removes boxes from the canvas and the server, and drops a quote whose reply is gone.
async function deleteForGood(nodeIds: string[]) {
  const { session } = useCanvasStore.getState()
  if (!session) return
  try {
    const { deleted_node_ids } = await deleteNodes(session.id, nodeIds, false)
    useCanvasStore.setState((s) => withoutNodes(s, deleted_node_ids))
  } catch (e) {
    useCanvasStore.setState({ notice: messageFor(e) })
  }
}

function withoutNodes(s: CanvasState, nodeIds: string[]) {
  const quoteGone = s.highlight !== null && nodeIds.includes(s.highlight.sourceNodeId)
  return { ...removeNodes(s, nodeIds), highlight: quoteGone ? null : s.highlight }
}

// How tall the given boxes are on screen. React Flow measures them after render;
// a box that hasn't been measured yet is left out, and the server falls back to
// its own estimate. Boxes are as tall as their text, so without this the server
// would place new boxes on top of long replies.
function measuredHeights(nodes: BoxNode[], ids: (string | undefined)[]): Record<string, number> {
  const wanted = new Set(ids.filter((id): id is string => Boolean(id)))
  const heights: Record<string, number> = {}
  for (const box of nodes) {
    const height = box.measured?.height
    if (wanted.has(box.id) && height) heights[box.id] = Math.round(height)
  }
  return heights
}

// ---- Live stream ----------------------------------------------------------------

let stream: AbortController | null = null
let activeSessionId: string | null = null
const MAX_RECONNECT_DELAY_MS = 10_000

// Signing out: stop live updates and forget everything from the previous account.
export function resetCanvas() {
  stream?.abort()
  stream = null
  activeSessionId = null
  useCanvasStore.setState({
    status: 'idle',
    error: null,
    session: null,
    nodes: [],
    edges: [],
    connection: 'live',
    highlight: null,
    models: [],
    model: null,
    sending: false,
    notice: null,
    pendingDelete: null,
    focusNodeIds: null,
    keysOpen: false,
  })
}

function apply(event: StreamEvent) {
  useCanvasStore.setState((s) =>
    event.type === 'nodes_deleted' ? withoutNodes(s, event.data.node_ids) : applyEvent(s, event),
  )
}

// Opens the canvas's live stream, then loads the canvas, then applies events that
// arrived in between (design.md, "State flow"). Opening first means an event can't
// slip through while the canvas loads. Used for the first load and every reconnect.
async function sync(sessionId: string): Promise<void> {
  activeSessionId = sessionId
  stream?.abort()
  const abort = new AbortController()
  stream = abort

  const waiting: StreamEvent[] = []
  let caughtUp = false
  let markOpen = () => {}
  const opened = new Promise<'open'>((resolve) => {
    markOpen = () => resolve('open')
  })

  // Settles when the stream ends: null if it closed, the error if it failed.
  const finished = readStream(
    sessionId,
    {
      onOpen: markOpen,
      onEvent: (event) => {
        if (caughtUp) apply(event)
        else waiting.push(event)
      },
    },
    abort.signal,
  ).then(
    () => null,
    (e: unknown) => e,
  )

  const first = await Promise.race([opened, finished])
  if (first !== 'open') {
    abort.abort()
    throw first instanceof Error ? first : new ApiError(0, 'Live updates closed unexpectedly.')
  }

  let graph
  try {
    graph = await getSession(sessionId)
  } catch (e) {
    abort.abort()
    throw e
  }
  if (abort.signal.aborted) return // another canvas was opened meanwhile
  const { nodes: _nodes, edges: _edges, ...session } = graph
  useCanvasStore.setState((s) => ({
    ...fromServer(graph, s.nodes),
    session,
    status: 'ready',
    connection: 'live',
  }))
  for (const event of waiting) apply(event)
  caughtUp = true

  void finished.then(() => {
    if (!abort.signal.aborted) reconnect(sessionId, 0)
  })
}

// Retries with growing delays (1s, 2s, 4s… up to 10s) until the stream is back.
function reconnect(sessionId: string, attempt: number) {
  useCanvasStore.setState({ connection: 'reconnecting' })
  const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS)
  setTimeout(() => {
    if (activeSessionId !== sessionId) return // a different canvas is open now
    sync(sessionId).catch(() => reconnect(sessionId, attempt + 1))
  }, delay)
}

// ---- Helpers ---------------------------------------------------------------------

// No canvas in the URL: open the most recently updated one, or start a new one.
async function latestOrNewSessionId(): Promise<string> {
  const sessions = await listSessions() // newest first
  return sessions[0]?.id ?? (await createSession()).id
}

// The model picked last time, remembered in this browser only.
function readSavedModel(): string | null {
  try {
    return window.localStorage.getItem(MODEL_STORAGE_KEY)
  } catch {
    return null
  }
}

function saveModel(id: string) {
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, id)
  } catch {
    // Storage unavailable (private window); the choice just isn't remembered.
  }
}

function messageFor(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.'
}
