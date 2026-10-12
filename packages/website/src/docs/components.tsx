import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Info, Lightbulb } from "lucide-react";

import { MEDIA, media as mediaAt, type Media } from "@/content/media";

const knownMedia = (src: string): Media | undefined => {
  try {
    return mediaAt(src, "");
  } catch {
    return undefined;
  }
};
import { cn } from "@/lib/utils";

/** A screenshot with a caption: `<Figure media="criticalSurface" caption="…" />` or with src, width and height. */
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
  // A src under /media gets its size from media-sizes.json; an image that
  // is not there still shows, without a reserved size (links.test.ts
  // reports it).
  const m: Media | undefined = media
    ? MEDIA[media]
    : src
      ? width && height
        ? { src, alt: alt ?? "", width, height }
        : (knownMedia(src) ?? { src, alt: alt ?? "", width: 0, height: 0 })
      : undefined;
  if (!m) throw new Error("Figure needs media or src");
  return (
    <figure className="not-prose my-8 overflow-hidden rounded-lg border bg-card">
      <img
        src={m.src}
        alt={alt ?? m.alt}
        width={m.width || undefined}
        height={m.height || undefined}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full"
      />
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

/** Wide tables scroll sideways inside the article; the keyboard can scroll them too. */
export function Table(props: ComponentProps<"table">) {
  return (
    <div className="not-prose relative my-6 overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="Table">
      <table {...props} className="w-full text-left text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-surface [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium" />
    </div>
  );
}
