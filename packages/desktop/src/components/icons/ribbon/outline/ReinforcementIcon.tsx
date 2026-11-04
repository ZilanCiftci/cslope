import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Reinforcement (outline). */
export function ReinforcementIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M2 20h4l11-12h5" />
      <path d="M10.9 13.9 20.4 15.5" />
      <path d="M9.8 15.84 13.2 12.16" />
    </RibbonIcon>
  );
}
