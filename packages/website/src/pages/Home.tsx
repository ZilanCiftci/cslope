import { motion } from "framer-motion";
import { ArrowRight, BarChart3, Layers, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const highlights = [
  {
    icon: <Layers className="h-8 w-8" />,
    title: "Multiple Methods",
    description:
      "Bishop, Fellenius, and other limit equilibrium methods for comprehensive slope stability analysis.",
  },
  {
    icon: <BarChart3 className="h-8 w-8" />,
    title: "Interactive Plotting",
    description:
      "Visualize slope geometry, failure surfaces, and factor of safety results in real-time.",
  },
  {
    icon: <FileDown className="h-8 w-8" />,
    title: "Import & Export",
    description:
      "Save and load projects, export results to common formats for reporting.",
  },
];

export function Home() {
  return (
    <div className="flex flex-col items-center">
      {/* Hero section */}
      <section className="w-full py-24 md:py-32 lg:py-40">
        <div className="container mx-auto flex flex-col items-center text-center px-4">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              cSlope
            </h1>
            <p className="mt-2 text-2xl font-semibold text-primary/80 sm:text-3xl">
              Slope Stability Analysis
            </p>
          </motion.div>

          <motion.p
            className="mt-6 max-w-[640px] text-lg text-muted-foreground sm:text-xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
          >
            Fast, modern, open-source software for geotechnical engineers.
          </motion.p>

          <motion.div
            className="mt-8 flex flex-col gap-4 sm:flex-row"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
          >
            <a
              href="https://github.com/ZilanCiftci/cslope"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a
              href="https://github.com/ZilanCiftci/cslope"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="lg">
                View on GitHub
              </Button>
            </a>
          </motion.div>
        </div>
      </section>

      {/* Feature highlights */}
      <section className="w-full py-16 bg-muted/50">
        <div className="container mx-auto px-4">
          <motion.div
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            {highlights.map((item) => (
              <Card key={item.title} className="bg-background">
                <CardHeader>
                  <div className="mb-2 text-primary">{item.icon}</div>
                  <CardTitle className="text-xl">{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </motion.div>
        </div>
      </section>
    </div>
  );
}
