// Re-laying the canvas out into readable rows. Pure, so it can be reasoned about
// (and tested) without React Flow.
import type { Edge } from '@xyflow/react'
import type { BoxNode } from './graph'

const COLUMN_GAP = 20 // between boxes side by side
const ROW_GAP = 20 // between one row and the next
const TREE_GAP = 40 // between one tree and the next across the canvas
const FALLBACK_WIDTH = 560 // matches .box in Box.module.css
const FALLBACK_HEIGHT = 200

export type Placed = { id: string; x: number; y: number }

/** Rows by distance from a root, so every box sits below all of its parents.
 *
 * Depth is the LONGEST path from a root, not the shortest: a merge has to sit
 * below both of its branches, and taking the shortest path would put it level
 * with the earlier one and let the edge run upwards.
 */
function depths(nodes: BoxNode[], parents: Map<string, string[]>): Map<string, number> {
  const depth = new Map<string, number>()
  const visiting = new Set<string>()

  const of = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0 // a cycle shouldn't be possible, but don't hang
    visiting.add(id)
    const above = parents.get(id) ?? []
    const value = above.length === 0 ? 0 : Math.max(...above.map(of)) + 1
    visiting.delete(id)
    depth.set(id, value)
    return value
  }

  for (const node of nodes) of(node.id)
  return depth
}

const width = (n: BoxNode) => n.measured?.width ?? FALLBACK_WIDTH
const height = (n: BoxNode) => n.measured?.height ?? FALLBACK_HEIGHT

/** Separate trees, so each can be packed against the one before it. */
function components(nodes: BoxNode[], edges: Edge[]): BoxNode[][] {
  const group = new Map<string, string>() // node -> its group's representative
  const find = (id: string): string => {
    const parent = group.get(id) ?? id
    if (parent === id) return id
    const root = find(parent)
    group.set(id, root)
    return root
  }
  for (const node of nodes) group.set(node.id, node.id)
  for (const edge of edges) {
    const a = find(edge.source)
    const b = find(edge.target)
    if (a !== b) group.set(a, b)
  }

  const byRoot = new Map<string, BoxNode[]>()
  for (const node of nodes) {
    const root = find(node.id)
    byRoot.set(root, [...(byRoot.get(root) ?? []), node])
  }
  // Left-to-right in the order they currently sit, so a reformat doesn't shuffle
  // trees the user already knows the position of.
  return [...byRoot.values()].sort(
    (a, b) => Math.min(...a.map((n) => n.position.x)) - Math.min(...b.map((n) => n.position.x)),
  )
}

/** One tree, in rows, with its left edge at x = 0 and its top at y = 0. */
function layoutTree(nodes: BoxNode[], parents: Map<string, string[]>): Placed[] {
  const depth = depths(nodes, parents)
  const rows = new Map<number, BoxNode[]>()
  for (const node of nodes) {
    const row = depth.get(node.id) ?? 0
    rows.set(row, [...(rows.get(row) ?? []), node])
  }

  const placed: Placed[] = []
  const centres = new Map<string, number>()
  let y = 0

  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const members = rows.get(row)!
    // Ordered by where their parents sit, which keeps edges from crossing;
    // roots keep their current left-to-right order instead.
    const sortKey = (n: BoxNode) => {
      const above = (parents.get(n.id) ?? []).map((p) => centres.get(p)).filter((c) => c !== undefined)
      return above.length > 0 ? above.reduce((a, b) => a + b, 0) / above.length : n.position.x
    }
    members.sort((a, b) => sortKey(a) - sortKey(b))

    let x = 0 // packed from the left, not centred: the canvas fills from the corner
    for (const node of members) {
      placed.push({ id: node.id, x, y })
      centres.set(node.id, x + width(node) / 2)
      x += width(node) + COLUMN_GAP
    }
    y += Math.max(...members.map(height)) + ROW_GAP
  }
  return placed
}

export function tidyPositions(nodes: BoxNode[], edges: Edge[]): Placed[] {
  if (nodes.length === 0) return []

  const parents = new Map<string, string[]>()
  for (const edge of edges) {
    parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source])
  }

  // Each tree laid out on its own, then packed left to right from the origin,
  // all sharing a top edge — a collage rather than a centred diagram.
  const placed: Placed[] = []
  let offsetX = 0
  for (const tree of components(nodes, edges)) {
    const local = layoutTree(tree, parents)
    const treeWidth = Math.max(
      ...local.map((p) => p.x + width(tree.find((n) => n.id === p.id)!)),
    )
    for (const p of local) placed.push({ id: p.id, x: p.x + offsetX, y: p.y })
    offsetX += treeWidth + TREE_GAP
  }
  return placed
}
