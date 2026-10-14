import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import Composer from './Composer'
import {
  exchangesOf,
  labelOf,
  leavesOf,
  pathTo,
  threadNumbers,
  type Exchange,
} from './exchanges'
import styles from './Panel.module.css'
import { DemoReply, PromptFiles, ReplyBody } from './Reply'
import { useCanvasStore } from './store'

export const PANEL_MIN = 320
// Wide enough to read a long reply comfortably; the window caps it sooner on a
// small screen, always leaving a strip of canvas to click back into.
export const PANEL_MAX = 1100
const CANVAS_MIN = 160
const NEAR_BOTTOM = 80 // px: close enough to the end to keep following new text

type Props = {
  width: number
  onResize: (width: number) => void
  collapsed: boolean
  onCollapse: (collapsed: boolean) => void
}

// The conversation, as a chat: everything from the start of the thread down to
// the active card, and the composer that continues it. The canvas shows the
// whole graph; this shows one line through it.
function Panel({ width, onResize, collapsed, onCollapse }: Props) {
  const {
    nodes,
    edges,
    activeId,
    previousActiveId,
    mergeIds,
    demoEchoes,
    readOnly,
    setActive,
    startNewThread,
    toggleMerge,
  } = useCanvasStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      activeId: s.activeId,
      previousActiveId: s.previousActiveId,
      mergeIds: s.mergeIds,
      demoEchoes: s.demoEchoes,
      readOnly: s.readOnly,
      setActive: s.setActive,
      startNewThread: s.startNewThread,
      toggleMerge: s.toggleMerge,
    })),
  )
  const { list, byId } = exchangesOf(nodes, edges)
  const [leavesOpen, setLeavesOpen] = useState(false)
  const sources = mergeIds.map((id) => byId.get(id)).filter((e) => e !== undefined)
  const merging = sources.length > 0
  const leaves = leavesOf(list)
  const active = activeId ? byId.get(activeId) : undefined
  const path = active ? pathTo(byId, active.id) : []
  const previous = previousActiveId ? byId.get(previousActiveId) : undefined
  // A merge has no single line above it, so the conversation starts there and
  // names what it brought together.
  const merged = (path[0]?.parents ?? []).map((id) => byId.get(id)).filter((e) => e !== undefined)

  const scrollRef = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)

  // Picking a card shows the end of its conversation, which is the card itself.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
    wasNearBottom.current = true
  }, [activeId, collapsed, merging])

  // The list of leaves closes on Escape, as well as on picking one.
  useEffect(() => {
    if (!leavesOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLeavesOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [leavesOpen])

  // While a reply streams in, keep its newest text in view, unless the reader
  // has scrolled up to look at something earlier.
  const streamed = active?.reply?.content.length ?? 0
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller && wasNearBottom.current) scroller.scrollTop = scroller.scrollHeight
  }, [streamed, demoEchoes.length])

  function startResize(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (move: globalThis.PointerEvent) => {
      const max = Math.min(PANEL_MAX, window.innerWidth - CANVAS_MIN)
      onResize(Math.min(max, Math.max(PANEL_MIN, startWidth + move.clientX - startX)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className={`${styles.tab} ${styles.tabClosed}`}
        onClick={() => onCollapse(false)}
        aria-label="Show the conversation"
        title="Show the conversation"
      >
        ›
      </button>
    )
  }

  return (
    <aside className={styles.panel} style={{ width }}>
      <header className={styles.header}>
        {/* Where you are. Pressing it lists everywhere else you could be. */}
        <button
          type="button"
          className={`${styles.crumbs} ${leavesOpen ? styles.crumbsOpen : ''}`}
          onClick={() => setLeavesOpen((open) => !open)}
          disabled={leaves.length === 0}
          aria-expanded={leavesOpen}
          title="Show every place you can keep going"
        >
          <span className={styles.crumbTrail}>
            {merging ? (
              <span className={styles.crumbNew}>Merge draft</span>
            ) : path.length === 0 ? (
              <span className={styles.crumbNew}>New thread</span>
            ) : (
              crumbs(path).map((crumb, i) => (
                <span key={i}>
                  {i > 0 && <span className={styles.crumbGap}>›</span>}
                  {crumb}
                </span>
              ))
            )}
          </span>
          {leaves.length > 0 && (
            <span className={styles.leafCount}>
              Leaves {leaves.length} {leavesOpen ? '▴' : '▾'}
            </span>
          )}
        </button>
        {!readOnly && (
          <button
            type="button"
            className={styles.newThread}
            onClick={() => startNewThread()}
            disabled={!active && !merging}
          >
            + New thread
          </button>
        )}
      </header>

      {leavesOpen && (
        <Leaves
          leaves={leaves}
          list={list}
          activeId={merging ? null : activeId}
          onPick={() => setLeavesOpen(false)}
        />
      )}

      <div
        ref={scrollRef}
        className={styles.conversation}
        onScroll={(e) => {
          const el = e.currentTarget
          wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
        }}
      >
        {merging ? (
          <div className={styles.draft}>
            <h2 className={styles.emptyTitle}>
              {sources.length === 1 ? 'Merge cards' : `Merge ${sources.length} cards`}
            </h2>
            <p className={styles.emptyText}>
              Each card brings the whole conversation that led to it. Click cards on the canvas to
              add or remove them.
            </p>
            {sources.map((source) => (
              <div key={source.id} className={styles.source}>
                <div className={styles.sourceText}>
                  <p className={styles.sourceTitle}>{labelOf(source)}</p>
                  <p className={styles.sourceExcerpt}>{source.reply?.content || 'No reply yet.'}</p>
                </div>
                <button
                  type="button"
                  className={styles.sourceRemove}
                  onClick={() => toggleMerge(source.id)}
                  aria-label={`Remove ${labelOf(source)} from the merge`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : !active ? (
          <div className={demoEchoes.length > 0 ? styles.echoes : styles.empty}>
            {demoEchoes.map((echo, i) => (
              <Echo key={i} text={echo} />
            ))}
            {demoEchoes.length === 0 && (
              <>
                <h2 className={styles.emptyTitle}>
                  {list.length === 0 ? 'Start a conversation' : 'Start a new thread'}
                </h2>
                <p className={styles.emptyText}>
                  {list.length === 0
                    ? 'Your first prompt becomes the first card on the canvas. Reply from any card later to branch from it.'
                    : 'It’ll appear as a new root on the canvas, next to your other threads.'}
                </p>
                {previous && (
                  <button type="button" className={styles.back} onClick={() => setActive(previous.id)}>
                    ← Back to {labelOf(previous)}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {merged.length > 1 && (
              <div className={styles.aside}>
                <p className={styles.asideLabel}>Merged from {merged.length} cards</p>
                <div className={styles.jumps}>
                  {merged.map((source) => (
                    <JumpButton key={source.id} to={source} />
                  ))}
                </div>
              </div>
            )}
            {path.map((exchange) => (
              <Turn key={exchange.id} exchange={exchange} />
            ))}
            {/* The landing page's demo: what was typed, and why nothing answers. */}
            {demoEchoes.map((echo, i) => (
              <Echo key={i} text={echo} />
            ))}
            {active.children.length > 0 && demoEchoes.length === 0 && (
              <div className={styles.aside}>
                <p className={styles.asideLabel}>
                  {active.children.length === 1
                    ? '1 reply continues from here'
                    : `${active.children.length} replies continue from here`}
                </p>
                <div className={styles.jumps}>
                  {active.children.map((id) => (
                    <JumpButton key={id} to={byId.get(id)!} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {readOnly ? (
        <p className={styles.readOnly}>
          A canvas you can read, pan and zoom. <a href="/">Sign in</a> to make your own.
        </p>
      ) : (
        <Composer active={active} merging={merging ? sources : null} />
      )}

      <div
        className={styles.resize}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the conversation"
      />
      <button
        type="button"
        className={styles.tab}
        onClick={() => onCollapse(true)}
        aria-label="Hide the conversation"
        title="Hide the conversation"
      >
        ‹
      </button>
    </aside>
  )
}

// One prompt and its reply. The reply is the same node the card draws, so text
// streams into both at once.
function Turn({ exchange }: { exchange: Exchange }) {
  const { prompt, reply, live, quote } = exchange
  return (
    <>
      {prompt && (
        <div className={styles.prompt}>
          {quote && <blockquote className={styles.quote}>{quote}</blockquote>}
          <PromptFiles node={prompt} />
          <p className={styles.promptText}>{prompt.content}</p>
        </div>
      )}
      {reply && (
        // data-reply-id marks finished replies the Branch menu can act on.
        <div className={styles.reply} data-reply-id={reply.status === 'complete' ? reply.id : undefined}>
          <ReplyBody node={reply} live={live} />
        </div>
      )}
    </>
  )
}

// Every card nothing continues from yet, newest first: where you can keep going.
function Leaves({
  leaves,
  list,
  activeId,
  onPick,
}: {
  leaves: Exchange[]
  list: Exchange[]
  activeId: string | null
  onPick: () => void
}) {
  const setActive = useCanvasStore((s) => s.setActive)
  const threadOf = threadNumbers(list)
  return (
    <div className={styles.leaves}>
      <p className={styles.leavesLabel}>Leaves · most recent first</p>
      <ul className={styles.leafList}>
        {leaves.map((leaf) => (
          <li key={leaf.id}>
            <button
              type="button"
              className={`${styles.leafRow} ${leaf.id === activeId ? styles.leafCurrent : ''}`}
              onClick={() => {
                setActive(leaf.id, true)
                onPick()
              }}
            >
              <span className={styles.leafTitle}>{labelOf(leaf)}</span>
              <span className={styles.leafMeta}>
                thread {threadOf.get(leaf.id)} · {ago(leaf.createdAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// "3 min ago", from when a card was made.
function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

// A prompt typed into the demo, with the demo's one answer.
function Echo({ text }: { text: string }) {
  return (
    <>
      <div className={styles.prompt}>
        <p className={styles.promptText}>{text}</p>
      </div>
      <div className={styles.reply}>
        <DemoReply />
      </div>
    </>
  )
}

// Moves to another card, and brings the canvas along, since it may be off screen.
function JumpButton({ to }: { to: Exchange }) {
  const setActive = useCanvasStore((s) => s.setActive)
  return (
    <button type="button" className={styles.jump} onClick={() => setActive(to.id, true)}>
      {labelOf(to)} →
    </button>
  )
}

// The path as short names. A long one keeps its start and its last two steps.
function crumbs(path: Exchange[]): string[] {
  const names = path.map(labelOf)
  return names.length <= 3 ? names : [names[0], '…', ...names.slice(-2)]
}

export default Panel
