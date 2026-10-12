import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Section, SectionHeading } from "@/components/Section";
import { Button } from "@/components/ui/button";
import {
  VERIFICATION,
  checkCounts,
  filterProblems,
  type Filter,
  type MethodFilter,
  type SourceFilter,
} from "@/content/verification";
import { LATEST } from "@/content/release";
import { usePageMeta } from "@/lib/page-meta";
import { cn } from "@/lib/utils";

const num = (x: number | null, digits = 3) => (x == null ? "–" : x.toFixed(digits));

/** The public edition of the report, attached to every release (none before the first). */
const REPORT = LATEST?.report;

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

function ProblemTable() {
  const [filter, setFilterState] = useState<Filter>({ query: "", source: "all", method: "all" });
  const [limit, setLimit] = useState(PAGE);
  const setFilter = (f: Filter) => {
    setFilterState(f);
    setLimit(PAGE);
  };
  const problems = useMemo(() => filterProblems(VERIFICATION.problems, filter), [filter]);
  const shown = problems.reduce((n, p) => n + p.checks.length, 0);
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
        <Select<SourceFilter>
          label="Published by"
          value={filter.source}
          onChange={(source) => setFilter({ ...filter, source })}
          options={[
            ["all", "All sources"],
            ["literature", "Literature"],
            ["program", "Other programs"],
          ]}
        />
      </div>
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {shown} of {VERIFICATION.summary.checks} checks in {problems.length} problems
      </p>

      <div
        className="mt-4 relative overflow-x-auto rounded-lg border bg-card"
        tabIndex={0}
        role="region"
        aria-label="Verification problems"
      >
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="sr-only">Verification problems: reference and computed factors of safety</caption>
          <thead className="border-b bg-surface text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Problem
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Method · source
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Reference
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                cSlope
              </th>
            </tr>
          </thead>
          {visible.map((p) => (
            <tbody key={p.id} className="border-b last:border-b-0">
              {p.checks.map((k, i) => (
                <tr key={i} className={cn(i > 0 && "border-t border-dashed")}>
                  {i === 0 && (
                    <th scope="rowgroup" rowSpan={p.checks.length} className="w-[34%] px-4 py-3 align-top font-normal">
                      <div className="font-medium">{p.title}</div>
                      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.reference}</div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">{p.id}</div>
                    </th>
                  )}
                  <td className="px-4 py-3 align-top">
                    <div>{k.method}</div>
                    <div className="text-xs text-muted-foreground">{k.source}</div>
                  </td>
                  <td className="px-4 py-3 text-right align-top font-mono tabular whitespace-nowrap">{num(k.published)}</td>
                  <td className="px-4 py-3 text-right align-top font-mono tabular">{num(k.computed)}</td>
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
  const rows = VERIFICATION.reliability.flatMap((r) =>
    r.checks.filter((k) => k.quantity !== "fos").map((k) => ({ r, k })),
  );
  return (
    <div
      className="mt-8 relative overflow-x-auto rounded-lg border bg-card"
      tabIndex={0}
      role="region"
      aria-label="Probabilistic verification problems"
    >
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">Probabilistic verification problems</caption>
        <thead className="border-b bg-surface text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Problem
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Quantity · source
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
          {rows.map(({ r, k }, i) => (
            <tr key={`${r.id}-${i}`}>
              <td className="px-4 py-3">{r.title}</td>
              <td className="px-4 py-3">
                <div>{QUANTITY[k.quantity] ?? k.quantity}</div>
                <div className="text-xs text-muted-foreground">{k.source}</div>
              </td>
              <td className="px-4 py-3 text-right font-mono tabular">{num(k.published, 4)}</td>
              <td className="px-4 py-3 text-right font-mono tabular">{num(k.computed, 4)}</td>

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
    `cSlope against ${VERIFICATION.summary.problems} published slope stability problems: reference and computed factors of safety, problem by problem.`,
  );
  const s = VERIFICATION.summary;
  const counts = checkCounts();
  return (
    <>
      <PageHeader
        eyebrow="Verification"
        title="Every result, next to the reference"
        lead={`cSlope is run on ${s.problems} problems with ${s.checks} reference values: ${counts.literature} from the literature, ${counts.theory} closed-form solutions and ${counts.programs} from other programs. The same problems run in the automated tests on every change to the code, so this table is what the program computes today.`}
      >
        <dl className="mt-10 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
          {[
            [String(s.problems), "problems"],
            [String(s.checks), "reference values"],
            [String(counts.literature), "from the literature"],
            [String(s.reliabilityChecks), "probabilistic values (β, Pf)"],
          ].map(([v, l]) => (
            <div key={l} className="flex flex-col-reverse">
              <dt className="mt-1 text-sm text-muted-foreground">{l}</dt>
              <dd className="font-mono text-2xl font-medium tabular">{v}</dd>
            </div>
          ))}
        </dl>
        {REPORT ? (
          <Button asChild variant="outline" className="mt-10">
            <a href={REPORT}>
              <FileDown className="mr-2 h-4 w-4" />
              Verification report (PDF)
            </a>
          </Button>
        ) : (
          <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
            <FileDown className="h-4 w-4" aria-hidden="true" />
            The verification report (PDF) is attached to every release, from the first release on.
          </p>
        )}
      </PageHeader>

      <Section>
        <SectionHeading
          title="How the problems are checked"
          lead="Each problem is entered from its source: geometry, materials, water and loads. cSlope then analyses the surface the source gives, or searches for the critical one where the source did, with the method the source used. The tables show the reference value next to cSlope's."
        />
        <ul className="mt-8 grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
          <li className="rounded-lg border bg-card p-4">
            <p className="font-medium text-foreground">Literature</p>
            <p className="mt-1">
              Values from papers and textbooks are cited by author and year. They are the primary reference.
            </p>
          </li>
          <li className="rounded-lg border bg-card p-4">
            <p className="font-medium text-foreground">Other programs</p>
            <p className="mt-1">
              Some values come from the verification and reference manuals of other slope stability programs, most
              of them commercial. They are shown as program A, B and so on: one letter per program, so differences
              between programs stay visible.
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
          lead="Reliability index β and probability of failure from the Taylor series and Monte Carlo methods, next to the reference values."
        />
        <ReliabilityTable />
      </Section>
    </>
  );
}
