import { FEM_EXPERIMENTAL_NOTE } from "../../constants";

/** A small "Experimental" tag; its tooltip says what that means for the finite element results. */
export function ExperimentalBadge({ title = FEM_EXPERIMENTAL_NOTE }: { title?: string }) {
  return (
    <span
      className="ml-1.5 rounded px-1 py-0 text-[10px] leading-[12px] font-semibold tracking-wide"
      style={{ color: "var(--color-vsc-warning-text)", border: "1px solid var(--color-vsc-warning)" }}
      title={title}
    >
      Experimental
    </span>
  );
}
