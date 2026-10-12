import { Separator } from "@/components/ui/separator";

export function Docs() {
  return (
    <div className="container mx-auto py-16 md:py-24 max-w-3xl px-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Documentation
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Get started with cSlope in minutes.
        </p>
      </div>

      <Separator className="my-8" />

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold">Quick Start</h2>
          <ol className="mt-4 space-y-3 list-decimal list-inside text-muted-foreground">
            <li>
              Download the Windows installer from the{" "}
              <a
                href="https://github.com/ZilanCiftci/cslope/releases"
                className="underline underline-offset-4"
              >
                releases page
              </a>
              .
            </li>
            <li>Run the installer and start cSlope from the Start menu.</li>
            <li>Open a benchmark model from Help &gt; Benchmarks, or start a new project.</li>
          </ol>
        </section>

        <Separator />

        <section>
          <h2 className="text-2xl font-semibold">Defining a Slope</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Use the interactive editor to define your slope geometry by adding
            coordinate points. Add soil layers with their material properties
            (unit weight, cohesion, friction angle). The software will
            search circular and non-circular slip surfaces and report the
            critical factor of safety for the selected analysis method.
          </p>
        </section>

        <Separator />

        <section>
          <h2 className="text-2xl font-semibold">Analysis Methods</h2>
          <p className="mt-4 text-muted-foreground">
            cSlope supports the following limit equilibrium methods:
          </p>
          <ul className="mt-3 space-y-2 list-disc list-inside text-muted-foreground">
            <li>
              <strong>Bishop Simplified</strong> — Satisfies moment equilibrium.
            </li>
            <li>
              <strong>Janbu Simplified</strong> — Satisfies horizontal force
              equilibrium, optionally with the f<sub>0</sub> correction factor.
            </li>
            <li>
              <strong>GLE / Morgenstern–Price</strong> — A rigorous method
              satisfying both force and moment equilibrium with a user-defined
              inter-slice force function. A constant function gives Spencer's
              method.
            </li>
          </ul>
        </section>

        <Separator />

        <section>
          <h2 className="text-2xl font-semibold">Project Files</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Save your analysis with Save / Save As as a project file (.cslope or
            .json).
            You can share this file with colleagues or reload it later. The
            project file stores the complete slope definition including
            geometry, soil properties, and analysis settings.
          </p>
        </section>
      </div>
    </div>
  );
}
