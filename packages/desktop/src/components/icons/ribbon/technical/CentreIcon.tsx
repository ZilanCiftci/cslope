import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Centre (technical). */
export function CentreIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M8 2v12M2 8h12" />
      <path d="M20 8A12 12 0 0 1 8 20" />
      <path d="M8 8l8.5 8.5" />
    </RibbonIcon>
  );
}
