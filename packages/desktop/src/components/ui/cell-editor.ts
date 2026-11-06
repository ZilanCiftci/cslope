import type { CSSProperties } from "react";

/** Classes of an editor in a table cell: 22 px high in the 24 px row, the accent border inside the cell on focus. */
export const CELL_EDITOR_CLASS =
  "block w-full h-[22px] my-px py-0 px-2 text-[11px] leading-4 outline-none border border-transparent focus:border-[var(--color-vsc-accent)]";

/** Inline style of a cell editor (no own corners, shadow or margin). */
export const cellEditorStyle: CSSProperties = {
  background: "var(--color-vsc-input-bg)",
  color: "var(--color-vsc-text)",
  borderRadius: 0,
  boxShadow: "none",
};
