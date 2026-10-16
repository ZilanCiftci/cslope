import { Link } from "react-router";
import { Apple, Download as DownloadIcon, Monitor, Terminal } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Section, SectionHeading } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { LATEST, OFFERED_VERSION, WINDOWS_INSTALLER } from "@/content/release";
import { usePageMeta } from "@/lib/page-meta";
import { SITE } from "@/site";

const STEPS = [
  {
    title: "Download the installer",
    text: `Get ${WINDOWS_INSTALLER} from the latest release. Its SHA-256 checksum is in the file next to it, ${WINDOWS_INSTALLER}.sha256.`,
  },
  {
    title: "Run it",
    text: "Choose a folder and whether to install for yourself only. If Windows SmartScreen says it protected your PC, choose More info and then Run anyway: the installer is not yet code-signed.",
  },
  {
    title: "Start cSlope",
    text: "Open it from the Start menu. Help > Examples opens complete example models to explore.",
  },
];

export function Download() {
  usePageMeta("Download", `Download cSlope ${OFFERED_VERSION} for Windows: free and open source slope stability software.`);
  return (
    <>
      <PageHeader
        eyebrow="Download"
        title="Install cSlope"
        lead="Free and open source under the MIT licence. No account, no licence key, no licence server."
      />

      <Section>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="flex flex-col rounded-lg border bg-card p-6 shadow-sm md:col-span-2">
            <div className="flex items-center gap-3">
              <Monitor className="h-6 w-6 text-primary" aria-hidden="true" />
              <h2 className="text-xl font-semibold">Windows</h2>
              <span className="ml-auto rounded-full border px-2.5 py-0.5 font-mono text-xs">v{OFFERED_VERSION}</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Windows 10 or 11, 64-bit. Installer for the current user or all users.
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{WINDOWS_INSTALLER}</p>
            {!LATEST?.installer && (
              <p className="mt-4 rounded-md border bg-surface px-3 py-2 text-sm text-muted-foreground">
                The first release is on its way. Follow the releases on GitHub to be told when it is out.
              </p>
            )}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              {LATEST?.installer && (
                <Button asChild size="lg">
                  <a href={LATEST.installer}>
                    <DownloadIcon className="mr-2 h-4 w-4" />
                    Download for Windows
                  </a>
                </Button>
              )}
              <Button asChild size="lg" variant="outline">
                <a href={SITE.releases} target="_blank" rel="noopener noreferrer">
                  All versions
                </a>
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            {[
              { icon: <Apple className="h-5 w-5" />, name: "macOS" },
              { icon: <Terminal className="h-5 w-5" />, name: "Linux" },
            ].map((p) => (
              <div key={p.name} className="flex items-center gap-3 rounded-lg border bg-surface p-5 text-muted-foreground">
                {p.icon}
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="ml-auto text-sm">Coming later</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section surface>
        <SectionHeading title="Installation" />
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-lg border bg-card p-6">
              <span className="font-mono text-sm text-primary">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-sm text-muted-foreground">
          New to cSlope? Start with the{" "}
          <Link to="/docs" className="font-medium text-primary hover:underline">
            documentation
          </Link>
          . What changed in each version is in the{" "}
          <Link to="/changelog" className="font-medium text-primary hover:underline">
            changelog
          </Link>
          .
        </p>
      </Section>

      <Section>
        <SectionHeading
          title="Build from source"
          lead="The source code is on GitHub. With Bun installed, clone the repository, run bun install and bun run dev to start the application."
        />
        <Button asChild variant="outline" className="mt-6">
          <a href={SITE.github} target="_blank" rel="noopener noreferrer">
            Source code on GitHub
          </a>
        </Button>
      </Section>
    </>
  );
}
