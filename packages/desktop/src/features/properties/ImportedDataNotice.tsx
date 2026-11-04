/**
 * A notice for data imported from a .stix file that the app does not edit
 * (head and reference lines, an earlier construction stage), with a button
 * that removes it.
 */
export function ImportedDataNotice({
  text,
  buttonLabel,
  buttonAriaLabel,
  onRemove,
  testId,
}: {
  text: string;
  buttonLabel: string;
  /** What the button removes, for screen readers (the label alone can be terse). */
  buttonAriaLabel?: string;
  onRemove: () => void;
  testId?: string;
}) {
  return (
    <div
      role="note"
      data-testid={testId}
      className="flex items-start gap-2 p-2 rounded text-[11px]"
      style={{
        color: "var(--color-vsc-text)",
        background: "color-mix(in srgb, var(--color-vsc-warning) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--color-vsc-warning) 35%, transparent)",
      }}
    >
      <span className="flex-1">{text}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={buttonAriaLabel ?? buttonLabel}
        className="btn flex-shrink-0"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
