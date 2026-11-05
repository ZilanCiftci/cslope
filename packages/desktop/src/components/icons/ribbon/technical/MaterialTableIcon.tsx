import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Material table (technical). */
export function MaterialTableIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 4h18v16H3z" />
      <path d="M3 9h18M3 14h18M9 4v16" />
      <path d="M4.5 10.5h3v2h-3z" fill="currentColor" stroke="none" />
      <path d="M4.5 15.5h3v2h-3z" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
