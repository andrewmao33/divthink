import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import styles from './Card.module.css'
import { AttachmentThumbs } from './Attachments'
import { attachmentsOf, type Exchange } from './exchanges'
import { CARD_MIN_HEIGHT, CARD_MIN_WIDTH } from './layout'
import { ReplyBody } from './Reply'
import { useCanvasStore } from './store'

// How a card stands relative to the active one: it is the active card, it is on
// the way to it, or it is neither and steps back.
export type CardState = 'active' | 'path' | 'rest'

export type CardData = {
  exchange: Exchange
  state: CardState
  picked: boolean // chosen for the merge being drafted
  sized: boolean // has a height of its own, so the reply fills it
  thread: number | null // set on the first card of a thread, which carries its label
}
export type CardNode = Node<CardData, 'card'>

// One exchange on the canvas: the prompt, then the reply, both in full. Clicking
// a card makes it the active one (Canvas.tsx); it can be dragged by its prompt
// and resized from its edges. Everything else happens in the panel.
function Card({ id, data }: NodeProps<CardNode>) {
  const { exchange, state, picked, sized, thread } = data
  const { node, live, quote } = exchange
  const placeCard = useCanvasStore((s) => s.placeCard)
  const files = attachmentsOf(node)
  const sessionId = useCanvasStore((s) => s.session?.id)
  // The id stands in for a model no longer on the list.
  const modelName = useCanvasStore((s) => s.models.find((m) => m.id === node.model)?.label) ?? node.model
  const finished = node.status === 'complete'
  const className = [styles.card, styles[state], picked && styles.picked, sized && styles.sized]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {/* The edges and corners of the active card resize it. Drawn by
          Canvas.module.css as wide invisible strips, so there is something to
          catch without a frame of handles around the card. */}
      <NodeResizer
        isVisible={state === 'active'}
        minWidth={CARD_MIN_WIDTH}
        minHeight={CARD_MIN_HEIGHT}
        onResizeEnd={(_event, { x, y, width, height }) => placeCard(id, { x, y, width, height })}
      />
      {thread !== null && <p className={styles.thread}>thread {thread}</p>}
      <div className={className}>
        {/* Lines attach to handles. Hidden and not connectable: lines only come
            from sending prompts, never from dragging. */}
        <Handle type="target" position={Position.Top} isConnectable={false} className={styles.handle} />
        <div className={styles.prompt}>
          {quote && <p className={styles.quote}>on “{quote}”</p>}
          {exchange.children.length === 0 && <span className={styles.leaf}>leaf</span>}
          <p className={styles.promptText}>
            <span className={styles.you}>You: </span>
            {node.prompt}
          </p>
          {files.length > 0 && sessionId && <AttachmentThumbs sessionId={sessionId} files={files} />}
        </div>
        {modelName && <p className={styles.model}>{modelName}</p>}
        {/* Selectable, so a passage can be highlighted and branched from. nodrag
            and nopan: dragging across the text selects it instead of moving the
            card or the canvas. nowheel is React Flow's opt-out from panning on
            scroll; only the active card gets it, so a swipe anywhere else still
            moves the canvas. */}
        <div
          className={`${styles.reply} nodrag nopan ${state === 'active' ? 'nowheel' : ''}`}
          data-reply-id={finished ? node.id : undefined}
        >
          <ReplyBody node={node} live={live} />
        </div>
        <Handle type="source" position={Position.Bottom} isConnectable={false} className={styles.handle} />
      </div>
    </>
  )
}

export default Card
