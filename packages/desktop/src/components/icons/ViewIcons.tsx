type IconProps = {
  size?: number;
};

// ── Toolbar (small, monochrome, currentColor) ───────────────────────

/** Fit-to-view corners (toolbar). */
export function FitIcon({ size = 14 }: IconProps) {
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
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Zoom-in magnifier (toolbar). */
export function ZoomInIcon({ size = 14 }: IconProps) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  );
}

/** Zoom-out magnifier (toolbar). */
export function ZoomOutIcon({ size = 14 }: IconProps) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M8 11h6" />
    </svg>
  );
}

/** Zoom-box selection rectangle (toolbar). */
export function ZoomBoxIcon({ size = 14 }: IconProps) {
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
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M8 8h8M8 16h8M8 8v8M16 8v8" strokeDasharray="2 2" />
    </svg>
  );
}

/** Hand/pan cursor (toolbar). */
export function HandIcon({ size = 14 }: IconProps) {
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
      <path d="M6 12v-2a2 2 0 0 1 4 0v2" />
      <path d="M10 10V8a2 2 0 0 1 4 0v4" />
      <path d="M14 12V7a2 2 0 0 1 4 0v7" />
      <path d="M6 12v3a5 5 0 0 0 10 0v-1" />
    </svg>
  );
}

/** Small plus sign (zoom step button). */
export function PlusIcon({ size = 10 }: IconProps) {
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
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Small minus sign (zoom step button). */
export function MinusIcon({ size = 10 }: IconProps) {
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
      <path d="M5 12h14" />
    </svg>
  );
}

// ── Ribbon (larger, coloured) ───────────────────────────────────────

/** Coloured fit-to-view icon for the ribbon View panel. */
export function RibbonFitIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect
        x="6"
        y="6"
        width="12"
        height="12"
        rx="1"
        fill="#e0f2f1"
        stroke="#26a69a"
        strokeWidth="1"
        strokeDasharray="3 2"
      />
      <path
        d="M8 3H5a2 2 0 0 0-2 2v3"
        stroke="#00897b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 3h3a2 2 0 0 1 2 2v3"
        stroke="#00897b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8 21H5a2 2 0 0 1-2-2v-3"
        stroke="#00897b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 21h3a2 2 0 0 0 2-2v-3"
        stroke="#00897b"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Coloured zoom-box icon for the ribbon View panel. */
export function RibbonZoomBoxIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="3"
        width="14"
        height="14"
        rx="1.5"
        fill="#e3f2fd"
        stroke="#42a5f5"
        strokeWidth="1.5"
        strokeDasharray="3 2"
      />
      <circle
        cx="17"
        cy="17"
        r="4"
        fill="#fff"
        stroke="#42a5f5"
        strokeWidth="1.5"
      />
      <path
        d="M15.5 17h3M17 15.5v3"
        stroke="#1e88e5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Coloured open-palm hand icon for the ribbon View panel. */
export function RibbonHandIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Open hand – five fingers up, palm facing viewer */}
      <path
        d={[
          // Thumb (leftmost, slightly shorter & angled out)
          "M4.2 13.5",
          "C3 13 2.2 11.8 2.5 10.5",
          "C2.8 9.2 3.8 8.5 4.8 8.8",
          "L5.5 9.2",
          "L5.5 12",
          // Index finger
          "L5.5 5.5 C5.5 4 6 3 7 3 C8 3 8.5 4 8.5 5.5 L8.5 11.5",
          // Middle finger (tallest)
          "L8.5 4.5 C8.5 2.8 9 1.8 10 1.8 C11 1.8 11.5 2.8 11.5 4.5 L11.5 11.5",
          // Ring finger
          "L11.5 5 C11.5 3.2 12 2.2 13 2.2 C14 2.2 14.5 3.2 14.5 5 L14.5 11.5",
          // Pinky (shortest)
          "L14.5 6.5 C14.5 5 15 4 16 4 C17 4 17.5 5 17.5 6.5 L17.5 12",
          // Right side of palm down to wrist
          "L17.5 15 C17.5 18.5 15.5 21 12 21",
          "L10 21",
          "C6.5 21 4.5 18.5 4.5 15",
          "L4.2 13.5",
          "Z",
        ].join(" ")}
        fill="#ffe0b2"
        stroke="#5d4037"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Finger separation lines */}
      <line
        x1="8.5"
        y1="11.5"
        x2="8.5"
        y2="14"
        stroke="#5d4037"
        strokeWidth="0.7"
        opacity="0.35"
      />
      <line
        x1="11.5"
        y1="11.5"
        x2="11.5"
        y2="14"
        stroke="#5d4037"
        strokeWidth="0.7"
        opacity="0.35"
      />
      <line
        x1="14.5"
        y1="11.5"
        x2="14.5"
        y2="14"
        stroke="#5d4037"
        strokeWidth="0.7"
        opacity="0.35"
      />
    </svg>
  );
}
