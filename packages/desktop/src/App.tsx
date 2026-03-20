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
import { ParametersDialogApp } from "./features/properties/ParametersDialogApp";
import { ResultsPlotDialogApp } from "./features/properties/ResultsPlotDialogApp";
import { SearchLimitsDialogApp } from "./features/properties/SearchLimitsDialogApp";
import { CustomSearchPlanesDialogApp } from "./features/properties/CustomSearchPlanesDialogApp";
import { OptionsDialogApp } from "./features/properties/OptionsDialogApp";
import { ViewSettingsDialogApp } from "./features/properties/ViewSettingsDialogApp";
import { useAppStore } from "./store/app-store";
import type {
  AnalysisLimitsState,
  AnalysisResult,
  CustomSearchPlane,
  LineLoadRow,
  MaterialBoundaryRow,
  MaterialRow,
  ModelEntry,
  ModelOrientation,
  PiezometricLineState,
  ParameterDef,
  RegionMaterials,
  ResultViewSettings,
  UdlRow,
} from "./store/types";

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  parameters?: ParameterDef[];
}

interface PiezoStatePayload {
  piezometricLine: PiezometricLineState;
  coordinates: [number, number][];
  materials: MaterialRow[];
  parameters?: ParameterDef[];
}

interface MaterialsStatePayload {
  materials: MaterialRow[];
  parameters?: ParameterDef[];
}

interface GeometryStatePayload {
  coordinates: [number, number][];
  coordinateExpressions: { x?: string; y?: string }[];
  parameters?: ParameterDef[];
}

interface InteriorBoundariesStatePayload {
  coordinates: [number, number][];
  materialBoundaries: MaterialBoundaryRow[];
  selectedMaterialBoundaryId: string | null;
  parameters?: ParameterDef[];
}

interface ResultsPlotStatePayload {
  model: ModelEntry;
  result: AnalysisResult | null;
}

interface ParametersStatePayload {
  parameters: ParameterDef[];
}

interface AnalysisStatePayload {
  coordinates: [number, number][];
  orientation: ModelOrientation;
  analysisLimits: AnalysisLimitsState;
  customSearchPlanes: CustomSearchPlane[];
  customPlanesOnly: boolean;
  options: ModelEntry["options"];
}

interface ViewSettingsStatePayload {
  resultViewSettings: ResultViewSettings;
  coordinates: [number, number][];
  resultViewScale: number;
  resultViewOffset: [number, number];
}

function normalizeMaterialsPayload(
  payload: MaterialsStatePayload | MaterialRow[],
): MaterialsStatePayload {
  if (Array.isArray(payload)) {
    return { materials: payload };
  }
  return payload;
}

function normalizeLoadsPayload(
  payload: LoadsStatePayload | null | undefined,
): LoadsStatePayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!Array.isArray(payload.udls) || !Array.isArray(payload.lineLoads)) {
    return null;
  }
  return payload;
}

function normalizePiezoPayload(
  payload: PiezoStatePayload | null | undefined,
): PiezoStatePayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (
    !payload.piezometricLine ||
    !Array.isArray(payload.coordinates) ||
    !Array.isArray(payload.materials)
  ) {
    return null;
  }
  return payload;
}

function buildResultsPlotPayloadFromState(): ResultsPlotStatePayload {
  const state = useAppStore.getState();
  const activeModelName =
    state.models.find((m) => m.id === state.activeModelId)?.name ??
    "Active model";

  return {
    model: {
      id: state.activeModelId,
      name: activeModelName,
      orientation: state.orientation,
      coordinates: state.coordinates,
      materials: state.materials,
      materialBoundaries: state.materialBoundaries,
      regionMaterials: state.regionMaterials,
      piezometricLine: state.piezometricLine,
      udls: state.udls,
      lineLoads: state.lineLoads,
      customSearchPlanes: state.customSearchPlanes,
      customPlanesOnly: state.customPlanesOnly,
      options: state.options,
      analysisLimits: state.analysisLimits,
    },
    result: state.result,
  };
}

function App() {
  const setMaterials = useAppStore((s) => s.setMaterials);
  const setRegionMaterials = useAppStore((s) => s.setRegionMaterials);
  const setInteriorBoundariesDialogOpen = useAppStore(
    (s) => s.setInteriorBoundariesDialogOpen,
  );
  const coordinates = useAppStore((s) => s.coordinates);
  const coordinateExpressions = useAppStore((s) => s.coordinateExpressions);
  const materials = useAppStore((s) => s.materials);
  const materialBoundaries = useAppStore((s) => s.materialBoundaries);
  const regionMaterials = useAppStore((s) => s.regionMaterials);
  const udls = useAppStore((s) => s.udls);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const piezometricLine = useAppStore((s) => s.piezometricLine);
  const parameters = useAppStore((s) => s.parameters);
  const orientation = useAppStore((s) => s.orientation);
  const customSearchPlanes = useAppStore((s) => s.customSearchPlanes);
  const customPlanesOnly = useAppStore((s) => s.customPlanesOnly);
  const options = useAppStore((s) => s.options);
  const analysisLimits = useAppStore((s) => s.analysisLimits);
  const resultViewSettings = useAppStore((s) => s.resultViewSettings);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const models = useAppStore((s) => s.models);
  const result = useAppStore((s) => s.result);
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
  const isParametersDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "parameters-dialog";
  const isResultsPlotDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "results-plot-dialog";
  const isSearchLimitsDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "search-limits-dialog";
  const isCustomSearchPlanesDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "custom-search-planes-dialog";
  const isOptionsDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "options-dialog";
  const isViewSettingsDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "view-settings-dialog";
  const suppressNextGeometryBroadcastRef = useRef(false);
  const suppressNextMaterialAssignmentBroadcastRef = useRef(false);
  const suppressNextInteriorBoundariesBroadcastRef = useRef(false);
  const suppressNextLoadsBroadcastRef = useRef(false);
  const suppressNextPiezoBroadcastRef = useRef(false);
  const suppressNextParametersBroadcastRef = useRef(false);
  const suppressNextAnalysisBroadcastRef = useRef(false);
  const suppressNextViewSettingsBroadcastRef = useRef(false);

  const isAnyDialogWindow =
    isMaterialsDialogWindow ||
    isMaterialAssignmentDialogWindow ||
    isGeometryDialogWindow ||
    isInteriorBoundariesDialogWindow ||
    isUdlDialogWindow ||
    isLineLoadsDialogWindow ||
    isPiezoDialogWindow ||
    isParametersDialogWindow ||
    isResultsPlotDialogWindow ||
    isSearchLimitsDialogWindow ||
    isCustomSearchPlanesDialogWindow ||
    isOptionsDialogWindow ||
    isViewSettingsDialogWindow;

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
      const state = useAppStore.getState();
      window.cslope.sendMaterialsState({
        materials: state.materials,
        parameters: state.parameters,
      });
    };

    const handleMaterialsChanged = (
      _event: unknown,
      raw: MaterialsStatePayload | MaterialRow[],
    ) => {
      const next = normalizeMaterialsPayload(raw);
      setMaterials(next.materials);
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
      suppressNextMaterialAssignmentBroadcastRef.current = true;
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

    if (suppressNextMaterialAssignmentBroadcastRef.current) {
      suppressNextMaterialAssignmentBroadcastRef.current = false;
      return;
    }

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
      const state = useAppStore.getState();
      window.cslope.sendGeometryState({
        coordinates: state.coordinates,
        coordinateExpressions: state.coordinateExpressions,
        parameters: state.parameters,
      });
    };

    const handleGeometryChanged = (
      _event: unknown,
      next: GeometryStatePayload,
    ) => {
      suppressNextGeometryBroadcastRef.current = true;
      useAppStore.setState({
        coordinates: next.coordinates,
        coordinateExpressions: next.coordinateExpressions,
      });
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

    window.cslope.sendGeometryChanged({
      coordinates,
      coordinateExpressions,
      parameters,
    });
  }, [coordinates, coordinateExpressions, parameters, isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleInteriorBoundariesRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendInteriorBoundariesState({
        coordinates: state.coordinates,
        materialBoundaries: state.materialBoundaries,
        selectedMaterialBoundaryId: state.selectedMaterialBoundaryId,
        parameters: state.parameters,
      });
    };

    const handleInteriorBoundariesChanged = (
      _event: unknown,
      next: InteriorBoundariesStatePayload,
    ) => {
      suppressNextInteriorBoundariesBroadcastRef.current = true;
      const patch: {
        coordinates: [number, number][];
        materialBoundaries: MaterialBoundaryRow[];
        selectedMaterialBoundaryId: string | null;
        parameters?: ParameterDef[];
      } = {
        coordinates: next.coordinates,
        materialBoundaries: next.materialBoundaries,
        selectedMaterialBoundaryId: next.selectedMaterialBoundaryId,
      };

      if (Array.isArray(next.parameters)) {
        patch.parameters = next.parameters;
      }

      useAppStore.setState(patch);
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
      parameters,
    });
  }, [
    coordinates,
    materialBoundaries,
    selectedMaterialBoundaryId,
    parameters,
    isAnyDialogWindow,
  ]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleLoadsRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendLoadsState({
        udls: state.udls,
        lineLoads: state.lineLoads,
        parameters: state.parameters,
      });
    };

    const handleLoadsChanged = (_event: unknown, next: LoadsStatePayload) => {
      const normalized = normalizeLoadsPayload(next);
      if (!normalized) return;
      suppressNextLoadsBroadcastRef.current = true;
      const patch: {
        udls: UdlRow[];
        lineLoads: LineLoadRow[];
        parameters?: ParameterDef[];
      } = {
        udls: normalized.udls,
        lineLoads: normalized.lineLoads,
      };

      if (Array.isArray(normalized.parameters)) {
        patch.parameters = normalized.parameters;
      }

      useAppStore.setState(patch);
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

    window.cslope.sendLoadsChanged({ udls, lineLoads, parameters });
  }, [udls, lineLoads, parameters, isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handlePiezoRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendPiezoState({
        piezometricLine: state.piezometricLine,
        coordinates: state.coordinates,
        materials: state.materials,
        parameters: state.parameters,
      });
    };

    const handlePiezoChanged = (_event: unknown, next: PiezoStatePayload) => {
      const normalized = normalizePiezoPayload(next);
      if (!normalized) return;
      suppressNextPiezoBroadcastRef.current = true;
      const patch: {
        piezometricLine: PiezometricLineState;
        coordinates: [number, number][];
        materials: MaterialRow[];
        parameters?: ParameterDef[];
      } = {
        piezometricLine: normalized.piezometricLine,
        coordinates: normalized.coordinates,
        materials: normalized.materials,
      };

      if (Array.isArray(normalized.parameters)) {
        patch.parameters = normalized.parameters;
      }

      useAppStore.setState(patch);
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

    window.cslope.sendPiezoChanged({
      piezometricLine,
      coordinates,
      materials,
      parameters,
    });
  }, [piezometricLine, coordinates, materials, parameters, isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleParametersRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendParametersState({
        parameters: state.parameters,
      });
    };

    const handleParametersChanged = (
      _event: unknown,
      next: ParametersStatePayload,
    ) => {
      suppressNextParametersBroadcastRef.current = true;
      useAppStore.getState().setParameters(next.parameters);
    };

    window.cslope.onParametersRequestState(handleParametersRequestState);
    window.cslope.onParametersChanged(handleParametersChanged);

    return () => {
      window.cslope.offParametersRequestState(handleParametersRequestState);
      window.cslope.offParametersChanged(handleParametersChanged);
    };
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    if (suppressNextParametersBroadcastRef.current) {
      suppressNextParametersBroadcastRef.current = false;
      return;
    }

    window.cslope.sendParametersChanged({ parameters });
  }, [parameters, isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleAnalysisRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendAnalysisState({
        coordinates: state.coordinates,
        orientation: state.orientation,
        analysisLimits: state.analysisLimits,
        customSearchPlanes: state.customSearchPlanes,
        customPlanesOnly: state.customPlanesOnly,
        options: state.options,
      });
    };

    const handleAnalysisChanged = (
      _event: unknown,
      next: AnalysisStatePayload,
    ) => {
      suppressNextAnalysisBroadcastRef.current = true;
      useAppStore.setState({
        coordinates: next.coordinates,
        orientation: next.orientation,
        analysisLimits: next.analysisLimits,
        customSearchPlanes: next.customSearchPlanes,
        customPlanesOnly: next.customPlanesOnly,
        options: next.options,
      });
    };

    window.cslope.onAnalysisRequestState(handleAnalysisRequestState);
    window.cslope.onAnalysisChanged(handleAnalysisChanged);

    return () => {
      window.cslope.offAnalysisRequestState(handleAnalysisRequestState);
      window.cslope.offAnalysisChanged(handleAnalysisChanged);
    };
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    if (suppressNextAnalysisBroadcastRef.current) {
      suppressNextAnalysisBroadcastRef.current = false;
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
    isAnyDialogWindow,
  ]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleViewSettingsRequestState = () => {
      const state = useAppStore.getState();
      window.cslope.sendViewSettingsState({
        resultViewSettings: state.resultViewSettings,
        coordinates: state.coordinates,
        resultViewScale: state.resultViewScale,
        resultViewOffset: state.resultViewOffset,
      });
    };

    const handleViewSettingsChanged = (
      _event: unknown,
      next: ViewSettingsStatePayload,
    ) => {
      suppressNextViewSettingsBroadcastRef.current = true;
      useAppStore.setState({
        resultViewSettings: next.resultViewSettings,
        coordinates: next.coordinates,
      });
    };

    window.cslope.onViewSettingsRequestState(handleViewSettingsRequestState);
    window.cslope.onViewSettingsChanged(handleViewSettingsChanged);

    return () => {
      window.cslope.offViewSettingsRequestState(handleViewSettingsRequestState);
      window.cslope.offViewSettingsChanged(handleViewSettingsChanged);
    };
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    if (suppressNextViewSettingsBroadcastRef.current) {
      suppressNextViewSettingsBroadcastRef.current = false;
      return;
    }

    window.cslope.sendViewSettingsChanged({
      resultViewSettings,
      coordinates,
      resultViewScale: useAppStore.getState().resultViewScale,
      resultViewOffset: useAppStore.getState().resultViewOffset,
    });
  }, [resultViewSettings, coordinates, isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;

    const handleResultsPlotRequestState = () => {
      window.cslope.sendResultsPlotState(buildResultsPlotPayloadFromState());
    };

    window.cslope.onResultsPlotRequestState(handleResultsPlotRequestState);

    return () => {
      window.cslope.offResultsPlotRequestState(handleResultsPlotRequestState);
    };
  }, [isAnyDialogWindow]);

  useEffect(() => {
    if (!isElectron || isAnyDialogWindow) return;
    window.cslope.sendResultsPlotChanged(buildResultsPlotPayloadFromState());
  }, [
    orientation,
    coordinates,
    materials,
    materialBoundaries,
    regionMaterials,
    piezometricLine,
    udls,
    lineLoads,
    customSearchPlanes,
    customPlanesOnly,
    options,
    analysisLimits,
    activeModelId,
    models,
    result,
    isAnyDialogWindow,
  ]);

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

  if (isParametersDialogWindow) {
    return <ParametersDialogApp />;
  }

  if (isResultsPlotDialogWindow) {
    return <ResultsPlotDialogApp />;
  }

  if (isSearchLimitsDialogWindow) {
    return <SearchLimitsDialogApp />;
  }

  if (isCustomSearchPlanesDialogWindow) {
    return <CustomSearchPlanesDialogApp />;
  }

  if (isOptionsDialogWindow) {
    return <OptionsDialogApp />;
  }

  if (isViewSettingsDialogWindow) {
    return <ViewSettingsDialogApp />;
  }

  return <AppShell />;
}

export default App;
