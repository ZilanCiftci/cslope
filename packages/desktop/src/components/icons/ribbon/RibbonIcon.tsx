import type { ReactNode } from "react";

/**
 * The props of the ribbon's own icons, the same as lucide's so that
 * `<UdlIcon {...SMALL_ICON} />` drops in for a lucide icon. 24 x 24 grid
 * with a 2 px margin, stroked in currentColor, no fills except small marks.
 */
export interface RibbonIconProps {
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
  "aria-hidden"?: boolean;
}

/**
 * The two drawing styles under review: "outline" is lucide's language
 * (round caps and joins, rounded corners); "technical" is a section
 * drawing's (square caps, mitred joins, hatching, dimension marks).
 */
export type RibbonIconStyle = "outline" | "technical";

export function RibbonIcon({
  size = 24,
  strokeWidth = 1.5,
  color = "currentColor",
  className,
  "aria-hidden": ariaHidden = true,
  style,
  children,
}: RibbonIconProps & { style: RibbonIconStyle; children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      color={color}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap={style === "outline" ? "round" : "square"}
      strokeLinejoin={style === "outline" ? "round" : "miter"}
      className={className}
      aria-hidden={ariaHidden}
    >
      {children}
    </svg>
  );
}
