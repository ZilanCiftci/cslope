type IconProps = {
  size?: number;
};

/** Small monochrome undo arrow (toolbar / title bar). */
export function UndoIcon({ size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 14l-4-4 4-4" />
      <path d="M20 20a8 8 0 0 0-11-8H5" />
    </svg>
  );
}

/** Small monochrome redo arrow (toolbar / title bar). */
export function RedoIcon({ size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 6l4 4-4 4" />
      <path d="M4 20a8 8 0 0 1 11-8h4" />
    </svg>
  );
}

/** Coloured undo arrow for the ribbon Edit panel. */
export function RibbonUndoIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M5 10h9a5 5 0 0 1 0 10h-3"
        stroke="#5c6bc0"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9 14L5 10l4-4"
        stroke="#5c6bc0"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M5 10l4 4" stroke="#90a4d8" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

/** Coloured redo arrow for the ribbon Edit panel. */
export function RibbonRedoIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M19 10h-9a5 5 0 0 0 0 10h3"
        stroke="#5c6bc0"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15 14l4-4-4-4"
        stroke="#5c6bc0"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M19 10l-4 4" stroke="#90a4d8" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}
