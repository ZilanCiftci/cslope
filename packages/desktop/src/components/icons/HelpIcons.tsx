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
      <path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5V6Z" fill="#42a5f5" opacity="0.15" stroke="#42a5f5" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 6c2-1.5 5-2 8-1.5v13c-3-.5-6 0-8 1.5V6Z" fill="#66bb6a" opacity="0.15" stroke="#66bb6a" strokeWidth="1.5" strokeLinejoin="round" />
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
        opacity="0.15"
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
