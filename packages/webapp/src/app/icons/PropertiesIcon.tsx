export function PropertiesIcon({
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
        <path d="M12 3v1.5M12 19.5V21M4.22 4.22l1.06 1.06M17.72 17.72l1.06 1.06M3 12h1.5M19.5 12H21M4.22 19.78l1.06-1.06M17.72 6.28l1.06-1.06" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <div
        className={`absolute -bottom-1 w-1 h-1 rounded-full bg-current opacity-50 ${
          location === "left" ? "left-0" : "right-0"
        }`}
      />
    </div>
  );
}
