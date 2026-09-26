import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useEffect, useState } from 'react'
import type { ApiNode } from './api'
import styles from './Box.module.css'
import type { BoxNode, LiveReply } from './graph'
import Markdown from './Markdown'

function Box({ data, selected }: NodeProps<BoxNode>) {
  const { node, live } = data
  const className = [styles.box, styles[node.type], selected && styles.selected]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className}>
      {/* Lines attach to handles. Hidden and not connectable: lines only come
          from sending prompts, never from dragging. */}
      <Handle type="target" position={Position.Top} isConnectable={false} className={styles.handle} />
      <BoxBody node={node} live={live} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={styles.handle} />
    </div>
  )
}

function BoxBody({ node, live }: { node: ApiNode; live?: LiveReply }) {
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
        <p className={styles.text}>{node.content}</p>
      </>
    )
  }
  return (
    // Reply text is selectable so it can be highlighted and branched from (nodrag:
    // pressing on the text selects it instead of dragging; drag the box by its edge).
    // data-reply-id marks finished replies the Branch menu can act on.
    <div
      className={`${styles.reply} nodrag`}
      data-reply-id={node.status === 'complete' ? node.id : undefined}
    >
      <Thought node={node} live={live} />
      <Markdown text={node.content} />
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
