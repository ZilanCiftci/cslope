type IconProps = {
  size?: number;
};

export function NewIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
        fill="#e3edfa"
        stroke="#4a90d9"
        strokeWidth="1.5"
      />
      <path d="M14 2v6h6" fill="#c6daef" stroke="#4a90d9" strokeWidth="1.5" />
      <path
        d="M12 18v-5M9.5 15.5h5"
        stroke="#43a047"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OpenIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M2 8h7l2 2h11v10H2V8z"
        fill="#fdd835"
        stroke="#f9a825"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M2 8V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v0"
        stroke="#f9a825"
        strokeWidth="1.5"
        fill="#fce88a"
      />
    </svg>
  );
}

export function SaveIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"
        fill="#5c95d6"
        stroke="#3b6ea5"
        strokeWidth="1.5"
      />
      <rect x="7" y="13" width="10" height="8" rx="1" fill="#e8f0fe" />
      <rect x="8" y="3" width="7" height="5" rx="0.5" fill="#b7d4f5" />
    </svg>
  );
}

export function SaveAsIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M17 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2z"
        fill="#5c95d6"
        stroke="#3b6ea5"
        strokeWidth="1.5"
      />
      <rect x="7" y="13" width="8" height="8" rx="1" fill="#e8f0fe" />
      <rect x="8" y="3" width="6" height="5" rx="0.5" fill="#b7d4f5" />
      <path
        d="M18 14l-5 5M16.5 15.5l2 2"
        stroke="#e8a735"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="20" cy="13" r="1.5" fill="#e8a735" />
    </svg>
  );
}

export function ExitIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
        stroke="#78909c"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="16 17 21 12 16 7"
        stroke="#e53935"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="21"
        y1="12"
        x2="9"
        y2="12"
        stroke="#e53935"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
