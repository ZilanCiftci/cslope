import { motion } from "framer-motion";
import { Separator } from "@/components/ui/separator";

export function Docs() {
  return (
    <div className="container mx-auto py-16 md:py-24 max-w-3xl px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Documentation
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Get started with cSlope in minutes.
        </p>
      </motion.div>

      <Separator className="my-8" />

      <motion.div
        className="space-y-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <section>
          <h2 className="text-2xl font-semibold">Quick Start</h2>
          <ol className="mt-4 space-y-3 list-decimal list-inside text-muted-foreground">
            <li>
              Clone the repository:{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                git clone https://github.com/ZilanCiftci/cslope.git
              </code>
            </li>
            <li>
              Install dependencies:{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                bun install
              </code>
            </li>
            <li>
              Start the development server:{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                bun run dev
              </code>
            </li>
            <li>Open your browser and start defining your slope geometry.</li>
          </ol>
        </section>

        <Separator />

        <section>
          <h2 className="text-2xl font-semibold">Defining a Slope</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Use the interactive editor to define your slope geometry by adding
            coordinate points. Add soil layers with their material properties
            (unit weight, cohesion, friction angle). The software will
            automatically compute the factor of safety using the selected
            analysis method.
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
              <strong>Bishop Simplified</strong> — Satisfies moment equilibrium
              for circular slip surfaces.
            </li>
            <li>
              <strong>Fellenius (Ordinary Method of Slices)</strong> — A simpler
              approach that neglects inter-slice forces.
            </li>
          </ul>
        </section>

        <Separator />

        <section>
          <h2 className="text-2xl font-semibold">Project Files</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Save your analysis as a JSON project file using the export function.
            You can share this file with colleagues or reload it later. The
            project file stores the complete slope definition including
            geometry, soil properties, and analysis settings.
          </p>
        </section>
      </motion.div>
    </div>
  );
}
