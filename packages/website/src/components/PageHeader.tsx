import type { ReactNode } from "react";

/** The heading band at the top of an inner page. */
export function PageHeader({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        {eyebrow && <p className="text-sm font-semibold text-primary">{eyebrow}</p>}
        <h1 className="mt-2 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {lead && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty">{lead}</p>}
        {children}
      </div>
    </div>
  );
}
