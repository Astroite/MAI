import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { codeToHtml } from "shiki";
import { useUIStore } from "../store";

function ShikiCode({ language, code }: { language: string; code: string }) {
  const dark = useUIStore((state) => state.dark);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void codeToHtml(code, {
      lang: language || "text",
      theme: dark ? "github-dark" : "github-light"
    })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language, dark]);
  if (!html) {
    return (
      <pre className="shiki-fallback overflow-x-auto rounded-md border border-border bg-surface p-3 text-sm">
        <code>{code}</code>
      </pre>
    );
  }
  return <div className="shiki-block overflow-x-auto rounded-md text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="prose-mai">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className, children, ...rest }) {
            const match = /language-([\w-]+)/.exec(className || "");
            const text = String(children ?? "").replace(/\n$/, "");
            if (match) return <ShikiCode language={match[1]} code={text} />;
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
