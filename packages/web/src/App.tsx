import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import type { AnalysisClient } from "@/engine/client";

/** The engine's state, shown while it loads. */
type EngineState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };

export function App({ client }: { client: AnalysisClient }) {
  const [engine, setEngine] = useState<EngineState>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    client.ready().then(
      () => current && setEngine({ kind: "ready" }),
      (err: unknown) => current && setEngine({ kind: "failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      current = false;
    };
  }, [client]);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Slope stability in the browser</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Fill in a template and get F, computed on your own computer by the cSlope engine. The templates are on their way.
        </p>
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          {engine.kind === "loading" && "Loading the engine"}
          {engine.kind === "ready" && "Engine ready"}
          {engine.kind === "failed" && `The engine could not load: ${engine.message}`}
        </p>
      </main>
    </>
  );
}
