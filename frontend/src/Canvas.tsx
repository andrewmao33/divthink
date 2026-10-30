import {
  PanOnScrollMode,
  ReactFlow,
  ViewportPortal,
  useReactFlow,
  useStore,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
// React Flow's required styles only, not its theme. Its few visual defaults are
// CSS variables, which Canvas.module.css points at our own tokens.
import '@xyflow/react/dist/base.css'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import styles from './Canvas.module.css'
import Card, { type CardNode, type CardState } from './Card'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { isEditing } from './dom'
import type { CardLayout } from './api'
import { ancestorIds, exchangesOf, threads } from './exchanges'
import { CARD_WIDTH, layout, type Point, type Size } from './layout'
import { billingReturn } from './nav'
import Panel, { PANEL_MAX, PANEL_MIN } from './Panel'
import Settings from './Settings'
import Sidebar from './Sidebar'
import barStyles from './Sidebar.module.css'
import { useCanvasStore } from './store'

const CANVAS_PATH = '/canvas/' // followed by the open canvas's id
const PANEL_STORAGE_KEY = 'divthink.panel'
const PANEL_DEFAULT = 420
const PANEL_GUTTER = 24 // the panel's margin plus the gap to its right
const EMBEDDED_PANEL = 380 // the panel's width in the landing page's demo
// The demo is a small window, so the frame around its canvas (bar, panel, Tidy)
// is drawn smaller than life, the way a screenshot of the app would be.
const EMBEDDED_SCALE = 0.8
const EMBEDDED_NARROW = 760 // below this the demo opens with the panel folded away
const EMBEDDED_MAX_ZOOM = 0.8 // the demo opens on the whole example, but never closer than this
const FIT_MARGIN = 28 // space left around the example when it is fitted
const THREAD_LABEL = 28 // the "thread 1" above a thread, which the fit has to leave room for

const nodeTypes = { card: Card }

type Menu = { x: number; y: number; items: MenuItem[] }
type Sizes = Record<string, Size>

type Props = {
  // Set inside the landing page: shows the built-in example in whatever box it
  // is given, with no bar or drawer, and leaves scrolling to the page.
  embedded?: boolean
}

function Canvas({ embedded = false }: Props) {
  const {
    status,
    error,
    session,
    nodes,
    edges,
    activeId,
    mergeIds,
    connection,
    loadSession,
    loadModels,
    setActive,
    toggleMerge,
    clearMerge,
    placeCard,
    placeCards,
    tidy,
    requestDelete,
    cancelDelete,
    startBranch,
    startNewThread,
    newThreadAt,
    unsaved,
    loadDemo,
  } = useCanvasStore(
    useShallow((s) => ({
      status: s.status,
      error: s.error,
      session: s.session,
      unsaved: s.unsaved,
      nodes: s.nodes,
      edges: s.edges,
      activeId: s.activeId,
      mergeIds: s.mergeIds,
      connection: s.connection,
      loadSession: s.loadSession,
      loadModels: s.loadModels,
      setActive: s.setActive,
      toggleMerge: s.toggleMerge,
      clearMerge: s.clearMerge,
      placeCard: s.placeCard,
      placeCards: s.placeCards,
      tidy: s.tidy,
      requestDelete: s.requestDelete,
      cancelDelete: s.cancelDelete,
      startBranch: s.startBranch,
      startNewThread: s.startNewThread,
      newThreadAt: s.newThreadAt,
      loadDemo: s.loadDemo,
    })),
  )
  const [menu, setMenu] = useState<Menu | null>(null)
  // For turning a point on screen into a point on the canvas.
  const flow = useRef<ReactFlowInstance<CardNode, Edge> | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const [panel, setPanel] = useState(() =>
    embedded
      ? { width: EMBEDDED_PANEL, collapsed: window.innerWidth < EMBEDDED_NARROW }
      : readPanel(),
  )
  // How much of the left of the window the panel covers. The canvas centres
  // things in what is left over, not in the whole window.
  const scale = embedded ? EMBEDDED_SCALE : 1
  const inset = panel.collapsed ? 0 : (panel.width + PANEL_GUTTER) * scale

  useEffect(() => {
    if (embedded) return // the demo's panel size isn't the visitor's preference
    try {
      window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(panel))
    } catch {
      // Storage unavailable; the size just isn't remembered.
    }
  }, [panel, embedded])

  useEffect(() => {
    if (embedded) {
      loadDemo()
      return
    }
    void loadSession(canvasIdInAddress())
    void loadModels()
    // Back from Stripe's checkout or portal: once, not again on coming back
    // from the plans page.
    if (billingReturn && !billingShown) {
      billingShown = true
      useCanvasStore.getState().openSettings('billing')
    }
  }, [embedded, loadSession, loadModels, loadDemo])

  // Keep the open canvas in the URL, so refreshing reopens it. A new canvas
  // has no address of its own until its first prompt saves it.
  useEffect(() => {
    if (!session || embedded) return
    window.history.replaceState(null, '', unsaved ? '/' : `${CANVAS_PATH}${session.id}`)
  }, [session, unsaved, embedded])

  // Escape backs out of a delete waiting to be confirmed, then of a merge being
  // drafted. Ignored while typing: the composer handles its own Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isEditing(document.activeElement)) return
      if (useCanvasStore.getState().pendingDelete) cancelDelete()
      else clearMerge()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelDelete, clearMerge])

  const { list, byId } = exchangesOf(nodes, edges)

  // Card heights depend on their text, which only the browser can measure.
  // React Flow reports them here; they feed the layout and go back onto the
  // cards, which stay hidden until they carry a measured size.
  const [sizes, setSizes] = useState<Sizes>({})
  // A drag or a resize in progress: where the card is right now, ahead of what
  // is saved. The store gets the result when the gesture ends.
  const [inHand, setInHand] = useState<Record<string, CardLayout>>({})
  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    for (const change of changes) {
      if (change.type === 'dimensions' && change.dimensions) {
        const { id, dimensions } = change
        setSizes((current) => {
          const known = current[id]
          if (known?.width === dimensions.width && known.height === dimensions.height) return current
          return { ...current, [id]: dimensions }
        })
        // setAttributes marks a resize by hand, as opposed to a measurement.
        if (change.setAttributes) setInHand((current) => ({ ...current, [id]: { ...current[id], ...dimensions } }))
      } else if (change.type === 'position' && change.position) {
        const { id, position } = change
        setInHand((current) => ({ ...current, [id]: { ...current[id], ...position } }))
      }
    }
  }, [])

  // Once the store holds what a gesture ended on, the copy here has done its job.
  useEffect(() => {
    setInHand((current) => {
      const settled = Object.entries(current).filter(([id, hand]) => {
        const saved = byId.get(id)?.layout
        const keys = Object.keys(hand) as (keyof CardLayout)[]
        return !byId.has(id) || keys.every((key) => saved?.[key] === hand[key])
      })
      if (settled.length === 0) return current
      const gone = new Set(settled.map(([id]) => id))
      return Object.fromEntries(Object.entries(current).filter(([id]) => !gone.has(id)))
    })
  }, [byId])

  // The layout only depends on which cards exist, how they connect, how big they
  // are and which have been placed by hand, so text streaming into a card
  // doesn't redo it until the card grows.
  const shape = list
    .map((e) => `${e.id}<${e.parents.join(',')}@${e.layout?.x ?? ''},${e.layout?.y ?? ''}`)
    .join('|')
  const positions = useMemo(() => {
    const placed: Record<string, Point> = {}
    for (const exchange of list) {
      const { x, y } = { ...exchange.layout, ...inHand[exchange.id] }
      if (x !== undefined && y !== undefined) placed[exchange.id] = { x, y }
    }
    return layout(list, sizes, placed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, sizes, inHand])
  // The first card of each thread carries the thread's label.
  const threadStarts = useMemo(
    () => new Map(threads(list).map((thread, index) => [thread[0].id, index + 1])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape],
  )
  const onPath = useMemo(
    () => (activeId ? ancestorIds(byId, activeId) : new Set<string>()),
    [byId, activeId],
  )

  const cards: CardNode[] = useMemo(
    () =>
      list.map((exchange) => {
        const state: CardState =
          exchange.id === activeId ? 'active' : onPath.has(exchange.id) ? 'path' : 'rest'
        const { width, height } = { ...exchange.layout, ...inHand[exchange.id] }
        return {
          id: exchange.id,
          type: 'card',
          position: positions.get(exchange.id) ?? { x: 0, y: 0 },
          width: width ?? CARD_WIDTH,
          ...(height !== undefined && { height }),
          data: {
            exchange,
            state,
            picked: mergeIds.includes(exchange.id),
            sized: height !== undefined,
            thread: threadStarts.get(exchange.id) ?? null,
          },
          ...(sizes[exchange.id] && { measured: sizes[exchange.id] }),
        }
      }),
    [list, positions, sizes, inHand, activeId, onPath, mergeIds, threadStarts],
  )

  const lines: Edge[] = useMemo(
    () =>
      list
        .flatMap((exchange) =>
          exchange.parents.map((parent) => {
            const lit = onPath.has(exchange.id) && onPath.has(parent)
            // A reply that isn't the first from its parent went back to an older
            // card to say something different: a branch, drawn dashed.
            const branch =
              exchange.parents.length === 1 && byId.get(parent)?.children[0] !== exchange.id
            return {
              id: `${parent}>${exchange.id}`,
              source: parent,
              target: exchange.id,
              style: {
                ...(lit && { stroke: 'var(--edge-lit)', strokeWidth: 1.5 }),
                ...(branch && { strokeDasharray: '5 5' }),
              },
              lit,
            }
          }),
        )
        // Every line is drawn beneath the cards, so none crosses a card's text.
        // Among themselves, the lit ones are drawn last, over the dim ones.
        .sort((a, b) => Number(a.lit) - Number(b.lit))
        .map(({ lit: _lit, ...line }) => line),
    [list, byId, onPath],
  )

  // The cards directly below `id` that sit where they do because of it: placed
  // by the layout, and hung from this card rather than another parent.
  function followersOf(id: string): string[] {
    return (byId.get(id)?.children ?? []).filter((childId) => {
      const child = byId.get(childId)
      return child?.parents[0] === id && child.layout?.x === undefined
    })
  }

  // One handler for both menus, over the canvas and the panel alike: highlighted
  // text inside a finished reply offers Branch/Copy, a card nothing continues
  // from offers Delete, and anywhere else the browser's own menu.
  function onContextMenu(e: MouseEvent) {
    const quote = highlightedReplyText(e.target)
    if (quote) {
      e.preventDefault()
      const items: MenuItem[] = [
        {
          label: 'Copy',
          onClick: () => {
            void navigator.clipboard.writeText(quote.text)
            closeMenu()
          },
        },
      ]
      items.unshift({
        label: 'Branch',
        onClick: () => {
          startBranch(quote.nodeId, quote.text)
          window.getSelection()?.removeAllRanges()
          closeMenu()
        },
      })
      setMenu({ x: e.clientX, y: e.clientY, items })
      return
    }

    const id = cardIdAt(e.target)
    const exchange = id ? byId.get(id) : undefined
    if (!exchange) {
      // Empty canvas: start a thread whose first card goes right here.
      const onPane = e.target instanceof Element && e.target.closest('.react-flow__pane')
      if (!onPane || embedded || !flow.current) return
      e.preventDefault()
      const at = flow.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: 'New thread here',
            onClick: () => {
              startNewThread({ x: Math.round(at.x), y: Math.round(at.y) })
              closeMenu()
            },
          },
        ],
      })
      return
    }
    const items: MenuItem[] = [
      {
        label: mergeIds.includes(exchange.id) ? 'Remove from merge' : 'Merge with…',
        onClick: () => {
          toggleMerge(exchange.id)
          closeMenu()
        },
      },
    ]
    if (exchange.layout) {
      items.push({
        label: 'Reset position and size',
        onClick: () => {
          placeCard(exchange.id, null)
          closeMenu()
        },
      })
    }
    // Only a card nothing continues from can go: deleting one in the middle
    // would take everything below it too.
    if (exchange.children.length === 0) {
      items.push({
        label: 'Delete',
        danger: true,
        onClick: () => {
          requestDelete(exchange.id)
          closeMenu()
        },
      })
    }
    if (items.length === 0) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Without the app's own frame: the landing page's demo.
  const bare = embedded

  if (status !== 'ready') {
    const loading = (
      <div className={styles.canvas}>
        <p className={styles.notice}>{status === 'error' ? error : 'Loading…'}</p>
        {!embedded && <Settings />}
      </div>
    )
    return embedded ? loading : <Sidebar>{loading}</Sidebar>
  }

  const canvas = (
    <div
      className={styles.canvas}
      style={
        {
          ...(embedded && { '--chrome-zoom': scale }),
        } as CSSProperties
      }
      data-embedded={embedded || undefined}
      onContextMenu={onContextMenu}
    >
      <ReactFlow
        nodes={cards}
        edges={lines}
        onNodesChange={onNodesChange}
        // Shift- or Cmd-click picks cards to merge; while a merge is being
        // drafted, a plain click does too.
        onNodeClick={(event, card) => {
          if (event.shiftKey || event.metaKey || mergeIds.length > 0) toggleMerge(card.id)
          else setActive(card.id)
        }}
        // Dragging moves one card. Cards that follow the layout would react to
        // it, coming along or stepping out of its way, so all of them are
        // held where they are for the drag. When it ends, the ones hanging from
        // the dragged card are given that place as their own, and the rest are
        // let go.
        onNodeDragStart={() => {
          setInHand((current) => {
            const next = { ...current }
            for (const exchange of list) {
              if (exchange.layout?.x === undefined) {
                next[exchange.id] = { ...next[exchange.id], ...positions.get(exchange.id) }
              }
            }
            return next
          })
        }}
        onNodeDragStop={(_event, _card, dragged) => {
          const kept = new Set(dragged.flatMap((card) => [card.id, ...followersOf(card.id)]))
          setInHand((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => kept.has(id))),
          )
          placeCards(
            dragged.flatMap((card) => [
              { id: card.id, layout: { ...byId.get(card.id)?.layout, ...card.position } },
              ...followersOf(card.id).map((id) => ({
                id,
                layout: { ...byId.get(id)?.layout, ...positions.get(id) },
              })),
            ]),
          )
        }}
        onMoveStart={closeMenu}
        onInit={(instance) => {
          flow.current = instance
        }}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        // Trackpad conventions, as in Figma: two-finger swipe moves the canvas,
        // pinch zooms. React Flow zooms on scroll by default, and a two-finger
        // swipe arrives as a scroll event, so that has to be turned off.
        // Inside the landing page the scroll belongs to the page: drag to pan.
        panOnScroll={!embedded}
        preventScrolling={!embedded}
        panOnScrollSpeed={1.2}
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        panOnDrag
        defaultViewport={{ x: inset + 48, y: 96, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={2}
      >
        <Grain scaled={!embedded} />
        {newThreadAt && activeId === null && mergeIds.length === 0 && (
          // Where the new thread's first card will go, until its prompt is sent.
          <ViewportPortal>
            <div
              className={styles.newThreadSpot}
              style={{ width: CARD_WIDTH, transform: `translate(${newThreadAt.x}px, ${newThreadAt.y}px)` }}
            >
              <span className={styles.newThreadTitle}>New thread</span>
              Write the first prompt on the left.
            </div>
          </ViewportPortal>
        )}
        <Focus
          positions={positions}
          sizes={sizes}
          inset={inset}
          showAll={embedded}
        />
        {embedded && <ZoomButtons />}
      </ReactFlow>
      {list.length > 1 && (
        <button
          type="button"
          className={styles.tidy}
          onClick={tidy}
          title="Put every card back where the automatic layout would"
        >
          Tidy
        </button>
      )}
      {embedded && (
        // The app's bar, for show: the demo has one canvas and nothing to open.
        <div className={barStyles.bar}>
          <span className={barStyles.menuButton} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </span>
          <img className={barStyles.mark} src="/logo.svg" alt="" />
          <span className={barStyles.brand}>Divthink</span>
          <span className={barStyles.slash}>/</span>
          <span className={barStyles.demoName}>{session?.title}</span>
        </div>
      )}
      {connection === 'reconnecting' && <p className={styles.connection}>Reconnecting…</p>}
      <Panel
        width={panel.width}
        onResize={(width) => setPanel((p) => ({ ...p, width }))}
        collapsed={panel.collapsed}
        onCollapse={(collapsed) => setPanel((p) => ({ ...p, collapsed }))}
      />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
      {!bare && <Settings />}
    </div>
  )

  return bare ? canvas : <Sidebar>{canvas}</Sidebar>
}

// The canvas's texture. It is pinned to the canvas, not the window: it slides
// and scales with the cards, which is what makes panning over empty space
// visible at all. The tile sizes are the grain's natural size at 100%.
// Not scaled in the landing page's demo: there the grain has to match the page
// around it, and a canvas zoomed out to fit would make it visibly finer.
function Grain({ scaled }: { scaled: boolean }) {
  const [x, y, zoom] = useStore((s) => s.transform)
  const size = scaled ? zoom : 1
  return (
    <div
      className={styles.grain}
      style={{
        backgroundPosition: `${x}px ${y}px`,
        backgroundSize: `${260 * size}px, ${320 * size}px`,
      }}
    />
  )
}

// Brings a card to the middle of the visible canvas when the store asks: on
// opening a canvas, after sending, and on jumps made from the panel. Rendered
// inside <ReactFlow> so it can use React Flow's viewport controls.
function Focus({
  positions,
  sizes,
  inset,
  showAll,
}: {
  positions: Map<string, Point>
  sizes: Sizes
  inset: number
  // Open on the whole canvas rather than on one card: the landing page's demo,
  // where the shape of the example is the point.
  showAll: boolean
}) {
  const focus = useCanvasStore((s) => s.focus)
  const { setCenter, getZoom } = useReactFlow()
  const [width, height] = [useStore((s) => s.width), useStore((s) => s.height)]
  const handled = useRef<{ id: string } | null>(null)
  const opening = useRef(true)

  useEffect(() => {
    if (!focus || handled.current === focus) return
    const at = positions.get(focus.id)
    const size = sizes[focus.id]
    if (!at || !size) return // a new card: wait until it has been measured and placed
    if (opening.current && showAll) {
      // Every card has to be measured before the whole can be fitted.
      const ids = [...positions.keys()]
      if (width === 0 || ids.some((id) => !sizes[id])) return
      const left = Math.min(...ids.map((id) => positions.get(id)!.x))
      const top = Math.min(...ids.map((id) => positions.get(id)!.y))
      const right = Math.max(...ids.map((id) => positions.get(id)!.x + sizes[id].width))
      const bottom = Math.max(...ids.map((id) => positions.get(id)!.y + sizes[id].height))
      const zoom = Math.min(
        EMBEDDED_MAX_ZOOM,
        (width - inset - 2 * FIT_MARGIN) / (right - left),
        (height - 2 * FIT_MARGIN) / (bottom - top + THREAD_LABEL),
      )
      handled.current = focus
      opening.current = false
      void setCenter((left + right) / 2 - inset / (2 * zoom), (top + bottom - THREAD_LABEL) / 2, {
        zoom,
        duration: 0,
      })
      return
    }
    handled.current = focus
    // Opening a canvas starts at 100%, in place; later moves keep the zoom and glide.
    const zoom = opening.current ? 1 : getZoom()
    void setCenter(at.x + size.width / 2 - inset / (2 * zoom), at.y + size.height / 2, {
      zoom,
      duration: opening.current ? 0 : 300,
    })
    opening.current = false
  }, [focus, positions, sizes, inset, showAll, width, height, setCenter, getZoom])

  return null
}

// Zooming by hand, for the landing page's demo: the page keeps the scroll
// wheel, so without these a mouse has no way to zoom at all.
function ZoomButtons() {
  const { zoomIn, zoomOut } = useReactFlow()
  return (
    <div className={styles.zoomButtons}>
      <button type="button" onClick={() => void zoomOut({ duration: 150 })} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <button type="button" onClick={() => void zoomIn({ duration: 150 })} aria-label="Zoom in" title="Zoom in">
        +
      </button>
    </div>
  )
}

let billingShown = false

// Which canvas the address names: divthink.com/canvas/<id>. Links from before
// that, of the form ?session=<id>, still open the canvas they point to.
function canvasIdInAddress(): string | null {
  const { pathname, search } = window.location
  if (pathname.startsWith(CANVAS_PATH)) {
    const id = pathname.slice(CANVAS_PATH.length).split('/')[0]
    if (id) return decodeURIComponent(id)
  }
  return new URLSearchParams(search).get('session')
}

function readPanel(): { width: number; collapsed: boolean } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PANEL_STORAGE_KEY) ?? 'null')
    const width = Number(saved?.width)
    return {
      width: Number.isFinite(width) ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, width)) : PANEL_DEFAULT,
      collapsed: saved?.collapsed === true,
    }
  } catch {
    return { width: PANEL_DEFAULT, collapsed: false }
  }
}

// The id of the card under the pointer, if any. React Flow puts data-id on the
// wrapper it renders around each card.
function cardIdAt(target: EventTarget): string | null {
  const element = target instanceof Element ? target : null
  return element?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
}

// The highlighted text and its reply, if the current selection lies within one
// finished reply and the right-click happened on that same reply.
function highlightedReplyText(target: EventTarget): { nodeId: string; text: string } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return null
  const text = selection.toString().trim()
  if (!text) return null

  const replyOf = (node: globalThis.Node | EventTarget | null) => {
    const element = node instanceof Element ? node : node instanceof globalThis.Node ? node.parentElement : null
    return element?.closest('[data-reply-id]') ?? null
  }
  const reply = replyOf(selection.anchorNode)
  if (!reply || reply !== replyOf(selection.focusNode) || reply !== replyOf(target)) return null

  const nodeId = reply.getAttribute('data-reply-id')
  return nodeId ? { nodeId, text } : null
}

export default Canvas
