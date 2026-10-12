import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A full-width band with the site's content width inside. */
export function Section({
  id,
  className,
  surface = false,
  children,
}: {
  id?: string;
  className?: string;
  /** A tinted background, to separate neighbouring sections. */
  surface?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn("py-16 sm:py-24", surface && "border-y bg-surface", className)}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

/** An eyebrow, a heading and an optional lead paragraph. */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      {eyebrow && <p className="text-sm font-semibold text-primary">{eyebrow}</p>}
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {lead && <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">{lead}</p>}
    </div>
  );
}
