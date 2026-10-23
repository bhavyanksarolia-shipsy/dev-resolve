"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// A ticket/comment often has a literal HTML table pasted in from Outlook/Word/DevRev's own rich-text editor, not
// markdown — without parsing raw HTML it shows as escaped tag soup (<table>...</table> as plain text). Parsing it
// (rehypeRaw) and then sanitizing the result (rehypeSanitize) renders that structure instead, while still refusing
// anything a customer email could use to run script in an agent's browser (script/style tags, event handlers,
// javascript: links, iframes, forms — none of those are in rehype-sanitize's default allowed list). table/tr/td/th
// and most useful attributes (including dir) are already in that default list; colgroup/col aren't, since they're
// rarer outside pasted HTML tables specifically.
const schema = { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), "colgroup", "col"] };

/**
 * Renders RCA / comment / chat markdown readably (headings, GFM tables, lists, code). Raw HTML in the source is
 * parsed and sanitized (not rendered verbatim) — a customer email still can't inject a script, style, iframe, event
 * handler or javascript: link; it just gets to use plain structural tags like the table one above.
 */
export function Markdown({ children, compact, className = "" }: { children: string | null | undefined; compact?: boolean; className?: string }) {
  if (!children?.trim()) return null;
  return (
    <div className={`md ${compact ? "compact" : ""} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
        }}
      >
        {children.replace(/\r\n/g, "\n")}
      </ReactMarkdown>
    </div>
  );
}
