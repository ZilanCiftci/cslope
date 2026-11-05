import { useEffect, useRef, useState } from "react";
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
  /** The region selected in the list or on the canvas (highlighted on both). */
  selectedRegionKey?: string | null;
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
  const selectedRegionKey = useAppStore((s) => s.selectedRegionKey);
  const setSelectedRegionKey = useAppStore((s) => s.setSelectedRegionKey);
  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (
      _event: unknown,
      next: MaterialAssignmentStatePayload,
    ) => {
      suppressNextBroadcastRef.current = true;
      setCoordinates(next.coordinates);
      setMaterials(next.materials);
      setMaterialBoundaries(next.materialBoundaries);
      setRegionMaterials(next.regionMaterials);
      if (next.selectedRegionKey !== undefined) setSelectedRegionKey(next.selectedRegionKey);
      setIsHydrated(true);
    };

    const unsubscribeMaterialAssignmentState = window.cslope.onMaterialAssignmentState(applyState);
    const unsubscribeMaterialAssignmentChanged = window.cslope.onMaterialAssignmentChanged(applyState);
    window.cslope.requestMaterialAssignmentState();

    return () => {
      unsubscribeMaterialAssignmentState();
      unsubscribeMaterialAssignmentChanged();
    };
  }, [setCoordinates, setMaterials, setMaterialBoundaries, setRegionMaterials, setSelectedRegionKey]);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }

    window.cslope.sendMaterialAssignmentChanged({
      coordinates,
      materialBoundaries,
      regionMaterials,
      materials,
      selectedRegionKey,
    });
  }, [coordinates, materialBoundaries, regionMaterials, materials, selectedRegionKey, isHydrated]);

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="pb-2">
        <h2 className="text-[12px] font-semibold">Assign materials</h2>
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        <MaterialAssignmentSection plain />
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
