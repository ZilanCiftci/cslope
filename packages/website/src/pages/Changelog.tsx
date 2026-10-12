import changelogText from "../../../../CHANGELOG.md?raw";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { parseChangelog } from "@/content/changelog";
import { usePageMeta } from "@/lib/page-meta";

const RELEASES = parseChangelog(changelogText);

export function Changelog() {
  usePageMeta("Changelog", "What changed in each version of cSlope: new features, corrections and changes to the analysis, release by release.");
  return (
    <>
      <PageHeader eyebrow="Changelog" title="What's new" lead="Every change to cSlope, version by version." />
      <Section>
        <div className="max-w-3xl space-y-16">
          {RELEASES.map((r) => (
            <article key={r.version} aria-labelledby={`v${r.version}`}>
              <div className="flex flex-wrap items-baseline gap-3 border-b pb-3">
                <h2 id={`v${r.version}`} className="font-mono text-2xl font-medium">
                  {r.version}
                </h2>
                {r.date && <span className="text-sm text-muted-foreground">{r.date}</span>}
              </div>
              {r.summary.map((p) => (
                <p key={p} className="mt-4 text-muted-foreground">
                  {p}
                </p>
              ))}
              {r.groups.map((g, i) => (
                <section key={g.title ?? i} className="mt-6">
                  {g.title && <h3 className="font-semibold">{g.title}</h3>}
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                    {g.items.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </article>
          ))}
        </div>
      </Section>
    </>
  );
}
