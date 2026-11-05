import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Interior (outline). */
export function InteriorIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 19h18V5h-8L3 14z" />
      <path d="M3 16h4l4-3h10" />
      <circle cx="7" cy="16" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="11" cy="13" r="1.4" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
