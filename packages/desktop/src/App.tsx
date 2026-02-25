import { useEffect } from "react";
import { AppShell } from "./app/AppShell";
import { isElectron } from "./utils/is-electron";

function App() {
  useEffect(() => {
    // Tell the main process the renderer has mounted so it can
    // close the splash screen and show the main window.
    if (isElectron) {
      window.ipcRenderer.send("app:ready");
    }
  }, []);

  return <AppShell />;
}

export default App;
