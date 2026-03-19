import { useEffect, useRef, useState } from "react";
import { CustomSearchPlanesSection } from "./sections/CustomSearchPlanesSection";
import { isElectron } from "../../utils/is-electron";
import { useAppStore } from "../../store/app-store";
import type {
  AnalysisLimitsState,
  CustomSearchPlane,
  ModelEntry,
  ModelOrientation,
} from "../../store/types";

interface AnalysisStatePayload {
  coordinates: [number, number][];
  orientation: ModelOrientation;
  analysisLimits: AnalysisLimitsState;
  customSearchPlanes: CustomSearchPlane[];
  customPlanesOnly: boolean;
  options: ModelEntry["options"];
}

export function CustomSearchPlanesDialogApp() {
  const coordinates = useAppStore((s) => s.coordinates);
  const orientation = useAppStore((s) => s.orientation);
  const analysisLimits = useAppStore((s) => s.analysisLimits);
  const customSearchPlanes = useAppStore((s) => s.customSearchPlanes);
  const customPlanesOnly = useAppStore((s) => s.customPlanesOnly);
  const options = useAppStore((s) => s.options);

  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (_event: unknown, next: AnalysisStatePayload) => {
      suppressNextBroadcastRef.current = true;
      useAppStore.setState({
        coordinates: next.coordinates,
        orientation: next.orientation,
        analysisLimits: next.analysisLimits,
        customSearchPlanes: next.customSearchPlanes,
        customPlanesOnly: next.customPlanesOnly,
        options: next.options,
      });
      setIsHydrated(true);
    };

    window.cslope.onAnalysisState(applyState);
    window.cslope.onAnalysisChanged(applyState);
    window.cslope.requestAnalysisState();

    return () => {
      window.cslope.offAnalysisState(applyState);
      window.cslope.offAnalysisChanged(applyState);
    };
  }, []);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }

    window.cslope.sendAnalysisChanged({
      coordinates,
      orientation,
      analysisLimits,
      customSearchPlanes,
      customPlanesOnly,
      options,
    });
  }, [
    coordinates,
    orientation,
    analysisLimits,
    customSearchPlanes,
    customPlanesOnly,
    options,
    isHydrated,
  ]);

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="pb-2">
        <h2 className="text-[12px] font-semibold">Custom search planes</h2>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <CustomSearchPlanesSection plain />
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
