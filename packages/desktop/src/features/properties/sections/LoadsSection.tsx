import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";

export function LoadsSection() {
  const udls = useAppStore((s) => s.udls);
  const addUdl = useAppStore((s) => s.addUdl);
  const updateUdl = useAppStore((s) => s.updateUdl);
  const removeUdl = useAppStore((s) => s.removeUdl);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const addLineLoad = useAppStore((s) => s.addLineLoad);
  const updateLineLoad = useAppStore((s) => s.updateLineLoad);
  const removeLineLoad = useAppStore((s) => s.removeLineLoad);

  return (
    <Section title="Loads">
      <div
        className="text-[10px] font-bold uppercase tracking-[0.1em] mb-1.5"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        UDL (kPa)
      </div>
      {udls.map((u) => (
        <div key={u.id} className="flex items-end gap-1 text-[12px]">
          <label className="flex flex-col">
            <Label>q</Label>
            <input
              type="number"
              step="1"
              value={u.magnitude}
              onChange={(e) =>
                updateUdl(u.id, { magnitude: parseFloat(e.target.value) || 0 })
              }
              className="w-14"
              aria-label="UDL magnitude"
            />
          </label>
          <label className="flex flex-col">
            <Label>x₁</Label>
            <input
              type="number"
              step="0.5"
              value={u.x1}
              onChange={(e) =>
                updateUdl(u.id, { x1: parseFloat(e.target.value) || 0 })
              }
              className="w-14"
              aria-label="UDL x1"
            />
          </label>
          <label className="flex flex-col">
            <Label>x₂</Label>
            <input
              type="number"
              step="0.5"
              value={u.x2}
              onChange={(e) =>
                updateUdl(u.id, { x2: parseFloat(e.target.value) || 0 })
              }
              className="w-14"
              aria-label="UDL x2"
            />
          </label>
          <button
            onClick={() => removeUdl(u.id)}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
            style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}
            aria-label="Remove UDL"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={addUdl}
        className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        + Add UDL
      </button>

      <div
        className="text-[10px] font-bold uppercase tracking-[0.1em] mt-3 mb-1.5"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Line Load (kN/m)
      </div>
      {lineLoads.map((l) => (
        <div key={l.id} className="flex items-end gap-1 text-[12px]">
          <label className="flex flex-col">
            <Label>P</Label>
            <input
              type="number"
              step="1"
              value={l.magnitude}
              onChange={(e) =>
                updateLineLoad(l.id, {
                  magnitude: parseFloat(e.target.value) || 0,
                })
              }
              className="w-14"
              aria-label="Line load magnitude"
            />
          </label>
          <label className="flex flex-col">
            <Label>x</Label>
            <input
              type="number"
              step="0.5"
              value={l.x}
              onChange={(e) =>
                updateLineLoad(l.id, { x: parseFloat(e.target.value) || 0 })
              }
              className="w-14"
              aria-label="Line load x"
            />
          </label>
          <button
            onClick={() => removeLineLoad(l.id)}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
            style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}
            aria-label="Remove line load"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={addLineLoad}
        className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        + Add Line Load
      </button>
    </Section>
  );
}
