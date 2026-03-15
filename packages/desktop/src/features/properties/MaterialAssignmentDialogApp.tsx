import { useEffect, useState } from "react";
import { MaterialAssignmentSection } from "./sections/MaterialAssignmentSection";
import { isElectron } from "../../utils/is-electron";
import { useAppStore } from "../../store/app-store";
import type {
  MaterialBoundaryRow,
  MaterialRow,
  RegionMaterials,
} from "../../store/types";

interface MaterialAssignmentStatePayload {
  coordinates: [number, number][];
  materialBoundaries: MaterialBoundaryRow[];
  regionMaterials: RegionMaterials;
  materials: MaterialRow[];
}

export function MaterialAssignmentDialogApp() {
  const coordinates = useAppStore((s) => s.coordinates);
  const materials = useAppStore((s) => s.materials);
  const materialBoundaries = useAppStore((s) => s.materialBoundaries);
  const regionMaterials = useAppStore((s) => s.regionMaterials);
  const setCoordinates = useAppStore((s) => s.setCoordinates);
  const setMaterials = useAppStore((s) => s.setMaterials);
  const setMaterialBoundaries = useAppStore((s) => s.setMaterialBoundaries);
  const setRegionMaterials = useAppStore((s) => s.setRegionMaterials);
  const [isHydrated, setIsHydrated] = useState(!isElectron);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (
      _event: unknown,
      next: MaterialAssignmentStatePayload,
    ) => {
      setCoordinates(next.coordinates);
      setMaterials(next.materials);
      setMaterialBoundaries(next.materialBoundaries);
      setRegionMaterials(next.regionMaterials);
      setIsHydrated(true);
    };

    window.cslope.onMaterialAssignmentState(applyState);
    window.cslope.onMaterialAssignmentChanged(applyState);
    window.cslope.requestMaterialAssignmentState();

    return () => {
      window.cslope.offMaterialAssignmentState(applyState);
      window.cslope.offMaterialAssignmentChanged(applyState);
    };
  }, [setCoordinates, setMaterials, setMaterialBoundaries, setRegionMaterials]);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    window.cslope.sendMaterialAssignmentChanged({
      coordinates,
      materialBoundaries,
      regionMaterials,
      materials,
    });
  }, [coordinates, materialBoundaries, regionMaterials, materials, isHydrated]);

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="pb-2">
        <h2 className="text-[12px] font-semibold">Assign Materials</h2>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <MaterialAssignmentSection plain />
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
