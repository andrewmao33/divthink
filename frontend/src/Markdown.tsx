import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './Markdown.module.css'

// GitHub-flavored markdown: tables, strikethrough, task lists, autolinks.
const remarkPlugins = [remarkGfm]

const components: Components = {
  // Links open in a new tab so the canvas stays where it is.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
}

// Renders a reply's markdown. Raw HTML in the text is not rendered (react-markdown's default).
function Markdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

// Boxes re-render often (dragging, selecting); only re-parse when the text changes.
export default memo(Markdown)
