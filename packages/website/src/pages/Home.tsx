import { Link } from "react-router";
import {
  Anchor,
  ArrowRight,
  BarChart3,
  Code2,
  Download,
  Droplets,
  FileText,
  Layers,
  Search,
  Spline,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/Section";
import { Screenshot } from "@/components/Screenshot";
import { MEDIA } from "@/content/media";
import { VERIFICATION, checkCounts, homeExamples } from "@/content/verification";
import { usePageMeta } from "@/lib/page-meta";
import { SITE } from "@/site";


function Hero() {
  const s = VERIFICATION.summary;
  return (
    <section className="relative overflow-hidden border-b">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.5)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.5)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24">
        <div className="animate-fade-up">
          <p className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-pass" aria-hidden="true" />
            {s.problems} verification problems, {s.checks} reference values
          </p>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Slope stability analysis you can verify
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
            cSlope is limit equilibrium software for geotechnical engineers. Bishop, Janbu and Morgenstern–Price on
            circular and non-circular slip surfaces, with water, loads, reinforcement and probabilistic analysis. Every
            release is checked against {s.problems} published problems.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link to="/download">
                <Download className="mr-2 h-4 w-4" />
                Download for Windows
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/docs">
                Read the documentation
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Free and open source under the {SITE.licence} licence.</p>
        </div>
        {/* The whole program, wide enough to read: below the text, not beside it. */}
        <Screenshot {...MEDIA.app} priority className="animate-fade-up shadow-xl [animation-delay:120ms]" />
      </div>
    </section>
  );
}

function KeyFigures() {
  const s = VERIFICATION.summary;
  const figures = [
    { value: String(s.problems), label: "published verification problems" },
    { value: String(s.checks), label: "reference values" },
    { value: "3", label: "limit equilibrium methods" },
    { value: SITE.licence, label: "licence, no licence server" },
  ];
  return (
    <div className="border-b bg-surface">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="flex flex-col-reverse py-8 pr-4">
            <dt className="mt-1 text-sm text-muted-foreground">{f.label}</dt>
            <dd className="font-mono text-3xl font-medium tabular tracking-tight">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const CAPABILITIES: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <BarChart3 className="h-5 w-5" />,
    title: "Three methods, one model",
    text: "Bishop simplified, Janbu with the f₀ correction and Morgenstern–Price with constant (Spencer), half-sine, clipped-sine, trapezoidal or user-defined interslice functions.",
  },
  {
    icon: <Spline className="h-5 w-5" />,
    title: "Circular and non-circular",
    text: "Search by entry and exit ranges, custom circles and polylines, non-circular optimisation, minimum slip depth and analysis in both slip directions.",
  },
  {
    icon: <Layers className="h-5 w-5" />,
    title: "Materials",
    text: "Mohr–Coulomb, undrained, strength increasing with depth or from a datum with a cutoff, anisotropic, spatially varying, lime-cement columns, and high-strength and impenetrable (bedrock) layers.",
  },
  {
    icon: <Droplets className="h-5 w-5" />,
    title: "Water",
    text: "Piezometric lines per material, ponded water above the ground, water-filled tension cracks and saturated unit weight below the water table.",
  },
  {
    icon: <Anchor className="h-5 w-5" />,
    title: "Reinforcement and loads",
    text: "Anchors, tiebacks, soil nails, geosynthetics, piles and sheet piles; distributed and line loads; partial factors on strength and loads.",
  },
  {
    icon: <FileText className="h-5 w-5" />,
    title: "Reporting",
    text: "Annotated result sheets with templates, slice data plots and export to PDF, PNG, Excel and CSV.",
  },
];

function Capabilities() {
  return (
    <Section id="capabilities">
      <SectionHeading
        eyebrow="Capabilities"
        title="Everything a slope stability review needs"
        lead="One desktop application for the whole job: model the section, run the search, check the result and produce the report."
      />
      <div className="mt-12 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="bg-card p-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-surface text-primary">
              {c.icon}
            </div>
            <h3 className="mt-4 font-semibold">{c.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          Sensitivity analysis and probabilistic analysis (Taylor series and Monte Carlo) are built in.
        </p>
        <Link to="/features" className="inline-flex items-center font-medium text-primary hover:underline">
          All features
          <ArrowRight className="ml-1 h-4 w-4" />
        </Link>
      </div>
    </Section>
  );
}

function Verification() {
  const examples = homeExamples();
  const s = VERIFICATION.summary;
  const counts = checkCounts();
  return (
    <Section id="verification" surface>
      <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:items-start">
        <div>
          <SectionHeading
            eyebrow="Verification"
            title="Checked against published solutions"
            lead={
              <>
                {s.problems} problems from the geotechnical literature and from verification manuals of established
                programs: {counts.literature} reference values from the literature, {counts.theory} from analytical
                solutions and {counts.programs} from other programs. The tests run them on every change to the code.
              </>
            }
          />
          <Link to="/verification" className="mt-6 inline-flex items-center text-sm font-medium text-primary hover:underline">
            Every problem and result
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>
        <div
          className="relative overflow-x-auto rounded-lg border bg-card [&_td]:px-3 [&_th]:px-3 sm:[&_td]:px-4 sm:[&_th]:px-4"
          tabIndex={0}
          role="region"
          aria-label="Examples of reference and computed factors of safety"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Examples of reference and computed factors of safety</caption>
            <thead className="border-b bg-surface text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Problem
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Reference
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  cSlope
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {examples.map(({ problem, check }) => (
                <tr key={problem.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{problem.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {check.method} · {check.source}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular">{check.published.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{check.computed?.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

const GALLERY = [
  { media: MEDIA.materials, caption: "Material regions of a non-homogeneous slope" },
  { media: MEDIA.allSurfaces, caption: "Every analysed surface, coloured by factor of safety" },
  { media: MEDIA.showcase, caption: "Layered slope with a water table and a crest load" },
  { media: MEDIA.showcaseResult, caption: "Critical surface under the whole crest load" },
];

function Gallery() {
  return (
    <Section id="screenshots">
      <SectionHeading eyebrow="The application" title="Built for daily engineering work" />
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {GALLERY.map((g) => (
          <Screenshot key={g.media.src} {...g.media} caption={g.caption} aspect="1724 / 1479" />
        ))}
      </div>
    </Section>
  );
}

const OPEN_SOURCE = [
  ["Transparent", "The solvers, the search and every verification problem are in the public repository."],
  ["Reproducible", "Deterministic solvers and a plain JSON project file: the same model gives the same answer."],
  ["Maintained", `Developed by ${SITE.company.name}, with automated tests and verification on every change.`],
] as const;

function OpenSource() {
  return (
    <Section id="open-source" surface>
      <div className="grid gap-10 md:grid-cols-2 md:items-center">
        <SectionHeading
          eyebrow="Open source"
          title="Yours to inspect, run and keep"
          lead="cSlope is MIT licensed. There is no licence server, no subscription and no lock-in: install it on every machine in the office, read the solver code behind any result, and keep the version your project was approved with."
        />
        <ul className="grid gap-4 text-sm">
          {OPEN_SOURCE.map(([title, text]) => (
            <li key={title} className="flex gap-3 rounded-lg border bg-card p-4">
              <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function DownloadBand() {
  return (
    <Section id="download">
      <div className="flex flex-col items-start justify-between gap-8 rounded-xl border bg-card p-8 sm:p-12 md:flex-row md:items-center">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Try it on your next section</h2>
          <p className="mt-3 text-muted-foreground">
            Install cSlope on Windows and open one of the built-in benchmark models from Help &gt; Benchmarks to see a
            complete analysis in a minute.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link to="/download">
              <Download className="mr-2 h-4 w-4" />
              Download
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/docs">Get started</Link>
          </Button>
        </div>
      </div>
    </Section>
  );
}

export function Home() {
  usePageMeta(null);
  return (
    <>
      <Hero />
      <KeyFigures />
      <Capabilities />
      <Verification />
      <Gallery />
      <OpenSource />
      <DownloadBand />
    </>
  );
}
