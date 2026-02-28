import { useEffect, type RefObject } from "react";

export function useRafCleanup(rafRef: RefObject<number | null>) {
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [rafRef]);
}
