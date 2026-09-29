"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * Renders RCA / comment / chat markdown readably (headings, GFM tables, lists, code).
 * Raw HTML in the source is NOT rendered (react-markdown default) — customer emails can't inject markup.
 */
export function Markdown({ children, compact, className = "" }: { children: string | null | undefined; compact?: boolean; className?: string }) {
  if (!children?.trim()) return null;
  return (
    <div className={`md ${compact ? "compact" : ""} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
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
