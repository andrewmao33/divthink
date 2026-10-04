import { applyNodeChanges, ReactFlow, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import Box from './Box'
import styles from './DemoCanvas.module.css'
import FloatingEdge from './FloatingEdge'
import type { BoxNode } from './graph'
import { useCanvasStore } from './store'

const nodeTypes = { box: Box }
const edgeTypes = { floating: FloatingEdge }

// The real demo canvas, on the landing page rather than behind a link. Reuses the
// app's own Box and edge components, so what a visitor sees is the product, not a
// picture of it.
function DemoCanvas({ id }: { id: string }) {
  const { status, loaded, edges, loadPublicSession } = useCanvasStore(
    useShallow((s) => ({
      status: s.status,
      loaded: s.nodes,
      edges: s.edges,
      loadPublicSession: s.loadPublicSession,
    })),
  )

  // Dragging is local to this component. `nodes` is a controlled prop, so
  // without an onNodesChange React Flow emits the move and nothing applies it —
  // which is why the boxes looked stuck. Keeping the state here also means a
  // visitor rearranging the demo never touches the app's own store.
  const [nodes, setNodes] = useState<BoxNode[]>([])
  useEffect(() => setNodes(loaded), [loaded])
  const onNodesChange = useCallback(
    (changes: NodeChange<BoxNode>[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  )

  useEffect(() => {
    void loadPublicSession(id)
  }, [id, loadPublicSession])

  if (status === 'error') return null // a broken demo shouldn't break the page

  return (
    <div className={styles.frame}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        // Boxes move and can be selected: it is a canvas, and refusing to let
        // anyone touch it makes it look like a picture of one. Nothing persists —
        // the public routes are read-only and the store refuses writes.
        nodesDraggable
        elementsSelectable
        deleteKeyCode={null}
        // A fixed zoom, not fitView: the layout in make_demo.py is packed to fit
        // at this zoom, and fitting instead would change the zoom per screen
        // width — sometimes dropping below the point where replies collapse to
        // their titles.
        defaultViewport={{ x: 28, y: 28, zoom: 0.7 }}
        minZoom={0.4}
        maxZoom={1.4}
        // The page scrolls, so the canvas must not eat the wheel. Drag to pan,
        // pinch to zoom — scrolling always belongs to the page.
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        zoomOnDoubleClick={false}
        panOnDrag
        zoomOnPinch
        proOptions={{ hideAttribution: false }}
      />
      <p className={styles.hint}>Drag the boxes, or the background to pan · pinch to zoom</p>
    </div>
  )
}

export default DemoCanvas
