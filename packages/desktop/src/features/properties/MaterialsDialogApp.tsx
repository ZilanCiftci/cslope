import { useEffect, useState } from "react";
import { DefineMaterialsDialog } from "./DefineMaterialsDialog";
import { useAppStore } from "../../store/app-store";
import type { MaterialRow } from "../../store/types";
import { isElectron } from "../../utils/is-electron";

export function MaterialsDialogApp() {
  const materials = useAppStore((s) => s.materials);
  const setMaterials = useAppStore((s) => s.setMaterials);
  const [isHydrated, setIsHydrated] = useState(!isElectron);

  useEffect(() => {
    if (!isElectron) return;

    const handleMaterialsState = (_event: unknown, next: MaterialRow[]) => {
      setMaterials(next);
      setIsHydrated(true);
    };

    const handleMaterialsChanged = (_event: unknown, next: MaterialRow[]) => {
      setMaterials(next);
      setIsHydrated(true);
    };

    window.cslope.onMaterialsState(handleMaterialsState);
    window.cslope.onMaterialsChanged(handleMaterialsChanged);
    window.cslope.requestMaterialsState();

    return () => {
      window.cslope.offMaterialsState(handleMaterialsState);
      window.cslope.offMaterialsChanged(handleMaterialsChanged);
    };
  }, [setMaterials]);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;
    window.cslope.sendMaterialsChanged(materials);
  }, [materials, isHydrated]);

  return (
    <DefineMaterialsDialog
      mode="window"
      onClose={() => {
        window.close();
      }}
    />
  );
}
