import { useEffect, useState } from "react";
import { ActivityBar } from "./components/ActivityBar";
import { StatusBar } from "./components/StatusBar";
import { MenuBar } from "./components/ui/ribbon/MenuBar";
import { TabBar } from "./components/TabBar";
import { TitleBar } from "./components/TitleBar";
import {
  Explorer,
  EditCanvas,
  PropertiesPanel,
  ResizablePanel,
  ResultCanvas,
  ResultSidebar,
} from "./components";
import { useAppStore } from "./store/app-store";
import { useDragDrop } from "./features/canvas/hooks/useDragDrop";

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

  const activeModel = models.find((m) => m.id === activeModelId);

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
        canvasToolbar={canvasToolbar}
      />

      <TabBar
        mode={mode}
        setMode={setMode}
        runState={runState}
        hasResult={Boolean(result)}
        onRun={handleRunAndSwitch}
        onCancel={cancelAnalysis}
        onRunAll={handleRunAll}
        onReset={handleReset}
        onResetAll={handleResetAll}
      />

      <div className="flex flex-1 min-h-0">
        <ActivityBar
          explorerOpen={explorerOpen}
          propertiesOpen={sidebarOpen}
          explorerLocation={explorerLocation}
          propertiesLocation={propertiesLocation}
          onToggleExplorer={toggleExplorer}
          onToggleProperties={toggleSidebar}
          onToggleExplorerLocation={() =>
            setExplorerLocation(explorerLocation === "left" ? "right" : "left")
          }
          onTogglePropertiesLocation={() =>
            setPropertiesLocation(
              propertiesLocation === "left" ? "right" : "left",
            )
          }
        />

        {explorerOpen && explorerLocation === "left" && (
          <ResizablePanel
            width={explorerWidth}
            onResize={setExplorerWidth}
            position="left"
          >
            <Explorer />
          </ResizablePanel>
        )}
        {sidebarOpen && propertiesLocation === "left" && (
          <ResizablePanel
            width={propertiesWidth}
            onResize={setPropertiesWidth}
            position="left"
          >
            {mode === "result" ? <ResultSidebar /> : <PropertiesPanel />}
          </ResizablePanel>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            {mode === "result" ? <ResultCanvas /> : <EditCanvas />}
          </div>
        </div>

        {sidebarOpen && propertiesLocation === "right" && (
          <ResizablePanel
            width={propertiesWidth}
            onResize={setPropertiesWidth}
            position="right"
          >
            {mode === "result" ? <ResultSidebar /> : <PropertiesPanel />}
          </ResizablePanel>
        )}
        {explorerOpen && explorerLocation === "right" && (
          <ResizablePanel
            width={explorerWidth}
            onResize={setExplorerWidth}
            position="right"
          >
            <Explorer />
          </ResizablePanel>
        )}
      </div>

      <StatusBar
        mode={mode}
        runState={runState}
        result={result}
        snapToGrid={snapToGrid}
        gridSnapSize={gridSnapSize}
        setSnapToGrid={setSnapToGrid}
        setGridSnapSize={setGridSnapSize}
        coordinateCount={coordinateCount}
        cursorWorld={cursorWorld}
      />
    </div>
  );
}
