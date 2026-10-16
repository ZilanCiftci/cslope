import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Section, SectionHeading } from "@/components/Section";
import { Button } from "@/components/ui/button";
import {
  VERIFICATION,
  filterProblems,
  formatPublished,
  formatRange,
  type Filter,
  type MethodFilter,
  type PublishedFilter,
} from "@/content/verification";
import type { PublishedValue } from "@/content/verification-types";
import { REPORT } from "@/content/report";
import { usePageMeta } from "@/lib/page-meta";
import { cn } from "@/lib/utils";

const num = (x: number | null, digits = 3) => (x == null ? "–" : x.toFixed(digits));


function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-10 rounded-md border bg-background px-3 text-sm"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Problems shown at first, and added by each "Show more". */
const PAGE = 30;

/** The values a problem's sources publish, one per line. */
function Published({ values }: { values: PublishedValue[] }) {
  if (values.length === 0) return <p className="text-xs text-muted-foreground">No value published by the source.</p>;
  return (
    <ul className="space-y-1">
      {values.map((v, i) => (
        <li key={i} className="text-xs leading-relaxed">
          <span className="font-mono tabular text-foreground">{formatPublished(v)}</span>{" "}
          <span className="text-muted-foreground">
            {v.method ? `${v.method} · ` : ""}
            {v.source}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProblemTable() {
  const [filter, setFilterState] = useState<Filter>({ query: "", published: "all", method: "all" });
  const [limit, setLimit] = useState(PAGE);
  const setFilter = (f: Filter) => {
    setFilterState(f);
    setLimit(PAGE);
  };
  const problems = useMemo(() => filterProblems(VERIFICATION.problems, filter), [filter]);
  const shown = problems.reduce((n, p) => n + p.results.length, 0);
  const visible = problems.slice(0, limit);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Search</span>
          <input
            type="search"
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            placeholder="Author, year, problem…"
            className="h-10 rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <Select<MethodFilter>
          label="Method"
          value={filter.method}
          onChange={(method) => setFilter({ ...filter, method })}
          options={[
            ["all", "All methods"],
            ["Bishop", "Bishop simplified"],
            ["Janbu", "Janbu"],
            ["Spencer", "Spencer"],
            ["Morgenstern-Price", "Morgenstern–Price"],
          ]}
        />
        <Select<PublishedFilter>
          label="Published value"
          value={filter.published}
          onChange={(published) => setFilter({ ...filter, published })}
          options={[
            ["all", "All problems"],
            ["with", "Source publishes a value"],
            ["without", "No published value"],
          ]}
        />
      </div>
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {shown} of {VERIFICATION.summary.results} analyses in {problems.length} problems
      </p>

      <div
        className="mt-4 relative overflow-x-auto rounded-lg border bg-card"
        tabIndex={0}
        role="region"
        aria-label="Verification problems"
      >
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">
            Verification problems: the sources' values, other programs' results and cSlope's results
          </caption>
          <thead className="border-b bg-surface text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Problem · published values
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                cSlope analysis
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Other programs
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                cSlope
              </th>
            </tr>
          </thead>
          {visible.map((p) => (
            <tbody key={p.id} className="border-b last:border-b-0">
              {p.results.map((r, i) => (
                <tr key={i} className={cn(i > 0 && "border-t border-dashed")}>
                  {i === 0 && (
                    <th scope="rowgroup" rowSpan={p.results.length} className="w-[42%] px-4 py-3 align-top font-normal">
                      <div className="font-medium">{p.title}</div>
                      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.reference}</div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">{p.id}</div>
                      <div className="mt-3">
                        <Published values={p.published} />
                      </div>
                    </th>
                  )}
                  <td className="px-4 py-3 align-top">{r.method}</td>
                  <td className="px-4 py-3 text-right align-top font-mono tabular whitespace-nowrap text-muted-foreground">
                    {formatRange(r.programs)}
                  </td>
                  <td className="px-4 py-3 text-right align-top font-mono tabular">{num(r.computed)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {problems.length === 0 && <p className="p-6 text-sm text-muted-foreground">No problems match the filter.</p>}
      </div>
      {problems.length > limit && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <Button variant="outline" onClick={() => setLimit(limit + PAGE)}>
            Show more problems
          </Button>
          <p className="text-xs text-muted-foreground">
            Showing {limit} of {problems.length}
          </p>
        </div>
      )}
    </>
  );
}

const QUANTITY: Record<string, string> = {
  fos: "FOS",
  "beta-taylor": "β, Taylor series",
  "pf-taylor": "Pf, Taylor series",
  "beta-mc": "β, Monte Carlo",
  "pf-mc": "Pf, Monte Carlo",
};

function ReliabilityTable() {
  const rows = VERIFICATION.reliability.flatMap((r) => r.rows.map((k) => ({ r, k })));
  return (
    <div
      className="mt-8 relative overflow-x-auto rounded-lg border bg-card"
      tabIndex={0}
      role="region"
      aria-label="Probabilistic verification problems"
    >
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">Probabilistic verification problems</caption>
        <thead className="border-b bg-surface text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Problem
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Quantity · published values
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Other programs
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              cSlope
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ r, k }, i) => (
            <tr key={`${r.id}-${i}`}>
              <td className="px-4 py-3 align-top">{r.title}</td>
              <td className="px-4 py-3 align-top">
                <div>{QUANTITY[k.quantity] ?? k.quantity}</div>
                {k.published.map((v, j) => (
                  <div key={j} className="text-xs text-muted-foreground">
                    <span className="font-mono tabular text-foreground">{v.value}</span> {v.source}
                  </div>
                ))}
              </td>
              <td className="px-4 py-3 text-right align-top font-mono tabular text-muted-foreground">
                {formatRange(k.programs, 4)}
              </td>
              <td className="px-4 py-3 text-right align-top font-mono tabular">{num(k.computed, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Verification() {
  usePageMeta(
    "Verification",
    `cSlope on ${VERIFICATION.summary.problems} published slope stability problems: the sources' values, other programs' results and cSlope's results, problem by problem.`,
  );
  const s = VERIFICATION.summary;
  return (
    <>
      <PageHeader
        eyebrow="Verification"
        title="Every result, next to the published ones"
        lead={`cSlope is run on ${s.problems} problems from the literature and from verification manuals. For each problem the table shows what the source publishes, with the method where the source names one, the range of other programs' results and cSlope's result. It presents the results; it does not mark them as passed or failed.`}
      >
        <dl className="mt-10 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
          {[
            [String(s.problems), "problems"],
            [String(s.problemsWithPublished), "with a value from the source"],
            [String(s.results), "cSlope analyses"],
            [String(s.reliabilityQuantities), "probabilistic results (β, Pf)"],
          ].map(([v, l]) => (
            <div key={l} className="flex flex-col-reverse">
              <dt className="mt-1 text-sm text-muted-foreground">{l}</dt>
              <dd className="font-mono text-2xl font-medium tabular">{v}</dd>
            </div>
          ))}
        </dl>
        <Button asChild variant="outline" className="mt-10">
          <a href={REPORT} download>
            <FileDown className="mr-2 h-4 w-4" />
            Verification report (PDF)
          </a>
        </Button>
      </PageHeader>

      <Section>
        <SectionHeading
          title="What the table shows"
          lead="Each problem is entered from its source: geometry, materials, water and loads. cSlope then analyses the surface the source gives, or searches for the critical one where the source did."
        />
        <ul className="mt-8 grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <li className="rounded-lg border bg-card p-4">
            <p className="font-medium text-foreground">Published values</p>
            <p className="mt-1">
              What the paper, book or design manual gives, cited by author and year, with the method where the source
              names one. Some are hand calculations, charts, trial wedges or finite elements rather than the method of
              slices.
            </p>
          </li>
          <li className="rounded-lg border bg-card p-4">
            <p className="font-medium text-foreground">Other programs</p>
            <p className="mt-1">
              The range of results that other slope stability programs, most of them commercial, publish in their
              verification manuals for the same analysis. The programs are not named.
            </p>
          </li>
          <li className="rounded-lg border bg-card p-4">
            <p className="font-medium text-foreground">cSlope</p>
            <p className="mt-1">
              cSlope&apos;s result for each analysis, as the program computes it today: the automated tests run the same
              problems on every change to the code.
            </p>
          </li>
        </ul>
      </Section>

      <Section surface id="problems">
        <SectionHeading title="Problems" />
        <div className="mt-8">
          <ProblemTable />
        </div>
      </Section>

      <Section id="probabilistic">
        <SectionHeading
          title="Probabilistic analysis"
          lead="Reliability index β and probability of failure from the Taylor series and Monte Carlo methods."
        />
        <ReliabilityTable />
      </Section>
    </>
  );
}
