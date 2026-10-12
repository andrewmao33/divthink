// The canvas on the landing page: a fixed example, built here rather than
// loaded, so the page needs no server to show it. Two threads about one
// question, with a branch taken from a quoted passage and a merge that brings
// two lines of thought back together. Edit the text freely; the shape comes
// from each card's `from`.
import type { ApiEdge, ApiNode } from './api'

type DemoCard = {
  key: string
  from: string[] // the cards this one continues from; none starts a thread
  quote?: string // a passage highlighted in the card above, for a branch
  prompt: string
  reply: string
}

const CARDS: DemoCard[] = [
  {
    key: 'where',
    from: [],
    prompt: 'My API is getting slow under load. Where should I add caching?',
    reply: `Three places, from the outside in:

- **At the edge (a CDN).** The request never reaches your servers.
- **In the application (Redis).** Your code reuses the results of expensive work.
- **In the database.** Query caches and materialized views.

The further out you cache, the more work you skip, and the harder it is to keep fresh.`,
  },
  {
    key: 'redis',
    from: ['where'],
    prompt: 'Go deeper on the application cache. How would I use Redis?',
    reply: `The usual pattern is **cache-aside**:

1. Look for the result in Redis.
2. On a miss, read it from the database.
3. Write it to Redis with an expiry, then return it.

Give every key a TTL, so a missed invalidation can't serve stale data forever.`,
  },
  {
    key: 'cdn',
    from: ['where'],
    quote: 'The request never reaches your servers.',
    prompt: 'What can a CDN cache for an API? Most of my responses are per-user.',
    reply: `More than people expect:

- **Public GET responses**: lists, search results, configuration.
- **Per-user responses**, if the cache key varies on the auth token.
- **Slightly stale data**, with \`stale-while-revalidate\`.

Writes should pass straight through.`,
  },
  {
    key: 'invalidate',
    from: ['redis'],
    prompt: 'How do I stop the cache serving stale data after a write?',
    reply: `Three options, in order of effort:

- **Let it expire.** A short TTL and nothing else.
- **Delete on write.** When a row changes, delete its keys.
- **Publish change events**, so no write path can forget.

Start with delete-on-write, with a TTL as the safety net.`,
  },
  {
    key: 'plan',
    from: ['invalidate', 'cdn'],
    prompt: 'Given both of these, what should I build first?',
    reply: `**The CDN first.** It is configuration, not code: add \`Cache-Control\` headers to your public GET endpoints.

**Redis second**, for the per-user endpoints the CDN can't help with.

The branches disagree on one point: the CDN tolerates stale data by design, while Redis works to prevent it. Decide per endpoint how stale is acceptable.`,
  },
  {
    key: 'measure',
    from: [],
    prompt: 'How do I find out which endpoints are actually slow?',
    reply: `Measure before changing anything:

- **p95 latency per endpoint**, not the average.
- **Requests per endpoint.** Slightly slow and called constantly beats very slow and rare.
- **Tracing**, to see where the time goes.

Sort by latency multiplied by volume.`,
  },
  {
    key: 'after',
    from: ['measure'],
    prompt: 'What should I watch to know the cache is working?',
    reply: `Three numbers:

- **Hit rate.** Under about 80% on a hot endpoint, the keys or the TTL are wrong.
- **p95 latency** on what you cached. It should drop sharply.
- **Database load.** Fewer queries per second is the goal.`,
  },
]

export const DEMO_TITLE = 'Where to add caching'
// The card the demo opens on: the merge, so the lit path shows both branches.
export const DEMO_ACTIVE = 'demo-plan-prompt'

const GAP_MS = 4 * 60_000

export function demoGraph(): { nodes: ApiNode[]; edges: ApiEdge[] } {
  const nodes: ApiNode[] = []
  const edges: ApiEdge[] = []
  // Made a little while ago, whenever the page is opened: the cards have to be
  // older than anything a visitor adds, and "30 min ago" reads better than a date.
  const start = Date.now() - (CARDS.length + 1) * GAP_MS
  CARDS.forEach((card, index) => {
    const [promptId, replyId] = [`demo-${card.key}-prompt`, `demo-${card.key}-reply`]
    // A few minutes apart, in order: cards are sorted by when they were made.
    const createdAt = new Date(start + index * GAP_MS).toISOString()
    const node = { model: null, position_x: 0, position_y: 0, status: 'complete' as const, created_at: createdAt }
    nodes.push({
      ...node,
      id: promptId,
      type: 'user',
      content: card.prompt,
      metadata: card.quote
        ? { highlight: { source_node_id: `demo-${card.from[0]}-reply`, text: card.quote } }
        : {},
    })
    nodes.push({ ...node, id: replyId, type: 'assistant', content: card.reply, metadata: {} })
    for (const parent of card.from) {
      edges.push({
        id: `demo-${parent}>${card.key}`,
        parent_id: `demo-${parent}-reply`,
        child_id: promptId,
      })
    }
    edges.push({ id: `demo-${card.key}`, parent_id: promptId, child_id: replyId })
  })
  return { nodes, edges }
}
