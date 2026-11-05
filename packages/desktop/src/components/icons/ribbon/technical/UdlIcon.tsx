import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** UDL (technical). */
export function UdlIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M4 5h16" />
      <path d="M7 5v10M12 5v10M17 5v10" />
      <path d="M5 13l2 2 2-2M10 13l2 2 2-2M15 13l2 2 2-2" />
      <path d="M2 19h20" />
      <path d="M4 22l3-3M9 22l3-3M14 22l3-3M19 22l3-3" />
    </RibbonIcon>
  );
}
