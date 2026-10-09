import ReactMarkdown, { type Components } from 'react-markdown'

// Headings in mission text start below the page's own title.
const SHIFTED_HEADINGS: Components = {
  h1: ({ children }) => <h2>{children}</h2>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h5>{children}</h5>,
  h5: ({ children }) => <h6>{children}</h6>,
}

// Mission text from the API is Markdown. Raw HTML in it is dropped, never rendered,
// and react-markdown's default URL filter removes javascript: and similar links.
export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown skipHtml components={SHIFTED_HEADINGS}>
      {text}
    </ReactMarkdown>
  )
}

// Objectives and hints are single lines: inline formatting only, everything else
// (paragraphs, links, images, headings) is reduced to its text.
const INLINE_ELEMENTS = ['code', 'em', 'strong']

export function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown skipHtml allowedElements={INLINE_ELEMENTS} unwrapDisallowed>
      {text}
    </ReactMarkdown>
  )
}
