import { ReactFlow, useReactFlow } from '@xyflow/react'
// React Flow's required styles only, not its theme. Its few visual defaults are
// CSS variables, which Canvas.module.css points at our own tokens.
import '@xyflow/react/dist/base.css'
import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import Box from './Box'
import styles from './Canvas.module.css'
import CanvasMenu from './CanvasMenu'
import ChatBox from './ChatBox'
import { isEditing } from './dom'
import KeysDialog from './KeysDialog'
import ReplyMenu from './ReplyMenu'
import { useCanvasStore } from './store'

const nodeTypes = { box: Box }

type Menu = { x: number; y: number; nodeId: string; text: string }

function Canvas() {
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
    cancelDelete,
    startBranch,
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
      cancelDelete: s.cancelDelete,
      startBranch: s.startBranch,
    })),
  )
  const [menu, setMenu] = useState<Menu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    void loadSession(new URLSearchParams(window.location.search).get('session'))
    void loadModels()
  }, [loadSession, loadModels])

  // Keep the open canvas in the URL, so refreshing reopens it.
  useEffect(() => {
    if (!session) return
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

  // Our menu only for a right-click on highlighted text inside a finished reply;
  // everywhere else the browser's normal menu.
  function onContextMenu(e: MouseEvent) {
    const quote = highlightedReplyText(e.target)
    if (!quote) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, ...quote })
  }

  if (status !== 'ready') {
    return (
      <div className={styles.canvas}>
        <CanvasMenu />
        <p className={styles.notice}>{status === 'error' ? error : 'Loading…'}</p>
        <KeysDialog />
      </div>
    )
  }

  return (
    <div className={styles.canvas} onContextMenu={onContextMenu}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_event, _node, dragged) => savePositions(dragged)}
        onMoveStart={closeMenu}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        // Deleting goes through the server (the key handler above), never React Flow's local delete.
        deleteKeyCode={null}
        // Click selects one box; Shift- or Cmd-click adds more (a merge).
        multiSelectionKeyCode={['Shift', 'Meta']}
        fitView
        minZoom={0.1}
        maxZoom={2}
      >
        <FollowNewNodes />
      </ReactFlow>
      <CanvasMenu />
      {nodes.length === 0 && <p className={styles.notice}>Type below to start a conversation.</p>}
      {connection === 'reconnecting' && <p className={styles.connection}>Reconnecting…</p>}
      {menu && (
        <ReplyMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          onBranch={() => {
            startBranch(menu.nodeId, menu.text)
            window.getSelection()?.removeAllRanges()
            closeMenu()
          }}
          onCopy={() => {
            void navigator.clipboard.writeText(menu.text)
            closeMenu()
          }}
        />
      )}
      <ChatBox />
      <KeysDialog />
    </div>
  )
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

// Moves the view to the boxes a sent prompt created. Rendered inside <ReactFlow>
// so it can use React Flow's viewport controls.
function FollowNewNodes() {
  const focusNodeIds = useCanvasStore((s) => s.focusNodeIds)
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (!focusNodeIds) return
    void fitView({ nodes: focusNodeIds.map((id) => ({ id })), duration: 300, maxZoom: 1, padding: 0.4 })
  }, [focusNodeIds, fitView])

  return null
}

export default Canvas
