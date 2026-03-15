import { useEffect } from "react";
import { AppShell } from "./AppShell";
import { isElectron } from "./utils/is-electron";
import { MaterialsDialogApp } from "./features/properties/MaterialsDialogApp";
import { useAppStore } from "./store/app-store";
import type { MaterialRow } from "./store/types";

function App() {
  const setMaterials = useAppStore((s) => s.setMaterials);
  const isMaterialsDialogWindow =
    typeof window !== "undefined" &&
    window.location.hash.replace(/^#/, "") === "materials-dialog";

  useEffect(() => {
    // Tell the main process the renderer has mounted so it can
    // close the splash screen and show the main window.
    if (isElectron && !isMaterialsDialogWindow) {
      window.cslope.appReady();
    }
  }, [isMaterialsDialogWindow]);

  useEffect(() => {
    if (!isElectron || isMaterialsDialogWindow) return;

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
  }, [isMaterialsDialogWindow, setMaterials]);

  if (isMaterialsDialogWindow) {
    return <MaterialsDialogApp />;
  }

  return <AppShell />;
}

export default App;
