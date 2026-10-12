import { useId } from "react";
import { cn } from "@/lib/utils";

/** The mark: a slope, the earth below it and a critical slip circle. */
export function CslopeLogo({ className }: { className?: string }) {
  // One clip path per instance: the header and the footer both draw the mark.
  const clip = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="12" cy="12" r="11" />
        </clipPath>
      </defs>
      <path d="M0 8h8.5l8 8H24v8H0Z" className="fill-earth" fillOpacity="0.35" stroke="none" clipPath={`url(#${clip})`} />
      <path d="M5 8A9 9 0 0 0 17 16" strokeWidth="1.6" className="stroke-signal" />
      <path d="M2.5 8h6l8 8h5" strokeWidth="2.1" />
      <circle cx="12" cy="12" r="11" strokeWidth="1.5" />
    </svg>
  );
}

/** The mark and the name. */
export function CslopeWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <CslopeLogo className="h-6 w-6" />
      <span>cSlope</span>
    </span>
  );
}
