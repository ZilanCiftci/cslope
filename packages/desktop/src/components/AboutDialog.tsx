import type { ReactNode } from "react";
import { ModalFrame } from "./ui/ModalFrame";
import { APP_RELEASE_DATE, APP_VERSION } from "../utils/app-version";
import { openAboutLink, openDocumentation } from "../utils/docs";

interface Props {
  onClose: () => void;
}

/** A text link of the dialog (it opens a page outside the app). */
function Link({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer hover:underline font-medium"
      style={{ color: "var(--color-vsc-link)" }}
    >
      {children}
    </button>
  );
}

/**
 * Help › About: the app icon, the version and its release date, and links
 * to the documentation, the third-party licenses and the source code. A
 * dialog in the main window (ModalFrame), so it follows the theme.
 */
export function AboutDialog({ onClose }: Props) {
  const version = APP_VERSION || "unknown";
  return (
    <ModalFrame
      title="About cSlope"
      description="Slope stability analysis by limit equilibrium."
      onClose={onClose}
      widthClassName="w-[360px]"
      buttons={
        <button type="button" onClick={onClose} className="btn btn-primary">
          Close
        </button>
      }
    >
      <div className="flex gap-3 items-start">
        <img
          // Relative to the page, as in the title bar (file:// in the packaged app).
          src={new URL("mountain.svg", document.baseURI).href}
          alt=""
          className="w-8 h-8 shrink-0"
          draggable={false}
        />
        <div className="flex flex-col gap-2 min-w-0">
          <p>
            Version {version}
            {APP_RELEASE_DATE && ` (${APP_RELEASE_DATE})`}
          </p>
          <p className="flex flex-wrap items-center gap-x-1.5">
            <Link onClick={() => openDocumentation()}>Documentation</Link>
            <span aria-hidden style={{ color: "var(--color-vsc-text-muted)" }}>·</span>
            <Link onClick={() => openAboutLink("licenses")}>Licenses</Link>
            <span aria-hidden style={{ color: "var(--color-vsc-text-muted)" }}>·</span>
            <Link onClick={() => openAboutLink("source")}>Source code</Link>
          </p>
          <p className="text-[10px]" style={{ color: "var(--color-vsc-text-muted)" }}>
            Open source under the MIT license. DWG import uses acadrust (MPL-2.0).
          </p>
        </div>
      </div>
    </ModalFrame>
  );
}
