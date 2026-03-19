export function PropertiesPanel() {
  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: "var(--color-vsc-sidebar)",
      }}
    >
      <div className="px-3 py-3 text-[12px]">
        <div
          className="font-semibold"
          style={{ color: "var(--color-vsc-text)" }}
        >
          Analysis controls moved
        </div>
        <p
          className="mt-1.5 text-[11px] leading-relaxed"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          Use Model &gt; Analysis in the ribbon to open Search limits, Custom
          search planes, and Options.
        </p>
      </div>
    </div>
  );
}
