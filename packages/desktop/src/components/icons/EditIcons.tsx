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

/** Coloured layers icon for the ribbon Define Materials button. */
export function RibbonMaterialsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Bottom layer */}
      <path d="M12 20l-8-4.5 8-4.5 8 4.5z" fill="#66bb6a" opacity="0.35" />
      {/* Middle layer */}
      <path d="M12 16l-8-4.5 8-4.5 8 4.5z" fill="#42a5f5" opacity="0.5" />
      {/* Top layer */}
      <path d="M12 12L4 7.5 12 3l8 4.5z" fill="#5c6bc0" opacity="0.85" />
      {/* Layer outlines */}
      <path
        d="M12 20l-8-4.5 8-4.5 8 4.5z"
        stroke="#4caf50"
        strokeWidth="0.8"
        fill="none"
      />
      <path
        d="M12 16l-8-4.5 8-4.5 8 4.5z"
        stroke="#2196f3"
        strokeWidth="0.8"
        fill="none"
      />
      <path
        d="M12 12L4 7.5 12 3l8 4.5z"
        stroke="#3f51b5"
        strokeWidth="0.8"
        fill="none"
      />
    </svg>
  );
}
