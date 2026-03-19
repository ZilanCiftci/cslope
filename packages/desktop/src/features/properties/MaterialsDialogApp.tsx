import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!isElectron) return;

    const applyMaterialsState = (
      _event: unknown,
      raw: MaterialsStatePayload | MaterialRow[],
    ) => {
      const next = normalizeMaterialsPayload(raw);
      setMaterials(next.materials);
      if (Array.isArray(next.parameters)) {
        setParameters(next.parameters);
      }
      setIsHydrated(true);
    };

    window.cslope.onMaterialsState(applyMaterialsState);
    window.cslope.onMaterialsChanged(applyMaterialsState);
    window.cslope.requestMaterialsState();

    return () => {
      window.cslope.offMaterialsState(applyMaterialsState);
      window.cslope.offMaterialsChanged(applyMaterialsState);
    };
  }, [setMaterials, setParameters]);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;
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
