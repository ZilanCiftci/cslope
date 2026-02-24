import { motion } from "framer-motion";
import { Separator } from "@/components/ui/separator";

export function About() {
  return (
    <div className="container mx-auto py-16 md:py-24 max-w-3xl px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          About cSlope
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Open-source slope stability analysis for geotechnical engineers.
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
          <h2 className="text-2xl font-semibold">Background</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            cSlope started as <strong>pySlope</strong>, a Python-based slope
            stability analysis tool. It has since been fully rewritten in
            TypeScript to deliver a faster, more interactive experience that
            runs entirely in the browser — no installation required.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold">Technology</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            The project is a TypeScript monorepo built with <strong>Bun</strong>
            , <strong>Vite</strong>, and <strong>React</strong>. The analysis
            engine is a standalone package (
            <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
              @cslope/engine
            </code>
            ) that can be used independently of the web application.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold">License</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            cSlope is released under the{" "}
            <a
              href="https://github.com/ZilanCiftci/cslope/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              MIT License
            </a>
            . You are free to use, modify, and distribute it.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold">Credits</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Created and maintained by{" "}
            <a
              href="https://github.com/ZilanCiftci"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              Zilan Ciftci
            </a>
            . Contributions and feedback are welcome — feel free to open an
            issue or pull request on{" "}
            <a
              href="https://github.com/ZilanCiftci/cslope"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              GitHub
            </a>
            .
          </p>
        </section>
      </motion.div>
    </div>
  );
}
