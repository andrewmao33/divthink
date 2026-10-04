import { useEffect, useState } from 'react'
import { attachmentUrl, authHeaders, publicAttachmentUrl } from './api'
import { useCanvasStore } from './store'
import styles from './Box.module.css'

export type NodeAttachment = { id: string; media_type: string; filename: string }

// Attachments sit behind the same auth as everything else, so the browser can't
// just point an <img src> at them — the request needs the session token. Images
// are fetched once and turned into object URLs; PDFs show their name instead.
function Attachments({ sessionId, files }: { sessionId: string; files: NodeAttachment[] }) {
  const readOnly = useCanvasStore((s) => s.readOnly)
  const images = files.filter((f) => f.media_type !== 'application/pdf')
  const pdfs = files.filter((f) => f.media_type === 'application/pdf')
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const made: string[] = []

    void (async () => {
      const headers = readOnly ? {} : await authHeaders()
      for (const file of images) {
        try {
          const src = readOnly
            ? publicAttachmentUrl(sessionId, file.id)
            : attachmentUrl(sessionId, file.id)
          const res = await fetch(src, { headers })
          if (!res.ok) continue
          const url = URL.createObjectURL(await res.blob())
          made.push(url)
          if (!cancelled) setUrls((current) => ({ ...current, [file.id]: url }))
        } catch {
          // A missing attachment shouldn't take the box down with it.
        }
      }
    })()

    return () => {
      cancelled = true
      made.forEach(URL.revokeObjectURL) // object URLs are never collected on their own
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, readOnly, files.map((f) => f.id).join()])

  if (files.length === 0) return null
  return (
    <div className={styles.images}>
      {images.map((file) =>
        urls[file.id] ? (
          <img key={file.id} className={styles.image} src={urls[file.id]} alt={file.filename} />
        ) : null,
      )}
      {pdfs.map((file) => (
        <span key={file.id} className={styles.fileChip} title={file.filename}>
          {file.filename || 'Document.pdf'}
        </span>
      ))}
    </div>
  )
}

export default Attachments
