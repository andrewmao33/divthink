import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import styles from './Composer.module.css'
import { isEditing } from './dom'
import type { Exchange } from './exchanges'
import { ALLOWED_TYPES, useCanvasStore } from './store'

const MAX_INPUT_HEIGHT = 200 // px; taller prompts scroll inside the box

type Props = {
  // The card the prompt will continue from; without one it starts a new thread.
  active: Exchange | undefined
  // The cards picked to merge, when a merge is being drafted: the prompt is
  // then asked across all of them instead.
  merging: Exchange[] | null
}

// Where prompts are written, at the foot of the panel.
function Composer({ active, merging }: Props) {
  const {
    demo,
    highlight,
    images,
    sending,
    notice,
    pendingDelete,
    models,
    model,
    sendPrompt,
    clearHighlight,
    clearMerge,
    confirmDelete,
    cancelDelete,
    setModel,
    openKeys,
    addImages,
    removeImage,
  } = useCanvasStore(
    useShallow((s) => ({
      demo: s.demo,
      highlight: s.highlight,
      images: s.images,
      sending: s.sending,
      notice: s.notice,
      pendingDelete: s.pendingDelete,
      models: s.models,
      model: s.model,
      sendPrompt: s.sendPrompt,
      clearHighlight: s.clearHighlight,
      clearMerge: s.clearMerge,
      confirmDelete: s.confirmDelete,
      cancelDelete: s.cancelDelete,
      setModel: s.setModel,
      openKeys: s.openKeys,
      addImages: s.addImages,
      removeImage: s.removeImage,
    })),
  )
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Signed in but no API key saved yet: nothing can be sent.
  const needsKey = models.length > 0 && !models.some((m) => m.available)
  const blocked = merging ? whyMergeBlocked(merging) : whyBlocked(active)
  const branching = !merging && active !== undefined && active.children.length > 0

  // Grow with the text, up to MAX_INPUT_HEIGHT.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [text])

  // Branching from a highlight, or starting a new thread: jump straight to
  // typing. Not for an empty demo on arrival: focusing it would scroll the
  // landing page down to it before the visitor has read a word.
  const arrived = useRef(false)
  useEffect(() => {
    const first = !arrived.current
    arrived.current = true
    if (demo && first) return
    if (highlight || !active || merging) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, active, merging !== null])

  // Typing while the canvas has focus (e.g. right after clicking a card) goes
  // into the composer. Not in the demo, which shares its page with other things.
  useEffect(() => {
    if (demo) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return
      if (!isEditing(document.activeElement)) inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [demo])

  async function submit() {
    const prompt = text.trim()
    if (!prompt || sending || blocked || needsKey) return
    // Keep the text if sending fails, so nothing typed is lost.
    if (await sendPrompt(prompt)) setText('')
  }

  // Screenshots arrive either pasted or dropped; both end up here.
  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files)
    if (files.length > 0) {
      e.preventDefault()
      void addImages(files)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) void addImages(files)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line. Ignore Enter while an IME is composing.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      // Escape backs out one thing at a time: a pending delete, the quote, the merge.
      if (pendingDelete) cancelDelete()
      else if (highlight) clearHighlight()
      else if (merging) clearMerge()
    }
  }

  return (
    <form
      className={`${styles.composer} ${dragging ? styles.dropping : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {notice && <p className={styles.error}>{notice}</p>}

      {pendingDelete ? (
        <div className={styles.status}>
          <span className={styles.statusText}>Delete “{pendingDelete.label}”?</span>
          <button type="button" className={styles.danger} onClick={() => void confirmDelete()}>
            Delete
          </button>
          <button type="button" className={styles.textButton} onClick={cancelDelete}>
            Cancel
          </button>
        </div>
      ) : needsKey ? (
        <div className={styles.status}>
          <span className={styles.statusText}>Add your API key to start.</span>
          <button type="button" className={styles.textButton} onClick={openKeys}>
            Add key
          </button>
        </div>
      ) : blocked ? (
        <p className={styles.hint}>{blocked}</p>
      ) : (
        branching && !highlight && <p className={styles.hint}>↳ Replying here starts a new branch</p>
      )}

      {images.length > 0 && (
        <div className={styles.thumbs}>
          {images.map((image) => (
            <div key={image.id} className={image.preview ? styles.thumb : styles.fileChip}>
              {image.preview ? (
                <img src={image.preview} alt={image.name} />
              ) : (
                <span className={styles.fileName} title={image.name}>
                  {image.name}
                </span>
              )}
              <button
                type="button"
                className={styles.thumbRemove}
                onClick={() => removeImage(image.id)}
                aria-label={`Remove ${image.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {highlight && (
        <div className={styles.quote}>
          <p className={styles.quoteText}>{highlight.text}</p>
          <button type="button" className={styles.clear} onClick={clearHighlight} aria-label="Remove quote">
            ×
          </button>
        </div>
      )}

      <textarea
        ref={inputRef}
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={1}
        placeholder={
          merging
            ? 'Ask across these…'
            : highlight
              ? 'Ask about the quote…'
              : active
                ? 'Ask a follow-up…'
                : 'What should we work through?'
        }
        aria-label="Prompt"
        autoFocus={!demo}
      />

      <div className={styles.row}>
        <input
          ref={fileRef}
          type="file"
          className={styles.fileInput}
          accept={ALLOWED_TYPES.join(',')}
          multiple
          onChange={(e) => {
            void addImages(Array.from(e.target.files ?? []))
            e.target.value = '' // lets the same file be picked again
          }}
        />
        <button
          type="button"
          className={styles.attach}
          onClick={() => fileRef.current?.click()}
          title="Attach images or PDFs"
          aria-label="Attach images or PDFs"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9.5 4 5 8.5a2.1 2.1 0 0 0 3 3l4.5-4.5a3.5 3.5 0 0 0-5-5L3 6.5a5 5 0 0 0 7 7L13.5 10" />
          </svg>
        </button>
        {model && models.length > 0 && (
          <select
            className={styles.model}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.available ? m.label : `${m.label} (no API key)`}
              </option>
            ))}
          </select>
        )}
        {merging ? (
          <>
            <button type="button" className={styles.textButton} onClick={clearMerge}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.mergeSend}
              disabled={sending || !text.trim() || blocked !== null || needsKey}
            >
              Merge and send
            </button>
          </>
        ) : (
          <button
            type="submit"
            className={styles.send}
            disabled={sending || !text.trim() || blocked !== null || needsKey}
            aria-label="Send"
            title="Send"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 12V2M2.5 6.5 7 2l4.5 4.5" />
            </svg>
          </button>
        )}
      </div>
    </form>
  )
}

// A prompt can only continue from a reply that finished: one still being
// written, or one that failed, has no complete text to build on.
function whyBlocked(active: Exchange | undefined): string | null {
  const status = active?.reply?.status
  if (status === 'pending' || status === 'streaming') return 'Wait for this reply to finish.'
  if (status === 'error') return 'This reply failed. Pick another card to continue from.'
  return null
}

// A merge needs at least two cards, each with a finished reply to bring.
function whyMergeBlocked(sources: Exchange[]): string | null {
  if (sources.length < 2) return 'Click another card on the canvas to merge it with this one.'
  const statuses = sources.map((source) => source.reply?.status)
  if (statuses.some((s) => s === 'pending' || s === 'streaming')) {
    return 'Wait for every picked reply to finish.'
  }
  if (statuses.includes('error')) return 'One of the picked replies failed. Remove it to merge.'
  return null
}

export default Composer
