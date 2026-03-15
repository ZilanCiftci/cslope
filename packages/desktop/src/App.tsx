import { useEffect, useRef } from "react";
import { AppShell } from "./AppShell";
import { isElectron } from "./utils/is-electron";
import { MaterialsDialogApp } from "./features/properties/MaterialsDialogApp";
import { MaterialAssignmentDialogApp } from "./features/properties/MaterialAssignmentDialogApp";
import { GeometryDialogApp } from "./features/properties/GeometryDialogApp";
import { InteriorBoundariesDialogApp } from "./features/properties/InteriorBoundariesDialogApp";
import { UdlDialogApp } from "./features/properties/UdlDialogApp";
import { LineLoadsDialogApp } from "./features/properties/LineLoadsDialogApp";
import { PiezoDialogApp } from "./features/properties/PiezoDialogApp";
import { useAppStore } from "./store/app-store";
import type {
  LineLoadRow,
  MaterialBoundaryRow,
  MaterialRow,
  PiezometricLineState,
  RegionMaterials,
  UdlRow,
} from "./store/types";

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
}

interface PiezoStatePayload {
  piezometricLine: PiezometricLineState;
  coordinates: [number, number][];
  materials: MaterialRow[];
}

function App() {
  const setMaterials = useAppStore((s) => s.setMaterials);
  const setRegionMaterials = useAppStore((s) => s.setRegionMaterials);
  const setInteriorBoundariesDialogOpen = useAppStore(
    (s) => s.setInteriorBoundariesDialogOpen,
  );
  const coordinates = useAppStore((s) => s.coordinates);
  const materials = useAppStore((s) => s.materials);
  const materialBoundaries = useAppStore((s) => s.materialBoundaries);
  const regionMaterials = useAppStore((s) => s.regionMaterials);
  const udls = useAppStore((s) => s.udls);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const piezometricLine = useAppStore((s) => s.piezometricLine);
  const selectedMaterialBoundaryId = useAppStore(
    (s) => s.selectedMaterialBoundaryId,
  );
  const isMaterialsDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "materials-dialog";
  const isMaterialAssignmentDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "material-assignment-dialog";
  const isGeometryDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "geometry-dialog";
  const isInteriorBoundariesDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "interior-boundaries-dialog";
  const isUdlDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "udl-dialog";
  const isLineLoadsDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "line-loads-dialog";
  const isPiezoDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "piezo-dialog";
  const suppressNextGeometryBroadcastRef = useRef(false);
  const suppressNextInteriorBoundariesBroadcastRef = useRef(false);
  const suppressNextLoadsBroadcastRef = useRef(false);
  const suppressNextPiezoBroadcastRef = useRef(false);

  const isAnyDialogWindow =
    isMaterialsDialogWindow ||
    isMaterialAssignmentDialogWindow ||
    isGeometryDialogWindow ||
    isInteriorBoundariesDialogWindow ||
    isUdlDialogWindow ||
    isLineLoadsDialogWindow ||
    isPiezoDialogWindow;

  useEffect(() => {
    // Tell the main process the renderer has mounted so it can
    // close the splash screen and show the main window.
    if (isElectron && !isAnyDialogWindow) {
      window.cslope.appReady();
    }
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleOpenChanged = (_event: unknown, open: boolean) => {
      setInteriorBoundariesDialogOpen(Boolean(open));
    };

    window.cslope.onInteriorBoundariesDialogOpenChanged(handleOpenChanged);

    return () => {
      window.cslope.offInteriorBoundariesDialogOpenChanged(handleOpenChanged);
      setInteriorBoundariesDialogOpen(false);
    };
  }, [isAnyDialogWindow, setInteriorBoundariesDialogOpen]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleMaterialsRequestState = () => {
      window.cslope.sendMaterialsState(useAppStore.getState().materials);
    };

    const handleMaterialsChanged = (_event: unknown, next: MaterialRow[]) => {
      setMaterials(next);
    };

    window.cslope.onMaterialsRequestState(handleMaterialsRequestState);
    window.cslope.onMaterialsChanged(handleMaterialsChanged);

    return () => {
      window.cslope.offMaterialsRequestState(handleMaterialsRequestState);
      window.cslope.offMaterialsChanged(handleMaterialsChanged);
    };
  }, [isAnyDialogWindow, setMaterials]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleAssignmentRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendMaterialAssignmentState({
        coordinates: state.coordinates,
        materialBoundaries: state.materialBoundaries,
        regionMaterials: state.regionMaterials,
        materials: state.materials,
      });
    };

    const handleAssignmentChanged = (
      _event: unknown,
      next: { regionMaterials: RegionMaterials },
    ) => {
      setRegionMaterials(next.regionMaterials);
    };

    window.cslope.onMaterialAssignmentRequestState(
      handleAssignmentRequestState,
    );
    window.cslope.onMaterialAssignmentChanged(handleAssignmentChanged);

    return () => {
      window.cslope.offMaterialAssignmentRequestState(
        handleAssignmentRequestState,
      );
      window.cslope.offMaterialAssignmentChanged(handleAssignmentChanged);
    };
  }, [isAnyDialogWindow, setRegionMaterials]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    window.cslope.sendMaterialAssignmentChanged({
      coordinates,
      materialBoundaries,
      regionMaterials,
      materials,
    });
  }, [
    coordinates,
    materialBoundaries,
    regionMaterials,
    materials,
    isAnyDialogWindow,
  ]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleGeometryRequestState = () => {
      window.cslope.sendGeometryState({
        coordinates: useAppStore.getState().coordinates,
      });
    };

    const handleGeometryChanged = (
      _event: unknown,
      next: { coordinates: [number, number][] },
    ) => {
      suppressNextGeometryBroadcastRef.current = true;
      useAppStore.getState().setCoordinates(next.coordinates);
    };

    window.cslope.onGeometryRequestState(handleGeometryRequestState);
    window.cslope.onGeometryChanged(handleGeometryChanged);

    return () => {
      window.cslope.offGeometryRequestState(handleGeometryRequestState);
      window.cslope.offGeometryChanged(handleGeometryChanged);
    };
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    if (suppressNextGeometryBroadcastRef.current) {
      suppressNextGeometryBroadcastRef.current = false;
      return;
    }

    window.cslope.sendGeometryChanged({ coordinates });
  }, [coordinates, isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleInteriorBoundariesRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendInteriorBoundariesState({
        coordinates: state.coordinates,
        materialBoundaries: state.materialBoundaries,
        selectedMaterialBoundaryId: state.selectedMaterialBoundaryId,
      });
    };

    const handleInteriorBoundariesChanged = (
      _event: unknown,
      next: {
        coordinates: [number, number][];
        materialBoundaries: MaterialBoundaryRow[];
        selectedMaterialBoundaryId: string | null;
      },
    ) => {
      suppressNextInteriorBoundariesBroadcastRef.current = true;
      useAppStore.setState({
        coordinates: next.coordinates,
        materialBoundaries: next.materialBoundaries,
        selectedMaterialBoundaryId: next.selectedMaterialBoundaryId,
      });
    };

    window.cslope.onInteriorBoundariesRequestState(
      handleInteriorBoundariesRequestState,
    );
    window.cslope.onInteriorBoundariesChanged(handleInteriorBoundariesChanged);

    return () => {
      window.cslope.offInteriorBoundariesRequestState(
        handleInteriorBoundariesRequestState,
      );
      window.cslope.offInteriorBoundariesChanged(
        handleInteriorBoundariesChanged,
      );
    };
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    if (suppressNextInteriorBoundariesBroadcastRef.current) {
      suppressNextInteriorBoundariesBroadcastRef.current = false;
      return;
    }

    window.cslope.sendInteriorBoundariesChanged({
      coordinates,
      materialBoundaries,
      selectedMaterialBoundaryId,
    });
  }, [
    coordinates,
    materialBoundaries,
    selectedMaterialBoundaryId,
    isAnyDialogWindow,
  ]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleLoadsRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendLoadsState({
        udls: state.udls,
        lineLoads: state.lineLoads,
      });
    };

    const handleLoadsChanged = (_event: unknown, next: LoadsStatePayload) => {
      suppressNextLoadsBroadcastRef.current = true;
      useAppStore.setState({
        udls: next.udls,
        lineLoads: next.lineLoads,
      });
    };

    window.cslope.onLoadsRequestState(handleLoadsRequestState);
    window.cslope.onLoadsChanged(handleLoadsChanged);

    return () => {
      window.cslope.offLoadsRequestState(handleLoadsRequestState);
      window.cslope.offLoadsChanged(handleLoadsChanged);
    };
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    if (suppressNextLoadsBroadcastRef.current) {
      suppressNextLoadsBroadcastRef.current = false;
      return;
    }

    window.cslope.sendLoadsChanged({ udls, lineLoads });
  }, [udls, lineLoads, isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handlePiezoRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendPiezoState({
        piezometricLine: state.piezometricLine,
        coordinates: state.coordinates,
        materials: state.materials,
      });
    };

    const handlePiezoChanged = (_event: unknown, next: PiezoStatePayload) => {
      suppressNextPiezoBroadcastRef.current = true;
      useAppStore.setState({
        piezometricLine: next.piezometricLine,
        coordinates: next.coordinates,
        materials: next.materials,
      });
    };

    window.cslope.onPiezoRequestState(handlePiezoRequestState);
    window.cslope.onPiezoChanged(handlePiezoChanged);

    return () => {
      window.cslope.offPiezoRequestState(handlePiezoRequestState);
      window.cslope.offPiezoChanged(handlePiezoChanged);
    };
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    if (suppressNextPiezoBroadcastRef.current) {
      suppressNextPiezoBroadcastRef.current = false;
      return;
    }

    window.cslope.sendPiezoChanged({ piezometricLine, coordinates, materials });
  }, [piezometricLine, coordinates, materials, isAnyDialogWindow]);

  if (isMaterialsDialogWindow) {
    return <MaterialsDialogApp />;
  }

  if (isMaterialAssignmentDialogWindow) {
    return <MaterialAssignmentDialogApp />;
  }

  if (isGeometryDialogWindow) {
    return <GeometryDialogApp />;
  }

  if (isInteriorBoundariesDialogWindow) {
    return <InteriorBoundariesDialogApp />;
  }

  if (isUdlDialogWindow) {
    return <UdlDialogApp />;
  }

  if (isLineLoadsDialogWindow) {
    return <LineLoadsDialogApp />;
  }

  if (isPiezoDialogWindow) {
    return <PiezoDialogApp />;
  }

  return <AppShell />;
}

export default App;
