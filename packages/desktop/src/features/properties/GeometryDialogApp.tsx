import { useEffect, useRef, useState } from "react";
import { GeometrySection } from "./sections/GeometrySection";
import { isElectron } from "../../utils/is-electron";
import { useAppStore } from "../../store/app-store";
import type { ParameterDef } from "../../store/types";

interface GeometryStatePayload {
  coordinates: [number, number][];
  coordinateExpressions: { x?: string; y?: string }[];
  parameters?: ParameterDef[];
}

export function GeometryDialogApp() {
  const coordinates = useAppStore((s) => s.coordinates);
  const coordinateExpressions = useAppStore((s) => s.coordinateExpressions);
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (_event: unknown, next: GeometryStatePayload) => {
      suppressNextBroadcastRef.current = true;
      const patch: {
        coordinates: [number, number][];
        coordinateExpressions: { x?: string; y?: string }[];
        parameters?: ParameterDef[];
      } = {
        coordinates: next.coordinates,
        coordinateExpressions: next.coordinateExpressions,
      };

      if (Array.isArray(next.parameters)) {
        patch.parameters = next.parameters;
      }

      useAppStore.setState(patch);
      setIsHydrated(true);
    };

    window.cslope.onGeometryState(applyState);
    window.cslope.onGeometryChanged(applyState);
    window.cslope.requestGeometryState();

    return () => {
      window.cslope.offGeometryState(applyState);
      window.cslope.offGeometryChanged(applyState);
    };
  }, []);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }

    window.cslope.sendGeometryChanged({
      coordinates,
      coordinateExpressions,
    });
  }, [coordinates, coordinateExpressions, isHydrated]);

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="pb-2">
        <h2 className="text-[12px] font-semibold">Exterior Boundary</h2>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <GeometrySection plain />
      </div>
      <div
        className="pt-3 mt-2 border-t"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        <button
          onClick={() => window.close()}
          className="w-full text-[11px] py-1 rounded cursor-pointer font-medium"
          style={{
            background: "var(--color-vsc-accent)",
            color: "#fff",
            border: "1px solid var(--color-vsc-accent)",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
