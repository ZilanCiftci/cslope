import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import { CollapsedPanelStrip } from "./components/SidePanelChrome";
import { StatusBar } from "./components/StatusBar";
import { MenuBar } from "./components/ui/ribbon/MenuBar";
import { FloatingToolbar } from "./components/ui/FloatingToolbar";
import { TitleBar } from "./components/TitleBar";
import {
  Explorer,
  EditCanvas,
  ResizablePanel,
  ResultCanvas,
  ResultSidebar,
} from "./components";
import {
  isProjectDirty,
  performRedo,
  performUndo,
  useAppStore,
} from "./store/app-store";
import { confirmUnsavedChanges } from "./features/project/unsavedGuard";
import { isElectron } from "./utils/is-electron";
import { useDragDrop } from "./features/canvas/hooks/useDragDrop";
import { AnalysisErrorBanner } from "./features/analysis/AnalysisErrorBanner";
import { SelectionStatus } from "./features/canvas/SelectionStatus";
import { useRunShortcut } from "./features/analysis/run-shortcut";

export function AppShell() {
  useDragDrop();
  const explorerLocation = useAppStore((s) => s.explorerLocation);
  const propertiesLocation = useAppStore((s) => s.propertiesLocation);
  const setExplorerLocation = useAppStore((s) => s.setExplorerLocation);
  const setPropertiesLocation = useAppStore((s) => s.setPropertiesLocation);

  const [explorerWidth, setExplorerWidth] = useState(250);
  const [propertiesWidth, setPropertiesWidth] = useState(280);

  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const explorerOpen = useAppStore((s) => s.explorerOpen);
  const toggleExplorer = useAppStore((s) => s.toggleExplorer);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const runState = useAppStore((s) => s.runState);
  const runAnalysis = useAppStore((s) => s.runAnalysis);
  const cancelAnalysis = useAppStore((s) => s.cancelAnalysis);
  const result = useAppStore((s) => s.result);
  const runAll = useAppStore((s) => s.runAll);
  const runStage = useAppStore((s) => s.runStage);
  const runStartedAt = useAppStore((s) => s.runStartedAt);
  const designValues = useAppStore((s) => !!s.options.partialFactors);
  const models = useAppStore((s) => s.models);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const snapToGrid = useAppStore((s) => s.snapToGrid);
  const gridSnapSize = useAppStore((s) => s.gridSnapSize);
  const setSnapToGrid = useAppStore((s) => s.setSnapToGrid);
  const setGridSnapSize = useAppStore((s) => s.setGridSnapSize);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const coordinateCount = useAppStore((s) => s.coordinates.length);
  const cursorWorld = useAppStore((s) => s.cursorWorld);
  const runAllAnalyses = useAppStore((s) => s.runAllAnalyses);
  const invalidateAnalysis = useAppStore((s) => s.invalidateAnalysis);
  const resetAllAnalyses = useAppStore((s) => s.resetAllAnalyses);
  const canvasToolbar = useAppStore((s) => s.canvasToolbar);

  const canUndo = useStore(
    useAppStore.temporal,
    (s) => s.pastStates.length > 0,
  );
  const canRedo = useStore(
    useAppStore.temporal,
    (s) => s.futureStates.length > 0,
  );

  const activeModel = models.find((m) => m.id === activeModelId);

  // Unsaved changes: Electron asks before closing the window; a browser
  // shows its own "leave site?" prompt.
  useEffect(() => {
    if (!isElectron) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (!isProjectDirty(useAppStore.getState())) return;
        e.preventDefault();
        e.returnValue = "";
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }
    let asking = false;
    const unsubscribe = window.cslope.onCloseRequested(async () => {
      if (asking) return;
      asking = true;
      try {
        if (await confirmUnsavedChanges()) window.cslope.confirmClose();
      } finally {
        asking = false;
      }
    });
    window.cslope.closeGuardReady();
    return () => {
      unsubscribe();
      window.cslope.closeGuardReleased();
    };
  }, []);

  useEffect(() => {
    const blockCtrlWheel = (evt: WheelEvent) => {
      if (evt.ctrlKey) {
        evt.preventDefault();
      }
    };
    const addOptions: AddEventListenerOptions = {
      passive: false,
      capture: true,
    };
    const removeOptions: EventListenerOptions = { capture: true };
    window.addEventListener("wheel", blockCtrlWheel, {
      ...addOptions,
    });
    return () =>
      window.removeEventListener("wheel", blockCtrlWheel, removeOptions);
  }, []);

  const handleRunAndSwitch = () => {
    runAnalysis();
    setMode("result");
  };

  // F5 / Ctrl+Enter: the toolbar's Run, unless a run is going on.
  useRunShortcut(
    useCallback(() => {
      const s = useAppStore.getState();
      if (s.runState === "running") return;
      s.runAnalysis();
      s.setMode("result");
    }, []),
  );

  const handleRunAll = () => {
    void runAllAnalyses();
    setMode("result");
  };

  const handleReset = () => {
    invalidateAnalysis();
    setMode("edit");
  };

  const handleResetAll = () => {
    resetAllAnalyses();
  };

  const moveExplorer = () =>
    setExplorerLocation(explorerLocation === "left" ? "right" : "left");
  const moveProperties = () =>
    setPropertiesLocation(propertiesLocation === "left" ? "right" : "left");

  // Each side panel is either open (resizable, with a collapse button in
  // its header row) or a narrow strip at the window edge that opens it.
  const explorerPanel = (side: "left" | "right") =>
    explorerOpen ? (
      <ResizablePanel
        width={explorerWidth}
        onResize={setExplorerWidth}
        onCollapse={toggleExplorer}
        position={side}
      >
        <Explorer />
      </ResizablePanel>
    ) : (
      <CollapsedPanelStrip
        side={side}
        label="Models"
        onOpen={toggleExplorer}
        onMove={moveExplorer}
      />
    );
  const propertiesPanel = (side: "left" | "right") =>
    sidebarOpen ? (
      <ResizablePanel
        width={propertiesWidth}
        onResize={setPropertiesWidth}
        onCollapse={toggleSidebar}
        position={side}
      >
        <ResultSidebar />
      </ResizablePanel>
    ) : (
      <CollapsedPanelStrip
        side={side}
        label="Results"
        onOpen={toggleSidebar}
        onMove={moveProperties}
      />
    );

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: "var(--color-vsc-bg)" }}
    >
      <TitleBar
        theme={theme}
        onToggleTheme={toggleTheme}
        activeModelName={activeModel?.name}
      />

      <MenuBar
        activeModelName={activeModel?.name}
      />

      <div className="flex flex-1 min-h-0">
        {explorerLocation === "left" && explorerPanel("left")}
        {mode === "result" && propertiesLocation === "left" && propertiesPanel("left")}

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            {mode === "result" ? <ResultCanvas /> : <EditCanvas />}
            <AnalysisErrorBanner />
            <FloatingToolbar
              mode={mode}
              setMode={setMode}
              runState={runState}
              hasResult={Boolean(result)}
              onRun={handleRunAndSwitch}
              onCancel={cancelAnalysis}
              onRunAll={handleRunAll}
              onReset={handleReset}
              onResetAll={handleResetAll}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={performUndo}
              onRedo={performRedo}
              canvasToolbar={canvasToolbar}
            />
          </div>
        </div>

        {mode === "result" && propertiesLocation === "right" && propertiesPanel("right")}
        {explorerLocation === "right" && explorerPanel("right")}
      </div>

      <StatusBar
        mode={mode}
        runState={runState}
        result={result}
        designValues={designValues}
        runStage={runStage}
        runStartedAt={runStartedAt}
        snapToGrid={snapToGrid}
        gridSnapSize={gridSnapSize}
        setSnapToGrid={setSnapToGrid}
        setGridSnapSize={setGridSnapSize}
        coordinateCount={coordinateCount}
        cursorWorld={cursorWorld}
        runAll={runAll}
        selectionStatus={<SelectionStatus />}
      />
    </div>
  );
}
