import type { Edge } from '@xyflow/react'
import { create } from 'zustand'
import {
  ApiError,
  connectRepo as putRepo,
  createSession,
  disconnectRepo as deleteRepo,
  deleteSession,
  deleteNodes,
  generate,
  getSession,
  listModels,
  renameSession,
  saveLayout,
  type ApiNode,
  type CardLayout,
  type ModelInfo,
  type Session,
} from './api'
import { signOut } from './auth'
import { DEMO_ACTIVE, DEMO_TITLE, demoGraph } from './demo'
import { exchangesOf, labelOf } from './exchanges'
import { addMissing, applyEvent, fromServer, localEdge, removeNodes, type BoxNode } from './graph'
import type { Point } from './layout'
import { pdfPreview } from './pdfPreview'
import { readStream, type StreamEvent } from './stream'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

// Text highlighted in a reply that the next prompt branches from.
export type Highlight = { sourceNodeId: string; text: string }

// A file waiting to be sent. `preview` is an object URL: the image itself, or
// a PDF's first page once pdfPreview has drawn it (its name until then).
export type PendingFile = {
  id: string
  mediaType: string
  data: string
  preview: string | null
  name: string
}

// A delete waiting to be confirmed. `label` names the card in the question.
type PendingDelete = { nodeIds: string[]; label: string }

export type SettingsSection = 'general' | 'account' | 'privacy' | 'keys' | 'billing'

type CanvasState = {
  status: LoadStatus
  error: string | null
  session: Session | null
  // The server's nodes and edges as they arrive. What is drawn is one card per
  // prompt and reply, derived from these by exchanges.ts.
  nodes: BoxNode[]
  edges: Edge[]
  // The card the panel shows the conversation up to, and the next prompt
  // continues from. null: a new thread, not started yet.
  activeId: string | null
  // Where "Back to …" returns to while a new thread is still empty.
  previousActiveId: string | null
  // Cards picked to be merged, in the order they were picked. While there are
  // any, the panel is a merge draft and the next prompt is asked across them.
  mergeIds: string[]
  // The card the canvas should centre on. A new object each time, so asking for
  // the same card twice still moves the view.
  focus: { id: string } | null
  // Live updates: 'reconnecting' after the stream drops, until it's back.
  connection: 'live' | 'reconnecting'
  highlight: Highlight | null
  images: PendingFile[]
  models: ModelInfo[]
  model: string | null // chosen for the next prompt; null until /models loads
  sending: boolean
  // One-line message above the chat box: a failed send, a refused delete, …
  notice: string | null
  // The notice, when it is a plan limit: the chat box offers Upgrade beside it.
  limitNotice: string | null
  pendingDelete: PendingDelete | null
  // The public demo: everything that writes is refused, and there is no stream.
  // A new canvas that hasn't been saved yet: it is created on the server when
  // the first prompt is sent, so opening one and leaving makes nothing.
  unsaved: boolean
  // The example on the landing page: everything works, but only in this
  // browser. Nothing is sent to the server, and a prompt gets a fixed reply.
  demo: boolean
  // What a visitor has typed into the demo since arriving at the active card.
  demoEchoes: string[]
  loadDemo: () => void
  settings: SettingsSection | null // the settings window, open on this section
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  loadSession: (id: string | null) => Promise<void>
  // Opens a new, empty canvas. Nothing is saved until the first prompt is sent.
  newSession: () => Promise<void>
  loadModels: () => Promise<void>
  setModel: (id: string) => void
  // Makes a card the active one. `centre` also moves the canvas to it, for
  // jumps made from the panel, where the card may be off screen.
  setActive: (id: string, centre?: boolean) => void
  // Clears the panel for a new thread. Nothing is created until a prompt is sent.
  // Opens a new, empty thread. `at`, where on the canvas its first card goes
  // (right-click → New thread here); without it, the automatic layout decides.
  startNewThread: (at?: Point) => void
  newThreadAt: Point | null
  // Adds a card to the merge, or takes it out. Starting a merge from nothing
  // brings the active card along: "this one, and that one".
  toggleMerge: (id: string) => void
  clearMerge: () => void
  // Sends a prompt that continues from the active card (none: a new thread),
  // or across the cards picked to merge.
  sendPrompt: (prompt: string) => Promise<boolean>
  // Records where a card was dragged to or how it was resized. null hands it
  // back to the automatic layout.
  placeCard: (id: string, layout: CardLayout | null) => void
  placeCards: (cards: { id: string; layout: CardLayout | null }[]) => void
  // Hands every card's position back to the automatic layout. Sizes are kept:
  // a card made bigger to read stays that way.
  tidy: () => void
  renameCanvas: (title: string) => void
  // Deletes a canvas for good. Resolves to whether it went. Deleting the open
  // one leaves a new, empty canvas in its place.
  deleteCanvas: (id: string) => Promise<boolean>
  // Asks to delete a card. Only a card nothing continues from can go.
  requestDelete: (id: string) => void
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
  // `sourceNodeId` is the reply the text was highlighted in.
  startBranch: (sourceNodeId: string, text: string) => void
  clearHighlight: () => void
  addImages: (files: File[]) => Promise<void>
  removeImage: (id: string) => void
  // Connects a GitHub repo to the canvas, so replies can read its code.
  // Resolves to null when it worked, or the reason it didn't.
  connectRepo: (url: string) => Promise<string | null>
  disconnectRepo: () => void
}

const MODEL_STORAGE_KEY = 'divthink.model'
const MAX_IMAGES = 8
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, 'application/pdf']


// The API takes raw base64; a data URL carries a prefix that has to come off.
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error("That image couldn't be read."))
    reader.readAsDataURL(file)
  })
}

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  status: 'idle',
  error: null,
  session: null,
  nodes: [],
  edges: [],
  activeId: null,
  previousActiveId: null,
  newThreadAt: null,
  mergeIds: [],
  focus: null,
  connection: 'live',
  highlight: null,
  images: [],
  models: [],
  model: null,
  sending: false,
  notice: null,
  limitNotice: null,
  pendingDelete: null,
  unsaved: false,
  demo: false,
  demoEchoes: [],
  settings: null,

  loadDemo: () => {
    const now = new Date().toISOString()
    set({
      ...fromServer(demoGraph(), []),
      session: { id: 'demo', title: DEMO_TITLE, default_model: null, created_at: now, updated_at: now },
      status: 'ready',
      error: null,
      connection: 'live',
          unsaved: false,
      demo: true,
      demoEchoes: [],
      activeId: DEMO_ACTIVE,
      previousActiveId: null,
      mergeIds: [],
      focus: { id: DEMO_ACTIVE },
      highlight: null,
      notice: null,
      pendingDelete: null,
    })
  },

  openSettings: (section = 'general') => set({ settings: section }),
  closeSettings: () => set({ settings: null }),

  loadSession: async (id) => {
    // React StrictMode runs effects twice in development; load only once.
    if (get().status === 'loading') return
    // Switching canvases starts clean: nothing from the last one carries over.
    set({
      status: 'loading',
      error: null,
      demo: false,
      unsaved: false,
      demoEchoes: [],
      nodes: [],
      edges: [],
      activeId: null,
      previousActiveId: null,
      newThreadAt: null,
      mergeIds: [],
      focus: null,
      highlight: null,
      notice: null,
      pendingDelete: null,
    })
    try {
      if (!id) {
        openUnsaved()
        return
      }
      await sync(id)
    } catch (e) {
      set({ status: 'error', error: isMissing(e) ? "That canvas doesn't exist." : messageFor(e) })
    }
  },

  newSession: async () => {
    await get().loadSession(null)
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

  setActive: (id, centre = false) =>
    set((s) => {
      // A quote belongs to the card it was highlighted in; moving elsewhere drops it.
      const quoteStays = s.highlight !== null && ownerOf(s, s.highlight.sourceNodeId) === id
      return {
        activeId: id,
        previousActiveId: null,
        demoEchoes: id === s.activeId ? s.demoEchoes : [],
        highlight: quoteStays ? s.highlight : null,
        focus: centre ? { id } : s.focus,
        notice: null,
      }
    }),

  startNewThread: (at) =>
    set((s) => ({
      newThreadAt: at ?? null,
      activeId: null,
      previousActiveId: s.activeId ?? s.previousActiveId,
      demoEchoes: [],
      mergeIds: [],
      highlight: null,
      notice: null,
    })),

  toggleMerge: (id) =>
    set((s) => {
      const picked = s.mergeIds.includes(id)
        ? s.mergeIds.filter((other) => other !== id)
        : s.mergeIds.length === 0 && s.activeId && s.activeId !== id
          ? [s.activeId, id]
          : [...s.mergeIds, id]
      return { mergeIds: picked, highlight: null, notice: null, pendingDelete: null }
    }),

  clearMerge: () => set({ mergeIds: [] }),

  sendPrompt: async (prompt) => {
    const { session, sending, nodes, edges, activeId, mergeIds, highlight, model, images } =
      get()
    if (!session || sending) return false
    // The new card hangs from the active card, or from every card picked to merge.
    const { byId } = exchangesOf(nodes, edges)
    const from = mergeIds.length > 0 ? mergeIds : activeId ? [activeId] : []
    const parentIds = from.filter((id) => byId.has(id))
    if (get().demo) {
      // No server and no model: the prompt is echoed in the panel with a fixed
      // answer, and the canvas is left as it was.
      set((s) => ({
        demoEchoes: [...s.demoEchoes, prompt],
        mergeIds: [],
        highlight: null,
        images: [],
        notice: null,
        pendingDelete: null,
      }))
      return true
    }
    // Drawn now, saved after: the card appears the moment Enter is pressed, with
    // the id the server will save it under, its response still empty.
    // A new thread opened at a chosen spot starts there, and stays there.
    const at = parentIds.length === 0 && !highlight ? get().newThreadAt : null
    const cardId = crypto.randomUUID()
    const node: ApiNode = {
      id: cardId,
      prompt,
      response: '',
      model,
      position_x: 0,
      position_y: 0,
      status: 'pending',
      metadata: {
        ...(highlight && { highlight: { source_node_id: highlight.sourceNodeId, text: highlight.text } }),
        ...(at && { layout: at }),
      },
      created_at: new Date().toISOString(),
    }
    const box: BoxNode = { id: cardId, type: 'box', position: { x: 0, y: 0 }, data: { node, optimistic: true } }
    const drafts = {
      nodes: [box],
      edges: parentIds.map((p) => localEdge(p, cardId)),
    }
    const before = {
      activeId,
      previousActiveId: get().previousActiveId,
      newThreadAt: get().newThreadAt,
      mergeIds,
      highlight,
      images,
    }
    const showDrafts = () =>
      set((s) => ({
        nodes: [...s.nodes.filter((box) => box.id !== cardId), ...drafts.nodes],
        edges: [...s.edges.filter((edge) => !drafts.edges.some((d) => d.id === edge.id)), ...drafts.edges],
      }))
    showDrafts()
    set({
      sending: true,
      notice: null,
      pendingDelete: null,
      // The new card becomes the active one, so sending again continues it.
      activeId: cardId,
      previousActiveId: null,
      newThreadAt: null,
      mergeIds: [],
      focus: { id: cardId },
      highlight: null,
      images: [],
    })
    try {
      let sessionId = session.id
      if (get().unsaved) {
        // The first prompt on a new canvas: only now does the canvas exist.
        sessionId = (await createSession()).id
        await sync(sessionId)
        set({ unsaved: false })
        // Loading the new, empty canvas cleared the drafts; put them back.
        if (!get().nodes.some((box) => box.id === cardId)) showDrafts()
        set({ activeId: cardId, focus: { id: cardId } })
      }
      const created = await generate(sessionId, {
        prompt,
        parent_ids: parentIds,
        node_id: cardId,
        ...(at && { layout: at }),
        ...(model && { model }),
        ...(highlight && {
          highlight: { source_node_id: highlight.sourceNodeId, text: highlight.text },
        }),
        ...(images.length > 0 && {
          attachments: images.map((i) => ({
            media_type: i.mediaType,
            data: i.data,
            filename: i.name,
          })),
        }),
        // Always offered; the model only searches when the question needs it.
        web_search: true,
      })
      // The stream normally delivers the saved card (node_created). If it hasn't
      // arrived yet, fetch it so the draft is replaced regardless.
      if (get().nodes.some((box) => box.id === created.node_id && box.data.optimistic)) {
        const graph = await getSession(sessionId)
        set((s) => addMissing(s, graph))
      }
      set((s) => ({
        session: s.session && { ...s.session, title: created.session_title },
        sending: false,
      }))
      return true
    } catch (e) {
      // Not saved: the draft goes, and everything is as it was before sending.
      set((s) => ({
        ...removeNodes(s, [cardId]),
        ...before,
        focus: before.activeId ? { id: before.activeId } : null,
        sending: false,
        notice: messageFor(e),
        limitNotice: e instanceof ApiError && e.status === 402 ? messageFor(e) : null,
      }))
      return false
    }
  },

  requestDelete: (id) => {
    const { nodes, edges, pendingDelete } = get()
    const exchange = exchangesOf(nodes, edges).byId.get(id)
    if (!exchange || exchange.children.length > 0 || pendingDelete) return
    set({ pendingDelete: { nodeIds: [exchange.id], label: labelOf(exchange) }, notice: null })
  },

  confirmDelete: async () => {
    const pending = get().pendingDelete
    if (!pending) return
    set({ pendingDelete: null })
    await deleteForGood(pending.nodeIds)
  },

  cancelDelete: () => set({ pendingDelete: null }),

  placeCard: (id, layout) => get().placeCards([{ id, layout }]),

  placeCards: (cards) => {
    const { session } = get()
    if (cards.length === 0) return
    const placed = new Map(cards.map((card) => [card.id, card.layout]))
    // Applied here first, so a card doesn't jump back while the save is on its way.
    set((s) => ({
      nodes: s.nodes.map((box) => {
        if (!placed.has(box.id)) return box
        const layout = placed.get(box.id)
        const { layout: _old, ...metadata } = box.data.node.metadata
        const node = { ...box.data.node, metadata: layout ? { ...metadata, layout } : metadata }
        return { ...box, data: { ...box.data, node } }
      }),
    }))
    // The demo can be rearranged, just not saved.
    if (!session || get().demo || get().unsaved) return
    saveLayout(session.id, cards).catch(() =>
      set({ notice: "Couldn't save where that card was put. It'll move back on refresh." }),
    )
  },

  deleteCanvas: async (id) => {
    try {
      await deleteSession(id)
    } catch (e) {
      set({ notice: messageFor(e) })
      return false
    }
    if (get().session?.id === id) {
      stream?.abort() // its live updates have nothing left to report
      await get().loadSession(null)
    }
    return true
  },

  tidy: () => {
    const { nodes, edges, activeId } = get()
    const moved = exchangesOf(nodes, edges).list.filter((e) => e.layout?.x !== undefined)
    get().placeCards(
      moved.map(({ id, layout }) => {
        const { width, height } = layout ?? {}
        const size = { ...(width && { width }), ...(height && { height }) }
        return { id, layout: Object.keys(size).length > 0 ? size : null }
      }),
    )
    // Everything may have moved, so bring the view back to the active card.
    if (activeId) set({ focus: { id: activeId } })
  },

  renameCanvas: (title) => {
    const { session, unsaved } = get()
    const next = title.split(/\s+/).join(' ').trim()
    if (!session || unsaved || next === session.title) return
    set({ session: { ...session, title: next } })
    renameSession(session.id, next).catch(() => set({ notice: "Couldn't rename the canvas." }))
  },

  // Branching makes the quoted reply's card the active one, so the quote's
  // context is that card and everything above it.
  startBranch: (sourceNodeId, text) =>
    set((s) => ({
      highlight: { sourceNodeId, text },
      activeId: ownerOf(s, sourceNodeId) ?? s.activeId,
      previousActiveId: null,
      notice: null,
    })),

  clearHighlight: () => set({ highlight: null }),

  addImages: async (files) => {
    const accepted = files.filter((f) => ALLOWED_TYPES.includes(f.type))
    if (accepted.length === 0) {
      if (files.length > 0) set({ notice: 'Only images and PDFs can be attached.' })
      return
    }
    const read = await Promise.all(
      accepted.map(async (file) => ({
        id: crypto.randomUUID(),
        mediaType: file.type,
        data: await toBase64(file),
        preview: file.type === 'application/pdf' ? null : URL.createObjectURL(file),
        name: file.name || 'screenshot',
      })),
    )
    set((s) => ({ images: [...s.images, ...read].slice(0, MAX_IMAGES), notice: null }))
    read.forEach((pending, i) => {
      if (pending.mediaType !== 'application/pdf') return
      void pdfPreview(accepted[i]).then((preview) => {
        if (!preview) return
        // Removed while it was being drawn: nothing to show it on.
        if (!get().images.some((image) => image.id === pending.id)) return URL.revokeObjectURL(preview)
        set((s) => ({ images: s.images.map((image) => (image.id === pending.id ? { ...image, preview } : image)) }))
      })
    })
  },

  removeImage: (id) =>
    set((s) => {
      const going = s.images.find((i) => i.id === id)
      if (going?.preview) URL.revokeObjectURL(going.preview) // the object URL leaks otherwise
      return { images: s.images.filter((i) => i.id !== id) }
    }),

  connectRepo: async (url) => {
    const { session, demo } = get()
    if (!session || demo) return null
    try {
      let sessionId = session.id
      if (get().unsaved) {
        // Connecting a repo is starting work, so the canvas is saved now, as
        // it would be by the first prompt.
        sessionId = (await createSession()).id
        await sync(sessionId)
        set({ unsaved: false })
      }
      const repo = await putRepo(sessionId, url)
      set((s) => ({ session: s.session?.id === sessionId ? { ...s.session, repo } : s.session }))
      return null
    } catch (e) {
      return messageFor(e)
    }
  },

  disconnectRepo: () => {
    const { session, demo } = get()
    if (!session?.repo || demo) return
    const repo = session.repo
    set({ session: { ...session, repo: null } })
    deleteRepo(session.id).catch(() =>
      set((s) => ({
        session: s.session?.id === session.id ? { ...s.session, repo } : s.session,
        notice: "Couldn't disconnect the repo.",
      })),
    )
  },
}))

// Removes boxes from the canvas and the server, and drops a quote whose reply is gone.
async function deleteForGood(nodeIds: string[]) {
  const { session, demo } = useCanvasStore.getState()
  if (!session) return
  if (demo) {
    useCanvasStore.setState((s) => withoutNodes(s, nodeIds))
    return
  }
  try {
    const { deleted_node_ids } = await deleteNodes(session.id, nodeIds, false)
    useCanvasStore.setState((s) => withoutNodes(s, deleted_node_ids))
  } catch (e) {
    useCanvasStore.setState({ notice: messageFor(e) })
  }
}

function withoutNodes(s: CanvasState, nodeIds: string[]) {
  const gone = new Set(nodeIds)
  const quoteGone = s.highlight !== null && gone.has(s.highlight.sourceNodeId)
  // Deleting the active card steps back to the one it continued from.
  let activeId = s.activeId
  if (activeId && gone.has(activeId)) {
    const active = exchangesOf(s.nodes, s.edges).byId.get(activeId)
    activeId = active?.parents.find((id) => !gone.has(id)) ?? null
  }
  const previousGone = s.previousActiveId !== null && gone.has(s.previousActiveId)
  return {
    ...removeNodes(s, nodeIds),
    highlight: quoteGone ? null : s.highlight,
    mergeIds: s.mergeIds.filter((id) => !gone.has(id)),
    activeId,
    previousActiveId: previousGone ? null : s.previousActiveId,
  }
}

// The card with this id, if it is still on the canvas.
function ownerOf(s: CanvasState, nodeId: string): string | undefined {
  return exchangesOf(s.nodes, s.edges).byId.has(nodeId) ? nodeId : undefined
}

// Opening a canvas lands on the card most recently added, centred.
function openLatest() {
  const { nodes, edges } = useCanvasStore.getState()
  const latest = exchangesOf(nodes, edges).list.at(-1)
  if (latest) useCanvasStore.setState({ activeId: latest.id, focus: { id: latest.id } })
}

// ---- Live stream ----------------------------------------------------------------

let stream: AbortController | null = null
let activeSessionId: string | null = null
const MAX_RECONNECT_DELAY_MS = 10_000

// Signing out: stop live updates and forget everything from the previous account.
export function logOut() {
  resetCanvas()
  // Back to the plain address: the canvas in it isn't theirs to see any more.
  window.history.replaceState(null, '', '/')
  void signOut()
}

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
    activeId: null,
    previousActiveId: null,
    newThreadAt: null,
    mergeIds: [],
    focus: null,
    connection: 'live',
    highlight: null,
    images: [],
    models: [],
    model: null,
    sending: false,
    notice: null,
    pendingDelete: null,
      unsaved: false,
    demo: false,
    demoEchoes: [],
    settings: null,
  })
}

function apply(event: StreamEvent) {
  useCanvasStore.setState((s) => {
    if (event.type === 'nodes_deleted') return withoutNodes(s, event.data.node_ids)
    // The sidebar refetches its list when this title changes.
    if (event.type === 'canvas_titled') return { session: s.session && { ...s.session, title: event.data.title } }
    return applyEvent(s, event)
  })
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
  // A reconnect lands here too, and must leave the active card where it is.
  const firstLoad = useCanvasStore.getState().status !== 'ready'
  useCanvasStore.setState((s) => ({
    ...fromServer(graph, s.nodes),
    session,
    status: 'ready',
    connection: 'live',
  }))
  if (firstLoad) openLatest()
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

// A new, empty canvas that exists only in this tab until a prompt is sent.
function openUnsaved() {
  stream?.abort() // whatever was open before has nothing more to say
  stream = null
  activeSessionId = null
  const now = new Date().toISOString()
  useCanvasStore.setState({
    session: { id: '', title: '', default_model: null, created_at: now, updated_at: now },
    status: 'ready',
    connection: 'live',
    unsaved: true,
  })
}

function isMissing(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 422)
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
