import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Shortcuts (outline). */
export function ShortcutsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 6h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3z" />
      <path d="M14 6h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-7z" />
      <path d="M3 16h18v3H3z" />
    </RibbonIcon>
  );
}
