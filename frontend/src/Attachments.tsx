import { useEffect, useState } from 'react'
import { attachmentUrl, authHeaders, publicAttachmentUrl } from './api'
import { pdfPreview } from './pdfPreview'
import { useCanvasStore } from './store'
import styles from './Attachments.module.css'

export type NodeAttachment = { id: string; media_type: string; filename: string }

type Loaded = {
  file: string // object URL of the attachment itself
  preview: string | null // what to show: the image, or a PDF's first page
}

// Attachments sit behind the same auth as everything else, so the browser can't
// just point an <img src> at them — the request needs the session token. Each is
// fetched once per visit and kept here, so the panel and the card on the canvas
// share one download (and one drawing of a PDF's first page). Never revoked:
// an attachment never changes, and a visit only sees so many.
const loaded = new Map<string, Promise<Loaded | null>>()

function load(sessionId: string, file: NodeAttachment, readOnly: boolean): Promise<Loaded | null> {
  let entry = loaded.get(file.id)
  if (!entry) {
    entry = (async () => {
      try {
        const headers = readOnly ? {} : await authHeaders()
        const src = readOnly ? publicAttachmentUrl(sessionId, file.id) : attachmentUrl(sessionId, file.id)
        const res = await fetch(src, { headers })
        if (!res.ok) return null
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const preview = file.media_type === 'application/pdf' ? await pdfPreview(blob) : url
        return { file: url, preview }
      } catch {
        return null // a missing attachment shouldn't take the box down with it
      }
    })()
    loaded.set(file.id, entry)
    // A failure isn't kept, so it is tried again next time.
    void entry.then((result) => result === null && loaded.delete(file.id))
  }
  return entry
}

function useLoaded(sessionId: string, files: NodeAttachment[]): Record<string, Loaded> {
  const readOnly = useCanvasStore((s) => s.readOnly)
  const [done, setDone] = useState<Record<string, Loaded>>({})

  useEffect(() => {
    let cancelled = false
    for (const file of files) {
      void load(sessionId, file, readOnly).then((result) => {
        if (result && !cancelled) setDone((current) => ({ ...current, [file.id]: result }))
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, readOnly, files.map((f) => f.id).join()])

  return done
}

const isPdf = (file: NodeAttachment) => file.media_type === 'application/pdf'

// Files sent with a prompt, in the panel: images at size, a PDF as its first
// page with its name under it. A PDF opens in a new tab when clicked.
function Attachments({ sessionId, files }: { sessionId: string; files: NodeAttachment[] }) {
  const done = useLoaded(sessionId, files)
  if (files.length === 0) return null
  return (
    <div className={styles.images}>
      {files.map((file) => {
        const item = done[file.id]
        if (!isPdf(file)) {
          return item?.preview ? (
            <img key={file.id} className={styles.image} src={item.preview} alt={file.filename} />
          ) : null
        }
        const name = file.filename || 'Document.pdf'
        return (
          <a
            key={file.id}
            className={styles.pdf}
            href={item?.file}
            target="_blank"
            rel="noreferrer"
            title={`Open ${name}`}
          >
            {item?.preview ? (
              <img className={styles.page} src={item.preview} alt="" />
            ) : (
              <span className={`${styles.page} ${styles.pageBlank}`} />
            )}
            <span className={styles.pdfName}>{name}</span>
          </a>
        )
      })}
    </div>
  )
}

// The same files on a card: small, in a row under the prompt.
export function AttachmentThumbs({ sessionId, files }: { sessionId: string; files: NodeAttachment[] }) {
  const done = useLoaded(sessionId, files)
  if (files.length === 0) return null
  return (
    <div className={styles.thumbs}>
      {files.map((file) => {
        const preview = done[file.id]?.preview
        return preview ? (
          <img key={file.id} className={styles.thumb} src={preview} alt={file.filename} title={file.filename} />
        ) : (
          <span key={file.id} className={`${styles.thumb} ${styles.pageBlank}`} title={file.filename} />
        )
      })}
    </div>
  )
}

export default Attachments
