import { Moon, Sun } from "lucide-react";
import { CslopeWordmark } from "@/components/CslopeLogo";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { SITE_URL } from "@/links";

function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {/* Both icons, chosen by the class index.html sets before the first
          paint, so that the page shows the right one at once. */}
      <Sun className="hidden h-[18px] w-[18px] dark:block" aria-hidden="true" />
      <Moon className="h-[18px] w-[18px] dark:hidden" aria-hidden="true" />
    </Button>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href={SITE_URL} className="rounded-md" aria-label="cSlope website">
          <CslopeWordmark className="text-lg" />
        </a>
        <span className="text-sm text-muted-foreground">in the browser</span>
        <span className="rounded-sm border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground" title="cSlope is a beta: check its results before you rely on them.">
          Beta
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
