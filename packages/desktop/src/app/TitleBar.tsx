import { FileMenu } from "./FileMenu";
import { HelpMenu } from "./HelpMenu";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  activeModelName?: string;
}

export function TitleBar({ theme, onToggleTheme, activeModelName }: Props) {
  return (
    <div
      className="flex items-center h-10 px-4 shrink-0 relative z-30"
      style={{
        background: "var(--color-vsc-titlebar)",
        borderBottom: "1px solid var(--color-vsc-border)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold"
          style={{
            background: "var(--color-vsc-accent)",
            color: "#fff",
          }}
        >
          cS
        </div>
        <FileMenu activeModelName={activeModelName} />
        <HelpMenu />
      </div>
      <div className="flex-1" />
      <button
        onClick={onToggleTheme}
        className="w-7 h-7 flex items-center justify-center rounded cursor-pointer mr-2"
        style={{ color: "var(--color-vsc-text-muted)" }}
        title={
          theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
        }
      >
        {theme === "dark" ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M17.36 17.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M17.36 6.64l1.42-1.42" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
      <span
        className="text-[11px] px-2.5 py-0.5 rounded-full"
        style={{
          color: "var(--color-vsc-text-muted)",
          background: "var(--color-vsc-list-active)",
        }}
      >
        {activeModelName ?? "Untitled"}
      </span>
    </div>
  );
}
