import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** UDL (outline). */
export function UdlIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M4 5h16" />
      <path d="M7 5v10M12 5v10M17 5v10" />
      <path d="M5 13l2 2 2-2M10 13l2 2 2-2M15 13l2 2 2-2" />
      <path d="M2 19h20" />
    </RibbonIcon>
  );
}
