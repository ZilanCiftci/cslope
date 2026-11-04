import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Interior (technical). */
export function InteriorIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 19h18V5h-8L3 14z" />
      <path d="M3 16h4l4-3h10" />
    </RibbonIcon>
  );
}
