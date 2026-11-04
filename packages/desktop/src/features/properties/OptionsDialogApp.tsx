import { useEffect, useRef, useState } from "react";
import { OptionsSection } from "./sections/OptionsSection";
import { isElectron } from "../../utils/is-electron";
import { useAppStore } from "../../store/app-store";
import type {
  AnalysisLimitsState,
  BlockSearchObject,
  CustomSearchPlane,
  ModelEntry,
  ModelOrientation,
  PiezometricLineState,
} from "../../store/types";

interface AnalysisStatePayload {
  coordinates: [number, number][];
  orientation: ModelOrientation;
  analysisLimits: AnalysisLimitsState;
  customSearchPlanes: CustomSearchPlane[];
  customPlanesOnly: boolean;
  blockSearchObjects: BlockSearchObject[];
  options: ModelEntry["options"];
  /** From the main window: the water lines (rapid drawdown is set here). */
  piezometricLine?: PiezometricLineState;
  /** To the main window: the water before drawdown; null: none. */
  rapidDrawdown?: PiezometricLineState["rapidDrawdown"] | null;
}

export function OptionsDialogApp() {
  const coordinates = useAppStore((s) => s.coordinates);
  const orientation = useAppStore((s) => s.orientation);
  const analysisLimits = useAppStore((s) => s.analysisLimits);
  const customSearchPlanes = useAppStore((s) => s.customSearchPlanes);
  const customPlanesOnly = useAppStore((s) => s.customPlanesOnly);
  const blockSearchObjects = useAppStore((s) => s.blockSearchObjects);
  const options = useAppStore((s) => s.options);
  const rapidDrawdown = useAppStore((s) => s.piezometricLine.rapidDrawdown);

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
        blockSearchObjects: next.blockSearchObjects ?? [],
        options: next.options,
        ...(next.piezometricLine ? { piezometricLine: next.piezometricLine } : {}),
      });
      setIsHydrated(true);
    };

    const unsubscribeAnalysisState = window.cslope.onAnalysisState(applyState);
    const unsubscribeAnalysisChanged = window.cslope.onAnalysisChanged(applyState);
    window.cslope.requestAnalysisState();

    return () => {
      unsubscribeAnalysisState();
      unsubscribeAnalysisChanged();
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
      blockSearchObjects,
      options,
      rapidDrawdown: rapidDrawdown ?? null,
    });
  }, [
    coordinates,
    orientation,
    analysisLimits,
    customSearchPlanes,
    customPlanesOnly,
    blockSearchObjects,
    options,
    rapidDrawdown,
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
        <h2 className="text-[12px] font-semibold">Options</h2>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <OptionsSection plain />
      </div>
      <div
        className="pt-3 mt-2 border-t dialog-buttons"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        <button
          onClick={() => window.close()}
          className="btn btn-primary"
        >
          Close
        </button>
      </div>
    </div>
  );
}
