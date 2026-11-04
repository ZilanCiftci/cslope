import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Reference line (technical). */
export function ReferenceLineIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 20h4l11-12h5" />
      <path d="M2 14h4l9-10h7" strokeDasharray="1.5 3.5" />
    </RibbonIcon>
  );
}
