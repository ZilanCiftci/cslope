export function ExplorerIcon({
  active,
  location,
}: {
  active: boolean;
  location: "left" | "right";
}) {
  return (
    <div className="relative">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke={
          active
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text-muted)"
        }
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
      <div
        className={`absolute -bottom-1 w-1 h-1 rounded-full bg-current opacity-50 ${
          location === "left" ? "left-0" : "right-0"
        }`}
      />
    </div>
  );
}
