import { Link, NavLink as RouterNavLink, useLocation, useNavigationType } from "react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Github, Menu, Moon, Sun, X } from "lucide-react";

import { CslopeWordmark } from "@/components/CslopeLogo";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { FOOTER_PRODUCT, NAV, SITE } from "@/site";
import { cn } from "@/lib/utils";

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
          paint, so that a pre-rendered page shows the right one at once. */}
      <Sun className="hidden h-[18px] w-[18px] dark:block" aria-hidden="true" />
      <Moon className="h-[18px] w-[18px] dark:hidden" aria-hidden="true" />
    </Button>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-foreground",
    isActive ? "text-foreground" : "text-muted-foreground",
  );

function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const [menuPath, setMenuPath] = useState(pathname);
  // Close the mobile menu on navigation.
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="rounded-md" aria-label="cSlope home">
          <CslopeWordmark className="text-lg" />
        </Link>

        <nav className="hidden items-center md:flex" aria-label="Main">
          {NAV.map((link) => (
            <RouterNavLink key={link.to} to={link.to} className={navClass}>
              {link.label}
            </RouterNavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex">
            <a href={SITE.github} target="_blank" rel="noopener noreferrer" aria-label="cSlope on GitHub">
              <Github className="h-[18px] w-[18px]" />
            </a>
          </Button>
          <Button asChild size="sm" className="ml-2 hidden md:inline-flex">
            <Link to="/download">Download</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" className="border-t md:hidden" aria-label="Main">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {NAV.map((link) => (
              <RouterNavLink key={link.to} to={link.to} className={navClass}>
                {link.label}
              </RouterNavLink>
            ))}
            <a href={SITE.github} target="_blank" rel="noopener noreferrer" className={navClass({ isActive: false })}>
              GitHub
            </a>
            <Button asChild size="sm" className="mt-2">
              <Link to="/download">Download</Link>
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-sm">
          <CslopeWordmark />
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{SITE.description}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            Developed by{" "}
            <a
              href={SITE.company.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {SITE.company.name}
            </a>
            .
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Product</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {FOOTER_PRODUCT.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="hover:text-foreground">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Open source</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href={SITE.github} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                Source code
              </a>
            </li>
            <li>
              <a href={SITE.issues} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                Report an issue
              </a>
            </li>
            <li>
              <Link to="/about" className="hover:text-foreground">
                About
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">
          © {__BUILD_YEAR__} {SITE.company.name}. cSlope is released under the {SITE.licence} licence. The site uses
          open source software and fonts:{" "}
          <a href="/third-party-licenses.txt" className="underline-offset-2 hover:text-foreground hover:underline">
            third-party licences
          </a>
          . Windows is a trademark of Microsoft Corporation.
        </p>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const navigation = useNavigationType();
  // Start a new page at the top, or at the heading its #fragment names.
  // Back and forward (POP) keep the browser's own scroll restoration.
  useEffect(() => {
    if (navigation === "POP") return;
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape: look for the fragment as written.
    }
    const target = () => document.getElementById(id);
    if (target()) {
      target()!.scrollIntoView();
      return;
    }
    // The target may render later (a lazily loaded page on a slow
    // connection): start at the top meanwhile, and keep looking for a few
    // seconds. A fragment that never appears leaves the page at the top.
    window.scrollTo(0, 0);
    let tries = 0;
    let frame = 0;
    const scroll = () => {
      const el = target();
      if (el) el.scrollIntoView();
      else if (++tries < 300) frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash, navigation]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
