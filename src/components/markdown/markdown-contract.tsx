"use client";

/**
 * CodePilot's neutral Markdown presentation contract.
 *
 * Both chat messages and file previews compose from this map. Keep product-
 * specific actions (copy, export, local-file navigation) in the caller's
 * overlay instead of adding them here.
 */

import type { ComponentProps, ReactNode } from "react";
import type { BundledLanguage } from "shiki";
import { CodeBlockContent } from "@/components/ai-elements/code-block";
import { cn } from "@/lib/utils";

export type MarkdownCodeProps = ComponentProps<"code"> & {
  node?: { position?: { start?: { line?: number }; end?: { line?: number } } };
};

export function markdownChildrenToText(children: ReactNode): string {
  if (children == null || children === false) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(markdownChildrenToText).join("");
  if (typeof children === "object" && "props" in children) {
    const props = (children as { props?: { children?: ReactNode } }).props;
    return markdownChildrenToText(props?.children);
  }
  return "";
}

export function markdownFenceLanguage(className?: string): string {
  return className?.match(/language-([\w+#.-]+)/i)?.[1] ?? "";
}

export function isMarkdownFenceBlock({
  node,
  className,
  text,
}: {
  node?: MarkdownCodeProps["node"];
  className?: string;
  text: string;
}): boolean {
  if (typeof className === "string" && /(^|\s)language-/.test(className)) return true;
  const start = node?.position?.start?.line;
  const end = node?.position?.end?.line;
  return typeof start === "number" && typeof end === "number"
    ? start !== end
    : text.includes("\n");
}

export function MarkdownInlineCode({ className, ...props }: ComponentProps<"code">) {
  return (
    <code
      className={cn(
        "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MarkdownCodeFence({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  return (
    <div
      className="my-4 overflow-hidden rounded-xl bg-muted/20"
      data-language={language || "text"}
      data-codepilot-markdown-code-block=""
    >
      <div className="bg-muted/30 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {language || "code"}
        </span>
      </div>
      <CodeBlockContent code={code} language={(language || "text") as BundledLanguage} />
    </div>
  );
}

function MarkdownCode({ node, className, children, ...props }: MarkdownCodeProps) {
  const text = markdownChildrenToText(children);
  if (!isMarkdownFenceBlock({ node, className, text })) {
    return (
      <MarkdownInlineCode className={className} {...props}>
        {children}
      </MarkdownInlineCode>
    );
  }
  return <MarkdownCodeFence code={text} language={markdownFenceLanguage(className)} />;
}

function MarkdownPre({ children }: ComponentProps<"pre">) {
  return <>{children}</>;
}

function MarkdownTable({ children, className, ...props }: ComponentProps<"table">) {
  return (
    <div className="my-4 overflow-hidden rounded-xl bg-muted/20">
      <div className="overflow-x-auto px-3 py-3">
        <table className={cn("w-full border-collapse text-sm", className)} {...props}>
          {children}
        </table>
      </div>
    </div>
  );
}

function MarkdownTHead(props: ComponentProps<"thead">) {
  return (
    <thead
      className="border-b border-border/60 bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium"
      {...props}
    />
  );
}

function MarkdownTBody(props: ComponentProps<"tbody">) {
  return (
    <tbody
      className="[&_tr]:border-b [&_tr]:border-border/30 [&_tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top"
      {...props}
    />
  );
}

export const MARKDOWN_LINK_CLASS_NAME = cn(
  "text-blue-600 underline decoration-blue-500/40 underline-offset-4 transition-colors",
  "hover:text-blue-700 hover:decoration-blue-600",
  "focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
  "dark:text-blue-400 dark:hover:text-blue-300 dark:hover:decoration-blue-300",
);

function MarkdownLink({
  className,
  href,
  target,
  rel,
  ...props
}: ComponentProps<"a">) {
  const external = href?.startsWith("http");
  return (
    <a
      {...props}
      href={href}
      className={cn(MARKDOWN_LINK_CLASS_NAME, className)}
      target={target ?? (external ? "_blank" : undefined)}
      rel={rel ?? (external ? "noopener noreferrer" : undefined)}
    />
  );
}

/**
 * Models should normally return structured `tool_result.media`, but older or
 * interrupted tool flows may leave a Markdown image pointing at the absolute
 * local file in CodePilot's managed media directory. Browsers cannot load that
 * filesystem path directly. Route only those managed paths through the
 * existing allowlisted media endpoint; every other URL remains untouched.
 */
export function resolveMarkdownImageSrc(
  src?: ComponentProps<"img">["src"],
): ComponentProps<"img">["src"] {
  if (typeof src !== "string" || !src) return src;

  let candidate = src;
  if (/^file:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      candidate = decodeURIComponent(parsed.pathname);
      // file:///C:/... is represented with a leading slash by URL.
      if (/^\/[a-z]:\//i.test(candidate)) candidate = candidate.slice(1);
    } catch {
      return src;
    }
  }

  const normalized = candidate.replace(/\\/g, "/");
  const absolute = normalized.startsWith("/") || /^[a-z]:\//i.test(normalized);
  const managedMediaPath = /(^|\/)\.codepilot-media(?:\/|$)/.test(normalized);
  if (!absolute || !managedMediaPath) return src;

  return `/api/media/serve?path=${encodeURIComponent(candidate)}`;
}

function MarkdownImage({ src, ...props }: ComponentProps<"img">) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Markdown sources can reference arbitrary URLs.
    <img
      {...props}
      alt={props.alt ?? ""}
      src={resolveMarkdownImageSrc(src)}
      className={cn("my-3 max-w-full rounded-lg border border-border/40", props.className)}
      loading={props.loading ?? "lazy"}
    />
  );
}

export const BASE_MARKDOWN_COMPONENTS = {
  h1: (props: ComponentProps<"h1">) => (
    <h1 className="mb-3 mt-6 text-2xl font-semibold tracking-tight" {...props} />
  ),
  h2: (props: ComponentProps<"h2">) => (
    <h2 className="mb-3 mt-5 text-xl font-semibold tracking-tight" {...props} />
  ),
  h3: (props: ComponentProps<"h3">) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold" {...props} />
  ),
  h4: (props: ComponentProps<"h4">) => (
    <h4 className="mb-2 mt-3 text-base font-semibold" {...props} />
  ),
  p: (props: ComponentProps<"p">) => <p className="my-3 leading-7" {...props} />,
  ul: (props: ComponentProps<"ul">) => (
    <ul
      className="my-3 ml-5 list-disc space-y-1.5 marker:text-muted-foreground/60"
      {...props}
    />
  ),
  ol: (props: ComponentProps<"ol">) => (
    <ol
      className="my-3 ml-5 list-decimal space-y-1.5 marker:text-muted-foreground/60"
      {...props}
    />
  ),
  li: (props: ComponentProps<"li">) => <li className="pl-1.5 leading-7" {...props} />,
  blockquote: (props: ComponentProps<"blockquote">) => (
    <blockquote
      className="my-4 border-l-4 border-border py-1 pl-4 italic text-muted-foreground"
      {...props}
    />
  ),
  hr: (props: ComponentProps<"hr">) => <hr className="my-6 border-border/50" {...props} />,
  a: MarkdownLink,
  strong: (props: ComponentProps<"strong">) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  img: MarkdownImage,
  table: MarkdownTable,
  thead: MarkdownTHead,
  tbody: MarkdownTBody,
  pre: MarkdownPre,
  code: MarkdownCode,
} as const;

export const PREVIEW_MARKDOWN_COMPONENTS = BASE_MARKDOWN_COMPONENTS;
