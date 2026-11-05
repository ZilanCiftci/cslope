import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Probabilistic (technical). */
export function ProbabilisticIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 19C7 19 8 5 12 5s5 14 10 14" />
      <path d="M2 19h20" />
      <path d="M12 7v12" />
    </RibbonIcon>
  );
}
