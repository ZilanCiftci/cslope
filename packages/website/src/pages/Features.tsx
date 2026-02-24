import { motion } from "framer-motion";
import {
  Calculator,
  BarChart3,
  Layers,
  FileDown,
  FileUp,
  Sliders,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    icon: <Calculator className="h-8 w-8" />,
    title: "Limit Equilibrium Methods",
    description:
      "Supports Bishop Simplified, GLE (Morgenstern–Price), and more. Each method is implemented with rigorous numerical accuracy.",
  },
  {
    icon: <Layers className="h-8 w-8" />,
    title: "Complex Soil Profiles",
    description:
      "Define multiple soil layers with distinct properties. Support for water tables, external loads, and reinforcement elements.",
  },
  {
    icon: <BarChart3 className="h-8 w-8" />,
    title: "Interactive Visualization",
    description:
      "Real-time plotting of slope geometry, critical failure surfaces, and slice force diagrams. Pan, zoom, and inspect individual slices.",
  },
  {
    icon: <Sliders className="h-8 w-8" />,
    title: "Parametric Analysis",
    description:
      "Run sensitivity studies by varying soil parameters, water level, or geometry to understand how each factor affects stability.",
  },
  {
    icon: <FileDown className="h-8 w-8" />,
    title: "Export Results",
    description:
      "Export analysis results and plots. Generate professional reports for your geotechnical projects.",
  },
  {
    icon: <FileUp className="h-8 w-8" />,
    title: "Save & Load Projects",
    description:
      "Save your work as JSON project files. Share with colleagues or reload later for further analysis.",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export function Features() {
  return (
    <div className="container mx-auto py-16 md:py-24 px-4">
      <motion.div
        className="text-center mb-12"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Features
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-[600px] mx-auto">
          Everything you need for slope stability analysis, built into a modern
          web application.
        </p>
      </motion.div>

      <motion.div
        className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        variants={container}
        initial="hidden"
        animate="show"
      >
        {features.map((feature) => (
          <motion.div key={feature.title} variants={item}>
            <Card className="h-full">
              <CardHeader>
                <div className="mb-2 text-primary">{feature.icon}</div>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
