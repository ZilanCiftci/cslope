import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

type Theme = "dark" | "light" | "system";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  /** The theme in effect: "system" resolved to the operating system's. */
  resolved: "dark" | "light";
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

/** The key index.html reads to set the theme before React starts. */
export const THEME_STORAGE_KEY = "cslope-ui-theme";

// Storage can be unavailable (private windows, blocked site data).
function readTheme(key: string): Theme | null {
  try {
    const t = localStorage.getItem(key);
    return t === "dark" || t === "light" || t === "system" ? t : null;
  } catch {
    return null;
  }
}

function writeTheme(key: string, theme: Theme) {
  try {
    localStorage.setItem(key, theme);
  } catch {
    // The choice then lasts for this visit only.
  }
}

/** Listeners of the chosen theme, and the choice when storage is unavailable. */
const listeners = new Set<() => void>();
let memoryTheme: Theme | null = null;

function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystem(listener: () => void) {
  const query = window.matchMedia?.(DARK_QUERY);
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}

/**
 * The colour theme. The state lives outside React (storage and the
 * operating system), read through useSyncExternalStore so that a
 * pre-rendered page hydrates with the server's values and then switches.
 */
export function ThemeProvider({ children, defaultTheme = "system", storageKey = THEME_STORAGE_KEY }: ThemeProviderProps) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => memoryTheme ?? readTheme(storageKey) ?? defaultTheme,
    () => defaultTheme,
  );
  const osDark = useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia?.(DARK_QUERY).matches === true,
    () => false,
  );
  const resolved = theme === "dark" || (theme === "system" && osDark) ? "dark" : "light";

  // index.html has already set the class for the first paint. Hydration
  // first renders the server's theme ("light"), so the first run is skipped
  // rather than removing a correct "dark" for a moment.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.classList.toggle("light", resolved === "light");
  }, [resolved]);

  const value: ThemeProviderState = {
    theme,
    resolved,
    setTheme: (t) => {
      memoryTheme = t;
      writeTheme(storageKey, t);
      listeners.forEach((l) => l());
    },
  };

  return <ThemeProviderContext value={value}>{children}</ThemeProviderContext>;
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
