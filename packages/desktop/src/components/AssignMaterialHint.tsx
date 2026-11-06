/**
 * "Click a region to assign <material>" over the canvas while a material is
 * being assigned (both canvases). Styled like the other floating things over
 * the canvas: the sidebar colour, a 1 px border, small corners, a shadow,
 * an ordinary Cancel button.
 */
export function AssignMaterialHint({
  name,
  color,
  onCancel,
}: {
  /** The material's name (undefined when it is gone). */
  name: string | undefined;
  /** The material's fill colour (user data). */
  color: string | undefined;
  onCancel: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="assign-material-hint"
      className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-xs text-[12px] select-none whitespace-nowrap"
      style={{
        background: "var(--color-vsc-sidebar)",
        color: "var(--color-vsc-text)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "var(--color-vsc-shadow-float)",
      }}
    >
      <span
        aria-hidden="true"
        className="w-3 h-3 rounded-xs inline-block shrink-0"
        style={{
          background: color ?? "var(--color-vsc-badge)",
          border: "1px solid var(--color-vsc-swatch-border)",
        }}
      />
      <span>
        Click a region to assign <strong>{name ?? "?"}</strong>
      </span>
      <button type="button" className="btn text-[11px]" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
