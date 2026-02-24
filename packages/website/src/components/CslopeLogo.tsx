export function CslopeLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Circle border */}
      <defs>
        <clipPath id="circle-clip">
          <circle cx="12" cy="12" r="11" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="11" strokeWidth="1.5" />

      {/* Earth fill below slope surface */}
      <path
        d="M0 8h2.5h6l8 8h5H24V24H0Z"
        fill="#a08060"
        fillOpacity="0.25"
        stroke="none"
        clipPath="url(#circle-clip)"
      />

      {/* Critical slip circle (behind slope) */}
      <path d="M5 8A9 9 0 0 0 17 16" strokeWidth="1.3" stroke="#dc2626" />
      {/* Ground surface + slope face */}
      <path d="M2.5 8h6l8 8h5" strokeWidth="2.0" />
    </svg>
  );
}
