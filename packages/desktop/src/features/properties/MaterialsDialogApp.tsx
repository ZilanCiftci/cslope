import { useEffect, useRef, useState } from "react";
import { DefineMaterialsDialog } from "./DefineMaterialsDialog";
import { useAppStore } from "../../store/app-store";
import type { MaterialRow, ParameterDef } from "../../store/types";
import { isElectron } from "../../utils/is-electron";

interface MaterialsStatePayload {
  materials: MaterialRow[];
  parameters?: ParameterDef[];
}

function normalizeMaterialsPayload(
  payload: MaterialsStatePayload | MaterialRow[],
): MaterialsStatePayload {
  if (Array.isArray(payload)) {
    return { materials: payload };
  }
  return payload;
}

export function MaterialsDialogApp() {
  const materials = useAppStore((s) => s.materials);
  const setMaterials = useAppStore((s) => s.setMaterials);
  const setParameters = useAppStore((s) => s.setParameters);
  const parameters = useAppStore((s) => s.parameters);
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  // State that arrived from the main window must not be echoed back: the
  // echo would invalidate the analysis result even though nothing changed.
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyMaterialsState = (
      _event: unknown,
      raw: MaterialsStatePayload | MaterialRow[],
    ) => {
      const next = normalizeMaterialsPayload(raw);
      suppressNextBroadcastRef.current = true;
      setMaterials(next.materials);
      if (Array.isArray(next.parameters)) {
        setParameters(next.parameters);
      }
      setIsHydrated(true);
    };

    const unsubscribeMaterialsState = window.cslope.onMaterialsState(applyMaterialsState);
    const unsubscribeMaterialsChanged = window.cslope.onMaterialsChanged(applyMaterialsState);
    window.cslope.requestMaterialsState();

    return () => {
      unsubscribeMaterialsState();
      unsubscribeMaterialsChanged();
    };
  }, [setMaterials, setParameters]);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;
    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }
    window.cslope.sendMaterialsChanged({ materials, parameters });
  }, [materials, parameters, isHydrated]);

  return (
    <DefineMaterialsDialog
      mode="window"
      onClose={() => {
        window.close();
      }}
    />
  );
}
