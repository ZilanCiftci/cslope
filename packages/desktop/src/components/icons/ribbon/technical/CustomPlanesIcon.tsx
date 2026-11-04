import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Custom planes (technical). */
export function CustomPlanesIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 20h4l11-12h5" />
      <path d="M4 20l5-1.5 5-5 5-5.5" />
      <path d="M7.8 17.3h2.4v2.4H7.8z" fill="currentColor" stroke="none" />
      <path d="M12.8 12.3h2.4v2.4h-2.4z" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
