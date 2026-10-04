import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import styles from './ChatBox.module.css'
import { isEditing } from './dom'
import type { BoxNode } from './graph'
import { ALLOWED_TYPES, useCanvasStore } from './store'

const MAX_INPUT_HEIGHT = 200 // px; taller prompts scroll inside the box

function ChatBox() {
  // Own selector so the filtered list is compared item by item. Building it inside
  // the object below would be a new array every time and re-render forever.
  const selected = useCanvasStore(useShallow((s) => s.nodes.filter((box) => box.selected)))
  const {
    highlight,
    images,
    sending,
    notice,
    pendingDelete,
    models,
    model,
    sendPrompt,
    clearSelection,
    clearHighlight,
    confirmDelete,
    cancelDelete,
    setModel,
    openKeys,
    addImages,
    removeImage,
  } = useCanvasStore(
    useShallow((s) => ({
      highlight: s.highlight,
      images: s.images,
      sending: s.sending,
      notice: s.notice,
      pendingDelete: s.pendingDelete,
      models: s.models,
      model: s.model,
      sendPrompt: s.sendPrompt,
      clearSelection: s.clearSelection,
      clearHighlight: s.clearHighlight,
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
  const context = describeSelection(selected, highlight !== null)
  // Signed in but no API key saved yet: nothing can be sent.
  const needsKey = models.length > 0 && !models.some((m) => m.available)

  // Grow with the text, up to MAX_INPUT_HEIGHT.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [text])

  // Branching from a highlight: jump straight to typing the follow-up.
  useEffect(() => {
    if (highlight) inputRef.current?.focus()
  }, [highlight])

  // Typing while the canvas has focus (e.g. right after clicking a box) goes into the chat box.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return
      if (!isEditing(document.activeElement)) inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function submit() {
    const prompt = text.trim()
    if (!prompt || sending || context.blocked || needsKey) return
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
      // Escape backs out one thing at a time: a pending delete, the quote, the selection.
      if (pendingDelete) cancelDelete()
      else if (highlight) clearHighlight()
      else clearSelection()
    }
  }

  return (
    <form
      className={styles.chat}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {notice && <p className={styles.error}>{notice}</p>}

      {needsKey && !pendingDelete ? (
        <div className={styles.context}>
          <span className={styles.blocked}>Add your API key to start.</span>
          <button type="button" className={styles.textButton} onClick={openKeys}>
            Add key
          </button>
        </div>
      ) : pendingDelete ? (
        <div className={styles.context}>
          <span className={styles.blocked}>
            Delete {pendingDelete.count} boxes, including everything below?
          </span>
          <button type="button" className={styles.danger} onClick={() => void confirmDelete()}>
            Delete
          </button>
          <button type="button" className={styles.textButton} onClick={cancelDelete}>
            Cancel
          </button>
        </div>
      ) : (
        context.label && (
          <div className={styles.context}>
            <span className={context.blocked ? styles.blocked : undefined}>
              {context.blocked ?? context.label}
            </span>
            <button type="button" className={styles.clear} onClick={clearSelection} aria-label="Clear selection">
              ×
            </button>
          </div>
        )
      )}

      <div
        className={`${styles.box} ${dragging ? styles.dropping : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
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
          <textarea
            ref={inputRef}
            className={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder={context.placeholder}
            aria-label="Prompt"
            autoFocus
          />
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
          <button
            type="submit"
            className={styles.send}
            disabled={sending || !text.trim() || context.blocked !== null || needsKey}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </form>
  )
}

// What the next prompt will connect to, in words.
function describeSelection(selected: BoxNode[], quoting: boolean) {
  const statuses = selected.map((box) => box.data.node.status)
  const blocked = statuses.some((s) => s === 'pending' || s === 'streaming')
    ? 'Wait for the selected reply to finish.'
    : statuses.includes('error')
      ? "Can't reply to a failed reply. Deselect it first."
      : null

  if (selected.length === 0) {
    return { label: null, blocked: null, placeholder: 'Start a new conversation…' }
  }
  if (selected.length === 1) {
    return {
      label: quoting ? 'Branching from a quote' : 'Replying to 1 box',
      blocked,
      placeholder: quoting ? 'Ask about the quote…' : 'Reply…',
    }
  }
  return {
    label: `Merging ${selected.length} boxes`,
    blocked,
    placeholder: 'Ask about these together…',
  }
}

export default ChatBox
