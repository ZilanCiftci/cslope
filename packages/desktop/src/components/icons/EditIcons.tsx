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

/** Coloured polygon icon for geometry boundary editing actions. */
export function RibbonGeometryIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M5 17L7.5 6.5L16.5 4L20 13L12.5 20Z"
        fill="#42a5f5"
        opacity="0.2"
      />
      <path
        d="M5 17L7.5 6.5L16.5 4L20 13L12.5 20Z"
        stroke="#42a5f5"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="17" r="1.6" fill="#66bb6a" />
      <circle cx="7.5" cy="6.5" r="1.6" fill="#66bb6a" />
      <circle cx="16.5" cy="4" r="1.6" fill="#66bb6a" />
      <circle cx="20" cy="13" r="1.6" fill="#66bb6a" />
      <circle cx="12.5" cy="20" r="1.6" fill="#66bb6a" />
    </svg>
  );
}

/** Coloured split-region icon for interior boundary actions. */
export function RibbonInteriorBoundaryIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 18L6.5 6.5L17 4L20 13.5L12 20Z"
        fill="#66bb6a"
        opacity="0.16"
      />
      <path
        d="M4 18L6.5 6.5L17 4L20 13.5L12 20Z"
        stroke="#42a5f5"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M5.8 11.4C8.4 10.9 11.2 10.7 14.1 10.9C16 11 17.6 11.3 19 11.8"
        stroke="#e53935"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="2.2 2"
      />
      <circle cx="5.8" cy="11.4" r="1.3" fill="#e53935" />
      <circle cx="12.3" cy="10.8" r="1.3" fill="#e53935" />
      <circle cx="19" cy="11.8" r="1.3" fill="#e53935" />
    </svg>
  );
}

/** Coloured arrow-into-layers icon for the ribbon Assign Materials button. */
export function RibbonAssignMaterialsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Top layer fill */}
      <path d="M3 8H21V14H3Z" fill="#42a5f5" opacity="0.25" />
      {/* Bottom layer fill */}
      <path d="M3 14H21V20H3Z" fill="#66bb6a" opacity="0.25" />
      {/* Region outline */}
      <rect
        x="3"
        y="8"
        width="18"
        height="12"
        rx="1.2"
        stroke="#78909c"
        strokeWidth="1.3"
        fill="none"
      />
      {/* Divider line */}
      <line x1="3" y1="14" x2="21" y2="14" stroke="#78909c" strokeWidth="1.3" />
      {/* Arrow shaft pointing down into the layers */}
      <line
        x1="12"
        y1="1"
        x2="12"
        y2="7"
        stroke="#ff9800"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Arrow head */}
      <path
        d="M8.8 4.5L12 8L15.2 4.5"
        stroke="#ff9800"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** Coloured UDL (uniformly distributed load) icon –
 *  hatched rectangle with two downward arrows, matching the canvas rendering. */
export function RibbonUdlIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Hatched rectangle body */}
      <defs>
        <clipPath id="udl-clip">
          <rect x="3" y="4" width="18" height="12" />
        </clipPath>
      </defs>
      <rect x="3" y="4" width="18" height="12" fill="#ef5350" opacity="0.15" />
      {/* Diagonal hatch lines */}
      <g
        clipPath="url(#udl-clip)"
        stroke="#e53935"
        strokeWidth="1"
        opacity="0.55"
      >
        <line x1="3" y1="16" x2="7" y2="4" />
        <line x1="7" y1="16" x2="11" y2="4" />
        <line x1="11" y1="16" x2="15" y2="4" />
        <line x1="15" y1="16" x2="19" y2="4" />
        <line x1="19" y1="16" x2="23" y2="4" />
      </g>
      {/* Rectangle outline */}
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        stroke="#e53935"
        strokeWidth="1.4"
        fill="none"
      />
      {/* Left downward arrow */}
      <line x1="3" y1="16" x2="3" y2="22" stroke="#e53935" strokeWidth="1.4" />
      <path
        d="M1 20l2 2.5 2-2.5"
        stroke="#e53935"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Right downward arrow */}
      <line
        x1="21"
        y1="16"
        x2="21"
        y2="22"
        stroke="#e53935"
        strokeWidth="1.4"
      />
      <path
        d="M19 20l2 2.5 2-2.5"
        stroke="#e53935"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** Coloured line-load (point load) icon –
 *  a single downward arrow, matching the canvas rendering. */
export function RibbonLineLoadIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Arrow shaft */}
      <line
        x1="12"
        y1="2"
        x2="12"
        y2="19"
        stroke="#42a5f5"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* Arrow head */}
      <path
        d="M7.5 15L12 21l4.5-6"
        stroke="#42a5f5"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** Coloured piezometric line icon – a wavy water line with a dashed line below. */
export function RibbonPiezoLineIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Water fill below the wavy line */}
      <path
        d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0V22H2Z"
        fill="#42a5f5"
        opacity="0.15"
      />
      {/* Wavy water surface line */}
      <path
        d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"
        stroke="#42a5f5"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Dashed piezometric line */}
      <line
        x1="3"
        y1="9"
        x2="21"
        y2="9"
        stroke="#1565c0"
        strokeWidth="1.6"
        strokeDasharray="3 2"
        strokeLinecap="round"
      />
      {/* Small triangle markers */}
      <polygon points="5,7 7,7 6,5.5" fill="#1565c0" />
      <polygon points="17,7 19,7 18,5.5" fill="#1565c0" />
    </svg>
  );
}

/** Coloured parameters icon – variable tag with fx marker. */
export function RibbonParametersIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        fill="#5c6bc0"
        opacity="0.12"
      />
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke="#5c6bc0"
        strokeWidth="1.5"
      />
      <path
        d="M8 9h8M8 12h5"
        stroke="#42a5f5"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7.8 16.5h2.5M11.8 16.5h2.6"
        stroke="#26a69a"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M10.7 15.3l-0.9 2.4M11.4 15.3l0.9 2.4"
        stroke="#26a69a"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="16.8" cy="16.5" r="1.2" fill="#ef5350" />
    </svg>
  );
}

/** Coloured search limits icon - horizontal range with end markers. */
export function RibbonSearchLimitsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <line
        x1="4"
        y1="12"
        x2="20"
        y2="12"
        stroke="#5c6bc0"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <line x1="8" y1="6" x2="8" y2="18" stroke="#26a69a" strokeWidth="2" />
      <line x1="16" y1="6" x2="16" y2="18" stroke="#ef5350" strokeWidth="2" />
      <circle cx="8" cy="12" r="2" fill="#26a69a" opacity="0.35" />
      <circle cx="16" cy="12" r="2" fill="#ef5350" opacity="0.35" />
    </svg>
  );
}

/** Coloured custom planes icon - multiple circles. */
export function RibbonCustomPlanesIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="11" r="5" stroke="#42a5f5" strokeWidth="1.6" />
      <circle cx="15.5" cy="13.5" r="4" stroke="#66bb6a" strokeWidth="1.6" />
      <circle cx="9" cy="11" r="1.2" fill="#42a5f5" />
      <circle cx="15.5" cy="13.5" r="1.2" fill="#66bb6a" />
    </svg>
  );
}

/** Coloured options icon - slider controls. */
export function RibbonOptionsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <line
        x1="4"
        y1="7"
        x2="20"
        y2="7"
        stroke="#5c6bc0"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="12"
        x2="20"
        y2="12"
        stroke="#5c6bc0"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="17"
        x2="20"
        y2="17"
        stroke="#5c6bc0"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="9" cy="7" r="2.2" fill="#42a5f5" />
      <circle cx="15" cy="12" r="2.2" fill="#66bb6a" />
      <circle cx="12" cy="17" r="2.2" fill="#ef5350" />
    </svg>
  );
}
