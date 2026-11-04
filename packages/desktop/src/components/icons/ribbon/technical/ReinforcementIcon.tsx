import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Reinforcement (technical). */
export function ReinforcementIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 20h4l11-12h5" />
      <path d="M8.8 16.3 18.5 18" />
      <path d="M8.12 17.69 10.48 15.11" />
      <path d="M13.2 11.5 21.5 12.9" />
      <path d="M12.52 12.89 14.88 10.31" />
    </RibbonIcon>
  );
}
