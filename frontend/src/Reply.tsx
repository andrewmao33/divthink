import { useEffect, useState } from 'react'
import type { ApiNode } from './api'
import Attachments from './Attachments'
import { attachmentsOf } from './exchanges'
import type { LiveReply } from './graph'
import Markdown from './Markdown'
import styles from './Reply.module.css'
import { useCanvasStore } from './store'
import { useGetStarted } from './useGetStarted'

// A model's reply in whatever state it is in: waiting, thinking, streaming,
// finished or failed. Drawn the same on a card and in the panel, from the same
// node, so the two can never disagree.
export function ReplyBody({ node, live }: { node: ApiNode; live?: LiveReply }) {
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
  return (
    <>
      <Thought node={node} live={live} />
      <Markdown text={node.content} />
      <Tokens node={node} />
    </>
  )
}

// What the landing page's demo answers with: why there is no real reply, and
// the way to get one.
export function DemoReply() {
  const { busy, start } = useGetStarted()
  return (
    <p className={styles.demo}>
      This is a demo, so there is no model behind it.{' '}
      <button type="button" className={styles.demoLink} onClick={start} disabled={busy}>
        Get started
      </button>{' '}
      to ask it for real.
    </p>
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
    <details className={styles.thought}>
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

export function PromptFiles({ node }: { node: ApiNode }) {
  const sessionId = useCanvasStore((s) => s.session?.id)
  const files = attachmentsOf(node)
  if (!sessionId || files.length === 0) return null
  return <Attachments sessionId={sessionId} files={files} />
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}
