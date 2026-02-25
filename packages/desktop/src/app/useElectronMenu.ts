import { useEffect } from "react";
import { isElectron } from "../utils/is-electron";
import { useAppStore } from "../store/app-store";
import { parseProjectFile, serializeProject } from "../store/persistence";

/**
 * Listens for native Electron menu events and dispatches the
 * corresponding store actions. Must be mounted once in the component
 * tree (e.g. inside AppShell).
 */
export function useElectronMenu() {
  useEffect(() => {
    if (!isElectron) return;

    const onNew = () => {
      useAppStore.getState().newProject();
    };

    const onOpen = async () => {
      const contents = await window.cslope.openFile();
      if (!contents) return;
      try {
        const parsed = parseProjectFile(contents);
        useAppStore.getState().loadProject(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Unable to open project: ${message}`);
      }
    };

    const onSave = async () => {
      const store = useAppStore.getState();
      store.saveCurrentModel();
      const snapshot = serializeProject(useAppStore.getState());
      const json = JSON.stringify(snapshot, null, 2);
      await window.cslope.saveFile(json);
    };

    const onSaveAs = async () => {
      const store = useAppStore.getState();
      store.saveCurrentModel();
      const snapshot = serializeProject(useAppStore.getState());
      const json = JSON.stringify(snapshot, null, 2);
      await window.cslope.saveFileAs(json);
    };

    const onLoadBenchmarks = () => {
      useAppStore.getState().loadBenchmarks();
    };

    window.ipcRenderer.on("menu:new", onNew);
    window.ipcRenderer.on("menu:open", onOpen);
    window.ipcRenderer.on("menu:save", onSave);
    window.ipcRenderer.on("menu:saveAs", onSaveAs);
    window.ipcRenderer.on("menu:loadBenchmarks", onLoadBenchmarks);

    return () => {
      window.ipcRenderer.off("menu:new", onNew);
      window.ipcRenderer.off("menu:open", onOpen);
      window.ipcRenderer.off("menu:save", onSave);
      window.ipcRenderer.off("menu:saveAs", onSaveAs);
      window.ipcRenderer.off("menu:loadBenchmarks", onLoadBenchmarks);
    };
  }, []);
}
