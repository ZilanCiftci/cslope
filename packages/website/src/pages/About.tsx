import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { usePageMeta } from "@/lib/page-meta";
import { SITE } from "@/site";

export function About() {
  usePageMeta("About", `cSlope is developed by ${SITE.company.name} and released as open source under the MIT licence.`);
  return (
    <>
      <PageHeader
        eyebrow="About"
        title="Who makes cSlope"
        lead={`cSlope is developed by ${SITE.company.name}, for geotechnical engineers who want an analysis tool they can inspect, verify and rely on.`}
      />
      <Section>
        <div className="grid max-w-5xl gap-12 md:grid-cols-2">
          <div className="space-y-4 leading-relaxed text-muted-foreground">
            <h2 className="text-xl font-semibold text-foreground">Why open source</h2>
            <p>
              A factor of safety is only as trustworthy as the method behind it. With cSlope, every equation, every
              search step and every verification problem is in a public repository, where anyone can read it, run it
              and check it.
            </p>
            <p>
              Open source also means the program belongs to its users: no licence server, no subscription that ends,
              and the version a project was approved with stays available.
            </p>
          </div>
          <div className="space-y-4 leading-relaxed text-muted-foreground">
            <h2 className="text-xl font-semibold text-foreground">Contact</h2>
            <p>
              Found a problem, or missing a feature?{" "}
              <a href={SITE.issues} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                Open an issue on GitHub
              </a>
              . For anything else, visit{" "}
              <a href={SITE.company.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                {SITE.company.name}
              </a>
              .
            </p>
            <h2 className="pt-4 text-xl font-semibold text-foreground">Licence</h2>
            <p>
              cSlope is released under the MIT licence: free to use, copy, modify and distribute, commercially or not,
              provided the copyright notice is kept. It comes without warranty; the engineer remains responsible for
              the analysis and its interpretation.
            </p>
          </div>
        </div>
      </Section>
    </>
  );
}
