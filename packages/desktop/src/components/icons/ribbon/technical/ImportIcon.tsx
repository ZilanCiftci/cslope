import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Import (technical). */
export function ImportIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M5 9V2h9l5 5v15H5v-4" />
      <path d="M14 2v5h5" />
      <path d="M2 14h8M7 11l3 3-3 3" />
    </RibbonIcon>
  );
}
