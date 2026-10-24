type IconProps = {
  size?: number;
};

export function BenchmarkIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3v18h18"
        stroke="#78909c"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="6" y="14" width="3" height="6" rx="0.5" fill="#66bb6a" />
      <rect x="11" y="8" width="3" height="12" rx="0.5" fill="#42a5f5" />
      <rect x="16" y="5" width="3" height="15" rx="0.5" fill="#ffa726" />
    </svg>
  );
}

/** An open book: the example models the tutorials use. */
export function ExamplesIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Only the fill is light: the outline keeps full strength. */}
      <path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5V6Z" fill="#42a5f5" fillOpacity="0.15" stroke="#42a5f5" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 6c2-1.5 5-2 8-1.5v13c-3-.5-6 0-8 1.5V6Z" fill="#66bb6a" fillOpacity="0.15" stroke="#66bb6a" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function InfoIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="#42a5f5"
        fillOpacity="0.15"
        stroke="#42a5f5"
        strokeWidth="1.5"
      />
      <line
        x1="12"
        y1="16"
        x2="12"
        y2="12"
        stroke="#1e88e5"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="8.5" r="1.3" fill="#1e88e5" />
    </svg>
  );
}

/** A page with a question mark: the online documentation. */
export function DocsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M6 2.5h8.5L19 7v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1-1.5z"
        fill="#5c6bc0"
        fillOpacity="0.12"
        stroke="#5c6bc0"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M14.5 2.5V7H19" stroke="#5c6bc0" strokeWidth="1.2" strokeLinejoin="round" />
      <path
        d="M9.8 11.2a2.2 2.2 0 1 1 3 2.05c-.5.2-.8.6-.8 1.1v.6"
        stroke="#1e88e5"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.6" r="1.1" fill="#1e88e5" />
    </svg>
  );
}

/** A keyboard: the list of keyboard shortcuts. */
export function KeyboardIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect
        x="2"
        y="6"
        width="20"
        height="12"
        rx="2"
        fill="#78909c"
        fillOpacity="0.12"
        stroke="#78909c"
        strokeWidth="1.5"
      />
      <path
        d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M6 13.5h1M17 13.5h1"
        stroke="#546e7a"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M9.5 14.5h5" stroke="#42a5f5" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
