import { useAppStore } from "../store/app-store";
import { EditCanvas } from "./EditCanvas";
import { ResultCanvas } from "./ResultCanvas";

export function SlopeCanvas() {
  const mode = useAppStore((s) => s.mode);
  return mode === "result" ? <ResultCanvas /> : <EditCanvas />;
}
