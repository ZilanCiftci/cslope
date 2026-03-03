type IconProps = {
  size?: number;
};

export function ReloadIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
        stroke="#43a047"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M23 4v6h-6"
        stroke="#43a047"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DevToolsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <polyline
        points="16 18 22 12 16 6"
        stroke="#7e57c2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="8 6 2 12 8 18"
        stroke="#ab47bc"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="14"
        y1="4"
        x2="10"
        y2="20"
        stroke="#b39ddb"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}

export function LogIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
        fill="#e3edfa"
        stroke="#5c95d6"
        strokeWidth="1.5"
      />
      <path d="M14 2v6h6" fill="#c6daef" stroke="#5c95d6" strokeWidth="1.5" />
      <line
        x1="8"
        y1="13"
        x2="16"
        y2="13"
        stroke="#90a4ae"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="8"
        y1="17"
        x2="13"
        y2="17"
        stroke="#90a4ae"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ResetIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
        stroke="#e53935"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M3 3v5h5"
        stroke="#e53935"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
