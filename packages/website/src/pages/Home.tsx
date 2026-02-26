import { motion } from "framer-motion";
import {
  Download,
  BarChart3,
  Layers,
  ShieldCheck,
  Zap,
  Workflow,
  LineChart,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const stats = [
  { label: "Analysis methods", value: "Multiple" },
  { label: "Your desktop", value: "Runs on" },

  { label: "License", value: "MIT" },
];

const highlights = [
  {
    icon: <Layers className="h-8 w-8" />,
    title: "Limit equilibrium suite",
    description:
      "Run Bishop Simplified, Janbu, and Morgenstern–Price with shared options and consistent output.",
  },
  {
    icon: <BarChart3 className="h-8 w-8" />,
    title: "Visual feedback",
    description:
      "Edit geometry, materials, and loads on a single canvas with snapping, hit-testing, and undo/redo.",
  },
  {
    icon: <ShieldCheck className="h-8 w-8" />,
    title: "Auditable results",
    description:
      "Deterministic solvers, JSON persistence, and PDF exports make it easy to review how a model was solved.",
  },
  {
    icon: <Zap className="h-8 w-8" />,
    title: "Focused desktop build",
    description:
      "Electron-based preview prioritises quick iteration on Windows; macOS packages are planned once stable.",
  },
];

const workflow = [
  {
    title: "Sketch the slope",
    detail:
      "Start from example models or draw coordinates directly. Snapping, hit-tests, and undo keep edits clean.",
  },
  {
    title: "Assign materials & loads",
    detail:
      "Define material sets, draw boundaries, toggle piezometric lines, and apply UDLs or line loads.",
  },
  {
    title: "Scan failure mechanisms",
    detail:
      "Search circular failures, tweak solver options, and compare Bishop, Janbu, or Morgenstern–Price outputs side by side.",
  },
  {
    title: "Package the findings",
    detail:
      "Export project JSON or vector PDFs to bring into reports while development continues toward one-click installers.",
  },
];

const capabilityCallouts = [
  {
    title: "Data you can trust",
    description:
      "Everything is plain JSON plus regression-tested solvers, so you can inspect and version-control every change.",
    icon: <LineChart className="h-5 w-5" />,
  },
  {
    title: "Built for modern teams",
    description:
      "Keyboard shortcuts, undo/redo, and transparent GitHub issues keep collaboration honest about what ships next.",
    icon: <Globe className="h-5 w-5" />,
  },
];

export function Home() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <section className="w-full bg-gradient-to-b from-primary/10 via-background to-background py-24 md:py-32">
        <div className="container mx-auto flex flex-col items-center text-center px-4">
          <motion.h1
            className="mt-6 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            cSlope
          </motion.h1>
          <motion.p
            className="mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          ></motion.p>
          <motion.p
            className="mt-6 text-sm uppercase tracking-[0.35em] text-primary/80"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            FAST, MODERN,OPEN SOURCE SOFTWARE <br />
            FOR SLOPE STABILITY
          </motion.p>
          <motion.div
            className="mt-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <a
              href="https://github.com/ZilanCiftci/cslope"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg" className="text-base">
                Download preview build
                <Download className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </motion.div>
          <motion.div
            className="mt-12 grid w-full max-w-3xl gap-6 rounded-2xl border bg-background/80 p-6 backdrop-blur-sm sm:grid-cols-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
          >
            {stats.map((stat) => (
              <div key={stat.label} className="text-left">
                <p className="text-3xl font-bold">{stat.value}</p>
                <p className="text-sm uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Highlights */}
      <section className="w-full py-10" id="capabilities">
        <div className="container mx-auto px-4">
          <div className="mb-10 flex flex-col items-start gap-3 text-left">
            <p className="text-sm font-semibold text-primary">
              Capability stack
            </p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything you need for day-to-day slope reviews.
            </h2>
          </div>
          <motion.div
            className="grid gap-6 md:grid-cols-2"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5 }}
          >
            {highlights.map((item) => (
              <Card key={item.title} className="bg-background/80">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="rounded-full border bg-primary/10 p-3 text-primary">
                    {item.icon}
                  </div>
                  <CardTitle className="text-xl font-semibold">
                    {item.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="w-full py-24" id="download">
        <div className="container mx-auto px-4">
          <div className="rounded-[32px] border bg-gradient-to-br from-primary/15 via-primary/5 to-background p-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-primary/80">
              READY WHEN YOU ARE
            </p>
            <h2 className="mt-5 text-3xl font-bold sm:text-4xl">
              Start modelling smarter slopes today.
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Download the preview build, explore the example projects, and help
              shape the roadmap toward official installers.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="https://github.com/ZilanCiftci/cslope"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="lg" className="text-base">
                  Download preview build
                  <Download className="ml-2 h-4 w-4" />
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
