import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Shortcuts (technical). */
export function ShortcutsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 8h6v8H2z" />
      <path d="M9 8h6v8H9z" />
      <path d="M16 8h6v8h-6z" />
    </RibbonIcon>
  );
}
