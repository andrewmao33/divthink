import {
  BaseEdge,
  getBezierPath,
  Position,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
  type Node,
} from '@xyflow/react'

// A line that attaches to whichever sides of the two boxes face each other, rather
// than always leaving the bottom and entering the top. Branches sit beside their
// reply, and boxes here are very tall, so fixed handles left lines running the
// wrong way around the box.

type Point = { x: number; y: number }

function sizeOf(node: InternalNode<Node>) {
  return { width: node.measured.width ?? 0, height: node.measured.height ?? 0 }
}

function centerOf(node: InternalNode<Node>): Point {
  const { width, height } = sizeOf(node)
  return {
    x: node.internals.positionAbsolute.x + width / 2,
    y: node.internals.positionAbsolute.y + height / 2,
  }
}

// Where the line from `towards` meets `node`'s border. Scales the direction vector
// so it lands on whichever edge it crosses first, which is the rectangle's border.
function borderPoint(node: InternalNode<Node>, towards: InternalNode<Node>): Point {
  const { width, height } = sizeOf(node)
  const from = centerOf(node)
  const to = centerOf(towards)
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return from

  const halfWidth = width / 2
  const halfHeight = height / 2
  // How far along the direction vector the border is, horizontally and vertically.
  const scaleX = dx === 0 ? Infinity : halfWidth / Math.abs(dx)
  const scaleY = dy === 0 ? Infinity : halfHeight / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return { x: from.x + dx * scale, y: from.y + dy * scale }
}

// Which side of the box that point sits on, so the curve leaves at a sensible angle.
function sideOf(node: InternalNode<Node>, point: Point): Position {
  const { width } = sizeOf(node) // height isn't needed: Bottom is the fallback
  const { x, y } = node.internals.positionAbsolute
  const edge = 1 // rounding tolerance
  if (point.x <= x + edge) return Position.Left
  if (point.x >= x + width - edge) return Position.Right
  if (point.y <= y + edge) return Position.Top
  return Position.Bottom
}

function FloatingEdge({ id, source, target, markerEnd, style }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  // Until both boxes have been measured there's nothing sensible to draw.
  if (!sourceNode || !targetNode) return null

  const sourcePoint = borderPoint(sourceNode, targetNode)
  const targetPoint = borderPoint(targetNode, sourceNode)

  const [path] = getBezierPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    sourcePosition: sideOf(sourceNode, sourcePoint),
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition: sideOf(targetNode, targetPoint),
  })

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
}

export default FloatingEdge
