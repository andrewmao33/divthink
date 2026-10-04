import { Handle, Position, useStore, type NodeProps } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import type { ApiNode } from './api'
import Attachments, { type NodeAttachment } from './Attachments'
import { useCanvasStore } from './store'
import styles from './Box.module.css'
import type { BoxNode, LiveReply } from './graph'
import Markdown from './Markdown'

// Below this zoom the body text is too small to read, so a box shows its title
// instead — the canvas becomes a map rather than a wall of unreadable grey.
const TITLE_ZOOM = 0.62

function Box({ data, selected }: NodeProps<BoxNode>) {
  const { node, live } = data
  const zoomedOut = useStore((s) => s.transform[2] < TITLE_ZOOM)
  const collapsed = zoomedOut && node.type === 'assistant' && node.status === 'complete'
  const className = [styles.box, styles[node.type], selected && styles.selected]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className}>
      {/* Lines attach to handles. Hidden and not connectable: lines only come
          from sending prompts, never from dragging. */}
      <Handle type="target" position={Position.Top} isConnectable={false} className={styles.handle} />
      {/* The body stays in the layout even when collapsed — hidden, not removed —
          so the box keeps exactly the size it has when zoomed in. The title is
          laid over it. */}
      <div className={collapsed ? styles.hiddenBody : undefined} aria-hidden={collapsed}>
        <BoxBody node={node} live={live} selected={Boolean(selected)} />
      </div>
      {collapsed && <Title node={node} />}
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={styles.handle} />
    </div>
  )
}

// `nowheel` is React Flow's own opt-out, checked inside its native wheel
// listener — the only thing that reliably stops a scroll from panning the
// canvas. It is applied only to the selected box, so a swipe anywhere else
// moves the canvas regardless of what the cursor is over.
function BoxBody({ node, live, selected }: { node: ApiNode; live?: LiveReply; selected: boolean }) {
  // On the public canvas there is nothing to branch from, so the text doesn't
  // need to be selectable — and making it a drag handle means the whole box can
  // be picked up instead of only its 16px border.
  const readOnly = useCanvasStore((s) => s.readOnly)
  const grab = readOnly ? '' : 'nodrag'
  if (node.status === 'error') {
    const reason = typeof node.metadata.error === 'string' ? node.metadata.error : 'Something went wrong.'
    return (
      <>
        <p className={styles.errorTitle}>Reply failed</p>
        <p className={styles.errorReason}>{reason}</p>
      </>
    )
  }
  if (!node.content) {
    if (live?.thinkingStartedAt != null) {
      return <Thinking startedAt={live.thinkingStartedAt} heading={live.headings.at(-1)} />
    }
    return <p className={styles.muted}>{node.status === 'pending' ? 'Waiting…' : 'Writing…'}</p>
  }
  // Prompts and quotes are shown exactly as typed; replies are markdown.
  if (node.type !== 'assistant') {
    const quote = highlightOf(node)
    return (
      <>
        {quote && <blockquote className={styles.quote}>{quote}</blockquote>}
        <PromptImages node={node} />
        <div className={`${styles.scroller} ${grab} ${selected && !readOnly ? 'nowheel' : ''}`}>
          <p className={styles.text}>{node.content}</p>
        </div>
      </>
    )
  }
  return (
    // Reply text is selectable so it can be highlighted and branched from (nodrag:
    // pressing on the text selects it instead of dragging; drag the box by its edge).
    // data-reply-id marks finished replies the Branch menu can act on.
    <div
      className={`${styles.reply} ${styles.scroller} ${grab} ${selected && !readOnly ? 'nowheel' : ''}`}
      data-reply-id={node.status === 'complete' ? node.id : undefined}
    >
      <Thought node={node} live={live} />
      <Markdown text={node.content} />
      <Tokens node={node} />
    </div>
  )
}

// While thinking: the latest heading (or just "Thinking") and a running timer.
function Thinking({ startedAt, heading }: { startedAt: number; heading?: string }) {
  const seconds = useSecondsSince(startedAt)
  return (
    <p className={styles.thinking}>
      <span>{heading ?? 'Thinking'}…</span>
      <span className={styles.timer}>{seconds}s</span>
    </p>
  )
}

// After thinking: "Thought for Ns", expandable to the headings when there are any.
function Thought({ node, live }: { node: ApiNode; live?: LiveReply }) {
  const seconds = live ? live.thinkingSeconds : asNumber(node.metadata.thinking_seconds)
  const headings = live ? live.headings : asStrings(node.metadata.thought_headings)
  if (seconds == null) return null

  const label = `Thought for ${Math.max(1, Math.round(seconds))}s`
  if (headings.length === 0) {
    return <p className={styles.thought}>{label}</p>
  }
  return (
    // nodrag: clicking to expand shouldn't start dragging the box.
    <details className={`${styles.thought} nodrag`}>
      <summary>{label}</summary>
      <ul>
        {headings.map((heading, i) => (
          <li key={i}>{heading}</li>
        ))}
      </ul>
    </details>
  )
}

function useSecondsSince(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.floor((now - startedAt) / 1000))
}

// What the reply cost. Recorded from the provider's own usage report, so it is
// exact rather than an estimate.
function Tokens({ node }: { node: ApiNode }) {
  const usage = node.metadata.usage
  if (typeof usage !== 'object' || usage === null) return null
  const { input_tokens: input, output_tokens: output, cache_read_tokens: cached } =
    usage as { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number }
  if (!input && !output) return null
  return (
    <p className={styles.tokens}>
      {compact(input ?? 0)} in · {compact(output ?? 0)} out
      {cached ? ` · ${compact(cached)} cached` : ''}
    </p>
  )
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
}

// The box's name when the canvas is zoomed out. Written by the model when the
// reply finished; double-click to replace it with your own.
function Title({ node }: { node: ApiNode }) {
  const renameNode = useCanvasStore((s) => s.renameNode)
  const saved = typeof node.metadata.title === 'string' ? node.metadata.title : ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(saved)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    setEditing(false)
    if (draft.trim() !== saved) renameNode(node.id, draft.trim())
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${styles.titleInput} nodrag`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(saved)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <p
      className={`${styles.title} nodrag`}
      onDoubleClick={() => {
        setDraft(saved)
        setEditing(true)
      }}
      title="Double-click to rename"
    >
      {saved || <span className={styles.muted}>Untitled</span>}
    </p>
  )
}

// Files sent with this prompt. Their descriptors live on the node; the bytes are
// fetched separately so the graph payload stays small.
function PromptImages({ node }: { node: ApiNode }) {
  const sessionId = useCanvasStore((s) => s.session?.id)
  const raw = node.metadata.attachments
  const files: NodeAttachment[] = Array.isArray(raw)
    ? (raw as unknown[]).filter(
        (f): f is NodeAttachment =>
          typeof f === 'object' && f !== null && typeof (f as NodeAttachment).id === 'string',
      )
    : []
  if (!sessionId || files.length === 0) return null
  return <Attachments sessionId={sessionId} files={files} />
}

// The passage this prompt branched from. It's kept on the prompt itself; on older
// canvases the quote is a box of its own, which renders as a plain 'highlight' node.
function highlightOf(node: ApiNode): string | null {
  const highlight = node.metadata.highlight
  if (typeof highlight !== 'object' || highlight === null) return null
  const text = (highlight as { text?: unknown }).text
  return typeof text === 'string' && text.trim() ? text : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export default Box
