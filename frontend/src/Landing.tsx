import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { signInWithGoogle } from './auth'
import styles from './Landing.module.css'

const GITHUB_URL = 'https://github.com/andrewmao33/divthink'

const NODES = ['heading', 'body', 'google', 'github'] as const
type NodeId = (typeof NODES)[number]

// Same shape as a canvas: the description answers the heading, and both buttons
// hang off the description.
const EDGES: [NodeId, NodeId][] = [
  ['heading', 'body'],
  ['body', 'google'],
  ['body', 'github'],
]

const GAP = 20 // between a box and the one below it — the same everywhere
const TOP = 168 // space above the first box
const BUTTON_GAP = GAP // sideways space between the buttons, matching the gap above
const ROOM = 140 // drag room below the lowest box
const DRAG_THRESHOLD = 4 // px of movement before a press stops counting as a click

type Point = { x: number; y: number }
type Size = { w: number; h: number }
type Rect = Point & Size

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

function Landing() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<Partial<Record<NodeId, HTMLElement | null>>>({})
  const [sizes, setSizes] = useState<Partial<Record<NodeId, Size>>>({})
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const [pos, setPos] = useState<Partial<Record<NodeId, Point>>>({})
  const dragged = useRef(false)

  // Measure the stage and every box. Sizes drive both the first layout and the
  // overlap tests, so they have to be real measurements, not guesses.
  useLayoutEffect(() => {
    const measure = () => {
      const stageEl = stageRef.current
      if (!stageEl) return
      setStage({ w: stageEl.clientWidth, h: stageEl.clientHeight })
      const next: Partial<Record<NodeId, Size>> = {}
      for (const id of NODES) {
        const el = nodeRefs.current[id]
        if (el) {
          const rect = el.getBoundingClientRect()
          next[id] = { w: rect.width, h: rect.height }
        }
      }
      setSizes(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (stageRef.current) observer.observe(stageRef.current)
    for (const id of NODES) {
      const el = nodeRefs.current[id]
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  // Laid out from measured sizes, and recomputed whenever those change — web
  // fonts land after first paint and change every box's height. Stops the first
  // time a box is dragged, so a drag is never undone by a reflow.
  const [touched, setTouched] = useState(false)
  const [stageH, setStageH] = useState<number | null>(null)
  useEffect(() => {
    if (touched || stage.w === 0) return
    const { heading, body, google, github } = sizes
    if (!heading || !body || !google || !github) return
    const left = Math.max(0, (stage.w - heading.w) / 2)
    const headingY = TOP
    const bodyY = headingY + heading.h + GAP
    const buttonsY = bodyY + body.h + GAP
    setPos({
      heading: { x: left, y: headingY },
      body: { x: left, y: bodyY },
      google: { x: left, y: buttonsY },
      github: { x: left + google.w + BUTTON_GAP, y: buttonsY },
    })
    setStageH(buttonsY + Math.max(google.h, github.h) + ROOM)
  }, [sizes, stage.w, touched])

  // Live values, readable inside a drag without rebuilding the handler each
  // frame — that rebuild was most of why dragging felt sticky.
  const posRef = useRef(pos)
  const sizesRef = useRef(sizes)
  const stageRef2 = useRef(stage)
  posRef.current = pos
  sizesRef.current = sizes
  stageRef2.current = stage

  const startDrag = useCallback(
    (id: NodeId) => (event: React.PointerEvent) => {
      if (event.button !== 0) return
      const start = posRef.current[id]
      const size = sizesRef.current[id]
      if (!start || !size) return
      // Stops the browser's own link-drag on the GitHub anchor, which otherwise
      // swallows every pointermove.
      event.preventDefault()
      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)

      dragged.current = false
      setTouched(true)
      const originX = event.clientX
      const originY = event.clientY
      // Where the box actually is. A blocked move holds here rather than
      // reverting to where the drag began.
      let current: Point = start

      const blocked = (candidate: Point) => {
        const rect = { ...candidate, ...size }
        return NODES.some((other) => {
          if (other === id) return false
          const p = posRef.current[other]
          const s = sizesRef.current[other]
          return p && s ? overlaps(rect, { ...p, ...s }) : false
        })
      }

      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - originX
        const dy = move.clientY - originY
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragged.current = true

        const bounds = stageRef2.current
        const wanted = {
          x: clamp(start.x + dx, 0, bounds.w - size.w),
          y: clamp(start.y + dy, 0, bounds.h - size.h),
        }
        // Each axis on its own, so a box slides along whatever stopped it.
        if (!blocked({ x: wanted.x, y: current.y })) current = { x: wanted.x, y: current.y }
        if (!blocked({ x: current.x, y: wanted.y })) current = { x: current.x, y: wanted.y }
        setPos((all) => ({ ...all, [id]: current }))
      }

      const onUp = () => {
        target.releasePointerCapture?.(event.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [],
  )

  // A press that turned into a drag must not also count as a click.
  const swallowClickAfterDrag = (event: React.MouseEvent) => {
    if (dragged.current) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  async function signIn() {
    if (dragged.current) return
    setBusy(true)
    setError(null)
    const message = await signInWithGoogle()
    if (message) {
      setError(message)
      setBusy(false)
    }
  }

  const placed = (id: NodeId): React.CSSProperties => {
    const p = pos[id]
    // Before the first measurement the boxes lay out in normal flow, so the
    // page is readable even if the effects never run.
    return p ? { position: 'absolute', left: p.x, top: p.y } : {}
  }

  const edgeLine = ([from, to]: [NodeId, NodeId]) => {
    const a = pos[from]
    const b = pos[to]
    const sa = sizes[from]
    const sb = sizes[to]
    if (!a || !b || !sa || !sb) return null
    return {
      key: `${from}-${to}`,
      x1: a.x + sa.w / 2,
      y1: a.y + sa.h,
      x2: b.x + sb.w / 2,
      y2: b.y,
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.grid}>
          {/* Decoration only: invisible to screen readers, unclickable, behind
              the content. Five rules: the two frame edges, both edges of the
              text column, and one companion in the left gutter. */}
          <div aria-hidden="true" className={styles.rules}>
            <div className={`${styles.rule} ${styles.ruleLeft}`} />
            <div className={`${styles.rule} ${styles.ruleGutter}`} />
            <div className={`${styles.rule} ${styles.ruleTextStart}`} />
            <div className={`${styles.rule} ${styles.ruleTextEnd}`} />
            <div className={`${styles.rule} ${styles.ruleRight}`} />
          </div>

          <main className={styles.content}>
            <div
              className={styles.stage}
              ref={stageRef}
              style={stageH ? { height: stageH } : undefined}
            >
              {/* Edges are drawn from live positions, so they follow the boxes. */}
              <svg className={styles.edges} aria-hidden="true">
                {EDGES.map(edgeLine)
                  .filter((line): line is NonNullable<typeof line> => line !== null)
                  .map(({ key, ...line }) => (
                    <line key={key} {...line} stroke="currentColor" strokeWidth="1" />
                  ))}
              </svg>

              <h1
                className={`${styles.node} ${styles.headingBox}`}
                style={placed('heading')}
                ref={(el) => { nodeRefs.current.heading = el }}
                onPointerDown={startDrag('heading')}
              >
                DivThink is a canvas for conversations that branch instead of scrolling.
              </h1>

              <div
                className={`${styles.node} ${styles.bodyBox}`}
                style={placed('body')}
                ref={(el) => { nodeRefs.current.body = el }}
                onPointerDown={startDrag('body')}
              >
                <p>
                  A normal chat is a single line. Every question you don't ask is a thread you
                  lose, and every tangent buries what came before it. DivThink keeps the whole
                  shape of the conversation on one canvas, so a passing idea can become its own
                  branch without costing you the thread you were already on.
                </p>
                <p>
                  Highlight any part of a reply to branch from it. Follow several lines of
                  thinking side by side, then select two and merge them into one prompt — the
                  model receives the shared history once and each branch on its own, rather than
                  a flattened transcript.
                </p>
                <p>
                  Sign in with Google and bring your own Anthropic or Google API key. Your keys
                  are encrypted, used only to generate your replies, and never shown again.
                </p>
              </div>

              <button
                type="button"
                className={`${styles.node} ${styles.button}`}
                style={placed('google')}
                ref={(el) => { nodeRefs.current.google = el }}
                onPointerDown={startDrag('google')}
                onClick={() => void signIn()}
                disabled={busy}
              >
                {busy ? 'Redirecting…' : 'Continue with Google'}
              </button>

              <a
                className={`${styles.node} ${styles.button} ${styles.buttonOutline}`}
                style={placed('github')}
                ref={(el) => { nodeRefs.current.github = el }}
                onPointerDown={startDrag('github')}
                onClick={swallowClickAfterDrag}
                onDragStart={(e) => e.preventDefault()}
                draggable={false}
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <footer className={styles.footer}>
              <a href="/privacy.html">Privacy</a>
            </footer>
          </main>
        </div>
      </div>
    </div>
  )
}

export default Landing
