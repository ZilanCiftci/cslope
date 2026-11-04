import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Probabilistic (outline). */
export function ProbabilisticIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M2 19C7 19 8 5 12 5s5 14 10 14" />
    </RibbonIcon>
  );
}
