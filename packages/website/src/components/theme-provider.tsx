import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;

export function ThemeProvider({ children, defaultTheme = "system", storageKey = THEME_STORAGE_KEY }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => readTheme(storageKey) ?? defaultTheme);
  const [osDark, setOsDark] = useState(systemDark);

  // Follow the operating system's theme (it matters while the theme is "system").
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    const update = () => setOsDark(query?.matches === true);
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);

  const resolved = theme === "dark" || (theme === "system" && osDark) ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.classList.toggle("light", resolved === "light");
  }, [resolved]);

  const value: ThemeProviderState = {
    theme,
    resolved,
    setTheme: (t) => {
      writeTheme(storageKey, t);
      setTheme(t);
    },
  };

  return <ThemeProviderContext value={value}>{children}</ThemeProviderContext>;
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
