import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Info, Lightbulb } from "lucide-react";

import { Picture } from "@/components/Picture";
import { useFullSizeHref } from "@/lib/full-size";
import { MEDIA, media as mediaAt, type Media } from "@/content/media";
import { cn } from "@/lib/utils";

/** The width a docs figure is shown at: the article column (DocsPage). */
const FIGURE_SIZES = "(min-width: 1280px) 736px, (min-width: 1024px) calc(100vw - 320px), calc(100vw - 32px)";

/**
 * A screenshot with a caption: `<Figure media="criticalSurface" caption="…" />`
 * or `<Figure src="/media/…png" alt="…" caption="…" />`. It shows the
 * capture in the site's theme, as WebP of about the width it is shown at,
 * and opens the full-size image on click. An image under /media that is
 * not in media-sizes.json stops the build (run bun scripts/media-sizes.ts),
 * rather than showing without its size.
 */
export function Figure({
  media,
  src,
  alt,
  width,
  height,
  caption,
}: {
  media?: keyof typeof MEDIA;
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  caption?: ReactNode;
}) {
  const m: Media | undefined = media
    ? MEDIA[media]
    : src?.startsWith("/media/")
      ? mediaAt(src, alt ?? "")
      : src && width && height
        ? { src, alt: alt ?? "", width, height, srcSet: "" }
        : undefined;
  if (!m) throw new Error(`Figure needs media, an image under /media, or a src with its width and height (${src ?? "no src"})`);
  const href = useFullSizeHref(m);
  return (
    <figure className="not-prose my-8 overflow-hidden rounded-lg border bg-card">
      <a href={href} target="_blank" rel="noopener" className="block cursor-zoom-in" title="Open at full size">
        <Picture media={m} alt={alt ?? m.alt} sizes={FIGURE_SIZES} className="block h-auto w-full" />
      </a>
      {caption && <figcaption className="border-t px-4 py-3 text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

const CALLOUT = {
  note: { icon: Info, className: "border-primary/30 bg-primary/5", label: "Note" },
  tip: { icon: Lightbulb, className: "border-pass/30 bg-pass/5", label: "Tip" },
  warning: { icon: AlertTriangle, className: "border-signal/40 bg-signal/5", label: "Warning" },
} as const;

/** A highlighted note, tip or warning. */
export function Callout({ type = "note", title, children }: { type?: keyof typeof CALLOUT; title?: string; children: ReactNode }) {
  const c = CALLOUT[type];
  const Icon = c.icon;
  return (
    <div role="note" aria-label={title ?? c.label} className={cn("not-prose my-6 flex gap-3 rounded-lg border p-4 text-sm leading-relaxed", c.className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 [&_p]:mt-2 [&_p:first-child]:mt-0">
        <p className="font-semibold">{title ?? c.label}</p>
        {children}
      </div>
    </div>
  );
}

/** Numbered steps; each child `<Step title="…">` is one step. */
export function Steps({ children }: { children: ReactNode }) {
  const steps = Children.toArray(children).filter(isValidElement);
  return (
    <ol className="not-prose my-8 space-y-8 border-l pl-6">
      {steps.map((step, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[37px] flex h-6 w-6 items-center justify-center rounded-full border bg-background font-mono text-xs">
            {i + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}

export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <div className="prose prose-slate mt-2 max-w-none text-sm dark:prose-invert [&_p]:my-2">{children}</div>
    </div>
  );
}

/** A key or key combination: `<Kbd>Ctrl</Kbd>`. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[0.85em]">{children}</kbd>;
}

/** Links to pages of the site use the router; files and other sites do not. */
export function A({ href = "", children, ...rest }: ComponentProps<"a">) {
  const file = /\.[a-z0-9]+([?#].*)?$/i.test(href) || href.startsWith("/media/");
  if (href.startsWith("/") && !href.startsWith("//") && !file) {
    return (
      <Link to={href} {...rest}>
        {children}
      </Link>
    );
  }
  if (href.startsWith("#") || (href.startsWith("/") && file)) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

/** Code blocks scroll sideways; focusable so that the keyboard can scroll them. */
export function Pre(props: ComponentProps<"pre">) {
  return <pre tabIndex={0} {...props} />;
}

/** Where the repository's files are shown on GitHub. */
const REPOSITORY_FILES = "https://github.com/ZilanCiftci/cslope/blob/main/";

/**
 * A file of the repository shown whole, with its path as the caption, linked
 * to it on GitHub: the examples are tested files, included as they are rather
 * than copied into a page. In a page:
 * `import code from "../../../engine-rs/crates/cslope-py/examples/new_project.py?raw";`
 * then `<CodeFile path="packages/engine-rs/crates/cslope-py/examples/new_project.py" code={code} />`.
 */
export function CodeFile({ path, code }: { path: string; code: string }) {
  return (
    <figure className="my-6">
      <figcaption className="mb-1 font-mono text-xs text-muted-foreground">
        <a href={REPOSITORY_FILES + path} target="_blank" rel="noopener noreferrer">
          {path}
        </a>
      </figcaption>
      <pre tabIndex={0} aria-label={path} className="mt-0">
        <code>{code.trimEnd()}</code>
      </pre>
    </figure>
  );
}

/** The text of a React node (an MDX table's cells). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The header cells of an MDX table, for its name: "Table: Function, Value of f(ξ)". */
function tableName(children: ReactNode): string {
  const headers: string[] = [];
  const visit = (node: ReactNode) =>
    Children.forEach(node, (child) => {
      if (!isValidElement<{ children?: ReactNode }>(child)) return;
      if (child.type === "th") headers.push(textOf(child.props.children).trim());
      else if (child.type === "thead" || child.type === "tr") visit(child.props.children);
    });
  visit(children);
  const named = headers.filter(Boolean);
  return named.length ? `Table: ${named.join(", ")}` : "Table";
}

/**
 * Wide tables scroll sideways inside the article; the keyboard can scroll
 * them too. Each is a region named after its columns, so that the regions
 * of a page have different names.
 */
export function Table(props: ComponentProps<"table">) {
  return (
    <div className="not-prose relative my-6 overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label={tableName(props.children)}>
      <table {...props} className="w-full text-left text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-surface [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium" />
    </div>
  );
}
