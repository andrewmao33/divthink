// The canvas as the user sees it: one card per exchange, a prompt and its
// response, each a single node on the server. This adds what the components
// need on top: the lines between cards, the quote, the layout. No React here,
// so it can be tested directly.
import type { Edge } from '@xyflow/react'
import type { ApiNode, CardLayout } from './api'
import type { NodeAttachment } from './Attachments'
import type { BoxNode, LiveReply } from './graph'

export type Exchange = {
  id: string
  node: ApiNode
  live?: LiveReply // the response's streaming state, while it is being written
  quote: string | null // the passage this prompt branched from
  layout: CardLayout | null // set once the card is moved or resized by hand
  parents: string[] // ids, oldest first; more than one is a merge
  children: string[] // ids, oldest first
  createdAt: string
}

export type Exchanges = {
  list: Exchange[] // oldest first
  byId: Map<string, Exchange>
}

const LABEL_MAX = 48

export function buildExchanges(boxes: BoxNode[], edges: Edge[]): Exchanges {
  const byId = new Map<string, Exchange>()
  for (const box of boxes) {
    const node = box.data.node
    byId.set(node.id, {
      id: node.id,
      node,
      live: box.data.live,
      quote: quoteOn(node),
      layout: layoutOn(node),
      parents: [],
      children: [],
      createdAt: node.created_at,
    })
  }
  for (const edge of edges) {
    const [parent, child] = [byId.get(edge.source), byId.get(edge.target)]
    if (!parent || !child || child.parents.includes(parent.id)) continue
    child.parents.push(parent.id)
    parent.children.push(child.id)
  }

  const oldestFirst = (a: string, b: string) => {
    const [x, y] = [byId.get(a)!, byId.get(b)!]
    return x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id)
  }
  for (const exchange of byId.values()) {
    exchange.parents.sort(oldestFirst)
    exchange.children.sort(oldestFirst)
  }

  const list = [...byId.keys()].sort(oldestFirst).map((id) => byId.get(id)!)
  return { list, byId }
}

// The store hands out the same arrays until something changes, so remembering
// the last answer is enough to share one result between every component.
let last: { boxes: BoxNode[]; edges: Edge[]; result: Exchanges } | null = null

export function exchangesOf(boxes: BoxNode[], edges: Edge[]): Exchanges {
  if (last?.boxes !== boxes || last.edges !== edges) {
    last = { boxes, edges, result: buildExchanges(boxes, edges) }
  }
  return last.result
}

// The conversation leading to a card, oldest first. It stops at a merge: above
// one there is no single line to follow, so the merge is where the story starts.
export function pathTo(byId: Map<string, Exchange>, id: string): Exchange[] {
  const path: Exchange[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parents.length === 1 ? byId.get(current.parents[0]) : undefined
  }
  return path
}

// A card and everything above it, through merges too.
export function ancestorIds(byId: Map<string, Exchange>, id: string): Set<string> {
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length > 0) {
    const current = byId.get(stack.pop()!)
    if (!current || seen.has(current.id)) continue
    seen.add(current.id)
    stack.push(...current.parents)
  }
  return seen
}

// Cards joined by any line, as groups: each is one thread on the canvas. Ordered
// by when each thread began.
export function threads(list: Exchange[]): Exchange[][] {
  const group = new Map(list.map((exchange) => [exchange.id, exchange.id]))
  const find = (id: string): string => {
    const parent = group.get(id) ?? id
    if (parent === id) return id
    const root = find(parent)
    group.set(id, root)
    return root
  }
  for (const exchange of list) {
    for (const parent of exchange.parents) {
      const [a, b] = [find(exchange.id), find(parent)]
      if (a !== b) group.set(a, b)
    }
  }
  const byRoot = new Map<string, Exchange[]>()
  for (const exchange of list) {
    const root = find(exchange.id)
    byRoot.set(root, [...(byRoot.get(root) ?? []), exchange])
  }
  return [...byRoot.values()] // `list` is oldest first, so the groups already are
}

// Which thread each card is in, counted from 1 in the order threads began.
export function threadNumbers(list: Exchange[]): Map<string, number> {
  const numbers = new Map<string, number>()
  threads(list).forEach((thread, index) => {
    for (const exchange of thread) numbers.set(exchange.id, index + 1)
  })
  return numbers
}

// Cards nothing continues from yet, newest first: the places to keep going.
export function leavesOf(list: Exchange[]): Exchange[] {
  return list.filter((exchange) => exchange.children.length === 0).reverse()
}

// A card's name wherever there is only room for a line: its prompt, shortened.
export function labelOf(exchange: Exchange): string {
  const text = exchange.node.prompt.trim()
  const oneLine = text.split(/\s+/).join(' ')
  if (!oneLine) return 'Untitled'
  return oneLine.length > LABEL_MAX ? oneLine.slice(0, LABEL_MAX - 1).trimEnd() + '…' : oneLine
}

// The files sent with a prompt, as descriptors. Their bytes are fetched
// separately so the graph payload stays small.
export function attachmentsOf(node: ApiNode | null): NodeAttachment[] {
  const raw = node?.metadata.attachments
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).filter(
    (f): f is NodeAttachment =>
      typeof f === 'object' && f !== null && typeof (f as NodeAttachment).id === 'string',
  )
}

function layoutOn(node: ApiNode): CardLayout | null {
  const raw = node.metadata.layout
  if (typeof raw !== 'object' || raw === null) return null
  const layout: CardLayout = {}
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'number' && Number.isFinite(value)) layout[key] = value
  }
  return Object.keys(layout).length > 0 ? layout : null
}

function quoteOn(node: ApiNode): string | null {
  const highlight = node.metadata.highlight
  if (typeof highlight !== 'object' || highlight === null) return null
  const text = (highlight as { text?: unknown }).text
  return typeof text === 'string' && text.trim() ? text.trim() : null
}
