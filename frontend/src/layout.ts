// Where every card sits. By default nobody chooses: each thread is laid out top
// to bottom by dagre, and the threads are placed side by side. A card the user
// has dragged stays where it was put. A card with no place of its own sits
// relative to the cards it continues from, so a reply to a card that was moved
// still appears beneath it, and it steps aside rather than land on another card.
import dagre from '@dagrejs/dagre'
import { threads, type Exchange } from './exchanges'

export const CARD_WIDTH = 380 // a card's width until it is resized
export const CARD_MIN_WIDTH = 260
export const CARD_MIN_HEIGHT = 140
const FALLBACK_HEIGHT = 240 // until the browser has measured a card
const COLUMN_GAP = 40 // between cards side by side
const ROW_GAP = 48 // between a card and the ones below it
const THREAD_GAP = 120 // between one thread and the next
const CLEARANCE = 16 // the least space left between two cards

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }

// `sizes` are the cards as measured on screen; `placed` are the cards that have
// a position of their own.
export function layout(
  list: Exchange[],
  sizes: Record<string, Size>,
  placed: Record<string, Point> = {},
): Map<string, Point> {
  const auto = automatic(list, sizes)
  const sizeOf = (id: string): Size => ({
    width: sizes[id]?.width ?? CARD_WIDTH,
    height: sizes[id]?.height ?? FALLBACK_HEIGHT,
  })

  // Cards placed by hand are fixed, and everything else has to fit around them.
  const final = new Map<string, Point>()
  for (const exchange of list) {
    if (placed[exchange.id]) final.set(exchange.id, placed[exchange.id])
  }

  // Oldest first, so a card's parents are always settled before it is.
  for (const exchange of list) {
    if (final.has(exchange.id)) continue
    const at = auto.get(exchange.id)!
    const size = sizeOf(exchange.id)
    const parents = exchange.parents.filter((id) => final.has(id) && auto.has(id))
    // How far each parent sits from where the layout alone would have put it.
    const shifts = parents.map((id) => ({
      x: final.get(id)!.x - auto.get(id)!.x,
      y: final.get(id)!.y - auto.get(id)!.y,
    }))
    const together = shifts.every((s) => s.x === shifts[0].x && s.y === shifts[0].y)

    let wanted: Point
    if (parents.length === 0) {
      wanted = at
    } else if (together) {
      // The parents are arranged as the layout arranged them, wherever they
      // are now: keep this card's place among them.
      wanted = { x: at.x + shifts[0].x, y: at.y + shifts[0].y }
    } else {
      // A merge whose parents were moved apart by hand: centred beneath them,
      // below the lowest.
      const centres = parents.map((id) => final.get(id)!.x + sizeOf(id).width / 2)
      const bottoms = parents.map((id) => final.get(id)!.y + sizeOf(id).height)
      wanted = {
        x: (Math.min(...centres) + Math.max(...centres)) / 2 - size.width / 2,
        y: Math.max(...bottoms) + ROW_GAP,
      }
    }
    final.set(exchange.id, freeSpot(wanted, size, final, sizeOf))
  }
  return final
}

// The nearest place to `wanted` where a card of `size` covers no other card:
// there if it is free, else one step to the right, the left, two to the right…
// and failing that the same again a row further down.
function freeSpot(
  wanted: Point,
  size: Size,
  taken: Map<string, Point>,
  sizeOf: (id: string) => Size,
): Point {
  const covers = (at: Point) => {
    for (const [id, other] of taken) {
      const otherSize = sizeOf(id)
      const apart =
        at.x + size.width + CLEARANCE <= other.x ||
        other.x + otherSize.width + CLEARANCE <= at.x ||
        at.y + size.height + CLEARANCE <= other.y ||
        other.y + otherSize.height + CLEARANCE <= at.y
      if (!apart) return true
    }
    return false
  }
  for (let row = 0; row < 6; row++) {
    for (let step = 0; step < 9; step++) {
      const columns = Math.ceil(step / 2) * (step % 2 === 1 ? 1 : -1)
      const at = {
        x: wanted.x + columns * (size.width + COLUMN_GAP),
        y: wanted.y + row * (size.height + ROW_GAP),
      }
      if (!covers(at)) return at
    }
  }
  return wanted
}

function automatic(list: Exchange[], sizes: Record<string, Size>): Map<string, Point> {
  const at = new Map<string, Point>()
  let offsetX = 0

  for (const thread of threads(list)) {
    const graph = new dagre.graphlib.Graph()
    graph.setGraph({ rankdir: 'TB', nodesep: COLUMN_GAP, ranksep: ROW_GAP })
    graph.setDefaultEdgeLabel(() => ({}))
    for (const exchange of thread) {
      graph.setNode(exchange.id, {
        width: sizes[exchange.id]?.width ?? CARD_WIDTH,
        height: sizes[exchange.id]?.height ?? FALLBACK_HEIGHT,
      })
    }
    for (const exchange of thread) {
      for (const parent of exchange.parents) graph.setEdge(parent, exchange.id)
    }
    dagre.layout(graph)

    // dagre gives centres, and centres a row on its tallest card. Cards read
    // better with their tops level, so each row is hung from the top instead.
    const rows = new Map<number, { top: number; ids: string[] }>()
    let left = Infinity
    let right = -Infinity
    for (const exchange of thread) {
      const node = graph.node(exchange.id)
      const row = Math.round(node.y)
      const top = node.y - node.height / 2
      const known = rows.get(row)
      rows.set(row, {
        top: Math.min(known?.top ?? Infinity, top),
        ids: [...(known?.ids ?? []), exchange.id],
      })
      left = Math.min(left, node.x - node.width / 2)
      right = Math.max(right, node.x + node.width / 2)
    }
    const top = Math.min(...[...rows.values()].map((row) => row.top))
    for (const row of rows.values()) {
      for (const id of row.ids) {
        const node = graph.node(id)
        at.set(id, { x: node.x - node.width / 2 - left + offsetX, y: row.top - top })
      }
    }
    offsetX += right - left + THREAD_GAP
  }
  return at
}
