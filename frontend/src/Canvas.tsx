import { PanOnScrollMode, ReactFlow, useReactFlow } from '@xyflow/react'
// React Flow's required styles only, not its theme. Its few visual defaults are
// CSS variables, which Canvas.module.css points at our own tokens.
import '@xyflow/react/dist/base.css'
import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import Box from './Box'
import styles from './Canvas.module.css'
import ChatBox from './ChatBox'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { isEditing } from './dom'
import FloatingEdge from './FloatingEdge'
import KeysDialog from './KeysDialog'
import Sidebar from './Sidebar'
import { useCanvasStore } from './store'

const MARGIN = 24 // breathing room between the first box and the corner

const nodeTypes = { box: Box }
const edgeTypes = { floating: FloatingEdge }

type Menu = { x: number; y: number; items: MenuItem[] }

function Canvas({ demoId }: { demoId?: string }) {
  const {
    status,
    error,
    session,
    nodes,
    edges,
    connection,
    loadSession,
    loadModels,
    onNodesChange,
    savePositions,
    deleteSelected,
    deleteNodeIds,
    reformat,
    cancelDelete,
    startBranch,
    readOnly,
    loadPublicSession,
  } = useCanvasStore(
    useShallow((s) => ({
      status: s.status,
      error: s.error,
      session: s.session,
      nodes: s.nodes,
      edges: s.edges,
      connection: s.connection,
      loadSession: s.loadSession,
      loadModels: s.loadModels,
      onNodesChange: s.onNodesChange,
      savePositions: s.savePositions,
      deleteSelected: s.deleteSelected,
      deleteNodeIds: s.deleteNodeIds,
      reformat: s.reformat,
      cancelDelete: s.cancelDelete,
      startBranch: s.startBranch,
      readOnly: s.readOnly,
      loadPublicSession: s.loadPublicSession,
    })),
  )
  const [menu, setMenu] = useState<Menu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (demoId) {
      void loadPublicSession(demoId)
      return
    }
    void loadSession(new URLSearchParams(window.location.search).get('session'))
    void loadModels()
  }, [demoId, loadPublicSession, loadSession, loadModels])

  // Keep the open canvas in the URL, so refreshing reopens it.
  useEffect(() => {
    if (!session || readOnly) return
    const url = new URL(window.location.href)
    url.searchParams.set('session', session.id)
    window.history.replaceState(null, '', url)
  }, [session])

  // Delete/Backspace deletes the selected boxes (the store asks to confirm when a
  // whole branch would go); Escape cancels that. Ignored while typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditing(document.activeElement)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        void deleteSelected()
      } else if (e.key === 'Escape') {
        cancelDelete()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteSelected, cancelDelete])

  // One handler for both menus: highlighted text inside a finished reply offers
  // Branch/Copy, a box offers Delete, and anywhere else the browser's own menu.
  // Highlighted text wins, so branching still works when right-clicking a reply.
  function onContextMenu(e: MouseEvent) {
    const quote = highlightedReplyText(e.target)
    if (quote) {
      e.preventDefault()
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: 'Branch',
            onClick: () => {
              startBranch(quote.nodeId, quote.text)
              window.getSelection()?.removeAllRanges()
              closeMenu()
            },
          },
          {
            label: 'Copy',
            onClick: () => {
              void navigator.clipboard.writeText(quote.text)
              closeMenu()
            },
          },
        ],
      })
      return
    }

    const nodeId = boxIdAt(e.target)
    if (!nodeId) return
    e.preventDefault()
    // Right-clicking inside a selection acts on all of it; otherwise just that box.
    const selected = nodes.filter((box) => box.selected).map((box) => box.id)
    const targets = selected.includes(nodeId) ? selected : [nodeId]
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: targets.length > 1 ? `Delete ${targets.length} boxes` : 'Delete',
          danger: true,
          onClick: () => {
            void deleteNodeIds(targets)
            closeMenu()
          },
        },
      ],
    })
  }

  if (status !== 'ready') {
    return (
      <Sidebar>
        <div className={styles.canvas}>
          <p className={styles.notice}>{status === 'error' ? error : 'Loading…'}</p>
          <KeysDialog />
        </div>
      </Sidebar>
    )
  }

  const canvas = (
    <div className={styles.canvas} onContextMenu={onContextMenu}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_event, _node, dragged) => savePositions(dragged)}
        onMoveStart={closeMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        // Trackpad conventions, as in Figma: two-finger swipe moves the canvas,
        // pinch zooms. React Flow zooms on scroll by default, and a two-finger
        // swipe arrives as a scroll event, so that has to be turned off.
        panOnScroll
        panOnScrollSpeed={1.2}
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        panOnDrag
        // Deleting goes through the server (the key handler above), never React Flow's local delete.
        deleteKeyCode={null}
        // Click selects one box; Shift- or Cmd-click adds more (a merge).
        multiSelectionKeyCode={['Shift', 'Meta']}
        fitView
        // Never smaller than 40%: below that the text is unreadable, and there
        // is no way back except guessing.
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={0.4}
        maxZoom={2}
      >
        <FollowNewNodes />
        <GoHome />
      </ReactFlow>
      {nodes.length > 1 && (
        <button type="button" className={styles.reformat} onClick={reformat}>
          Reformat
        </button>
      )}
      {nodes.length === 0 && <p className={styles.notice}>Type below to start a conversation.</p>}
      {connection === 'reconnecting' && <p className={styles.connection}>Reconnecting…</p>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
      {readOnly ? <DemoBar /> : <ChatBox />}
      {!readOnly && <KeysDialog />}
    </div>
  )

  return readOnly ? canvas : <Sidebar>{canvas}</Sidebar>
}

// Shown instead of the chat box on the public canvas.
function DemoBar() {
  return (
    <div className={styles.demoBar}>
      <span>
        A canvas you can read, pan and zoom. Sign in to make your own.
      </span>
      <a className={styles.demoButton} href="/">
        Sign in
      </a>
    </div>
  )
}

// The id of the box under the pointer, if any. React Flow puts data-id on the
// wrapper it renders around each box.
function boxIdAt(target: EventTarget): string | null {
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

// Puts the canvas origin back in the top-left corner. Reformat packs everything
// from (0, 0), so fitView would centre the result and leave a gap down the left.
function GoHome() {
  const homeView = useCanvasStore((s) => s.homeView)
  const { setViewport, getZoom } = useReactFlow()

  useEffect(() => {
    if (!homeView) return
    void setViewport({ x: MARGIN, y: MARGIN, zoom: getZoom() }, { duration: 300 })
  }, [homeView, setViewport, getZoom])

  return null
}

// Moves the view to the boxes a sent prompt created. Rendered inside <ReactFlow>
// so it can use React Flow's viewport controls.
function FollowNewNodes() {
  const focusNodeIds = useCanvasStore((s) => s.focusNodeIds)
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (!focusNodeIds) return
    void fitView({ nodes: focusNodeIds.map((id) => ({ id })), duration: 300, maxZoom: 1, padding: 0.2 })
  }, [focusNodeIds, fitView])

  return null
}

export default Canvas
