// Rich GitHub-flavored markdown -> styled React for the coach output.
// Uses react-markdown + remark-gfm, sanitized, with custom components tuned
// for the dark mystical theme. Styling lives under `.prose-neville` in app.css.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { ComponentProps } from "react";

// Kept for backward-compat: a few callers may still import this. We now use a
// proper renderer, so this just returns the raw markdown (rendered as text).
export function renderMarkdown(md: string): string {
  return md;
}

export default function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`prose-neville${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ node, ...props }: ComponentProps<"a"> & { node?: unknown }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
