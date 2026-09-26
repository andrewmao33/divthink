// Canvas data and how live events change it. No React here, so it can be tested directly.
import type { Edge, Node } from '@xyflow/react'
import type { ApiEdge, ApiNode } from './api'
import type { StreamEvent } from './stream'

// Browser-only state for a reply that is streaming right now. Never saved.
export type LiveReply = {
  thinkingStartedAt: number | null // when thinking began (ms)
  thinkingSeconds: number | null // set when answer text starts after thinking
  headings: string[]
}

// A canvas box, as React Flow sees it. The backend node rides along in data.
export type BoxData = { node: ApiNode; live?: LiveReply }
export type BoxNode = Node<BoxData, 'box'>

type Graph = { nodes: BoxNode[]; edges: Edge[] }
type ApiGraph = { nodes: ApiNode[]; edges: ApiEdge[] }

export function toBox(node: ApiNode): BoxNode {
  return {
    id: node.id,
    type: 'box',
    position: { x: node.position_x, y: node.position_y },
    data: { node },
  }
}

export function toEdge(edge: ApiEdge): Edge {
  // 'floating': the line picks whichever sides of the two boxes face each other
  // (FloatingEdge.tsx), so a branch beside its reply joins from the side.
  return { id: edge.id, type: 'floating', source: edge.parent_id, target: edge.child_id }
}

// A server snapshot as the new truth. Boxes already on screen keep their position
// and selection, so a resync doesn't undo dragging (positions aren't saved yet).
export function fromServer(graph: ApiGraph, onScreen: BoxNode[]): Graph {
  const current = new Map(onScreen.map((box) => [box.id, box]))
  return {
    nodes: graph.nodes.map((node) => {
      const existing = current.get(node.id)
      const box = toBox(node)
      return existing ? { ...box, position: existing.position, selected: existing.selected } : box
    }),
    edges: graph.edges.map(toEdge),
  }
}

// Removes boxes and any lines touching them.
export function removeNodes(current: Graph, nodeIds: string[]): Graph {
  const gone = new Set(nodeIds)
  if (!current.nodes.some((box) => gone.has(box.id))) return current
  return {
    nodes: current.nodes.filter((box) => !gone.has(box.id)),
    edges: current.edges.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)),
  }
}

// Selects exactly one box (or none, with null). Unchanged boxes keep their identity.
export function selectOnly(nodes: BoxNode[], id: string | null): BoxNode[] {
  return nodes.map((box) => {
    const selected = box.id === id
    return Boolean(box.selected) === selected ? box : { ...box, selected }
  })
}

// Adds nodes and edges that aren't on screen yet, leaving existing ones untouched.
export function addMissing(current: Graph, graph: ApiGraph): Graph {
  const nodeIds = new Set(current.nodes.map((box) => box.id))
  const edgeIds = new Set(current.edges.map((edge) => edge.id))
  const newNodes = graph.nodes.filter((node) => !nodeIds.has(node.id))
  const newEdges = graph.edges.filter((edge) => !edgeIds.has(edge.id))
  if (newNodes.length === 0 && newEdges.length === 0) return current
  return {
    nodes: [...current.nodes, ...newNodes.map(toBox)],
    edges: [...current.edges, ...newEdges.map(toEdge)],
  }
}

// Applies one live event (design.md, "State flow"): node_created skips boxes already
// on screen; thinking/thought/token are ignored once a reply is complete or failed,
// so caught-up text is never doubled; done and error set the final state.
export function applyEvent(current: Graph, event: StreamEvent, now = Date.now()): Graph {
  switch (event.type) {
    case 'node_created':
      return addMissing(current, { nodes: [event.data.node], edges: event.data.edges })

    case 'nodes_deleted':
      return removeNodes(current, event.data.node_ids)

    case 'thinking':
      return updateReply(current, event.data.node_id, ({ node, live }) => ({
        node: { ...node, status: 'streaming' },
        live: { thinkingStartedAt: now, thinkingSeconds: null, headings: live?.headings ?? [] },
      }))

    case 'thought': {
      const { node_id, heading } = event.data
      return updateReply(current, node_id, ({ node, live }) => ({
        node,
        live: { ...emptyLive(), ...live, headings: [...(live?.headings ?? []), heading] },
      }))
    }

    case 'token': {
      const { node_id, text } = event.data
      return updateReply(current, node_id, ({ node, live }) => {
        const thinkingEnded = live?.thinkingStartedAt != null && live.thinkingSeconds == null
        return {
          node: { ...node, status: 'streaming', content: node.content + text },
          live: {
            ...emptyLive(),
            ...live,
            thinkingSeconds: thinkingEnded
              ? Math.round((now - live.thinkingStartedAt!) / 100) / 10
              : (live?.thinkingSeconds ?? null),
          },
        }
      })
    }

    case 'done': {
      const { node_id, content, thought_headings, thinking_seconds } = event.data
      return update(current, node_id, false, ({ node }) => ({
        node: {
          ...node,
          status: 'complete',
          content,
          metadata: { ...node.metadata, thought_headings, thinking_seconds },
        },
      }))
    }

    case 'error': {
      const { node_id, message } = event.data
      return update(current, node_id, false, ({ node }) => ({
        node: { ...node, status: 'error', content: '', metadata: { ...node.metadata, error: message } },
      }))
    }
  }
}

function emptyLive(): LiveReply {
  return { thinkingStartedAt: null, thinkingSeconds: null, headings: [] }
}

// Updates a reply that is still in progress (pending or streaming).
function updateReply(current: Graph, id: string, change: (data: BoxData) => BoxData): Graph {
  return update(current, id, true, change)
}

function update(
  current: Graph,
  id: string,
  onlyInProgress: boolean,
  change: (data: BoxData) => BoxData,
): Graph {
  let changed = false
  const nodes = current.nodes.map((box) => {
    if (box.id !== id) return box
    const finished = box.data.node.status === 'complete' || box.data.node.status === 'error'
    if (onlyInProgress && finished) return box
    changed = true
    return { ...box, data: change(box.data) }
  })
  return changed ? { nodes, edges: current.edges } : current
}
