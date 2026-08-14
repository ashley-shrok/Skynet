import * as React from "react";

// Touchscreen phones/tablets report `pointer: coarse` + `hover: none`; every
// desktop reports `pointer: fine` + `hover: hover` regardless of window width.
// This is the reliable "is this a touchscreen device" signal — narrow desktop
// windows are still desktops. Distinct from `useIsMobile` (width-based) which
// gates space-adaptive behaviour that DOES want to fire at narrow widths.
const TOUCH_QUERY = "(pointer: coarse) and (hover: none)";

export function useIsTouchDevice(): boolean {
  const [isTouchDevice, setIsTouchDevice] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;  // SSR safety, even though skynet is SPA-only
    return window.matchMedia(TOUCH_QUERY).matches;
  });

  React.useEffect(() => {
    const mql = window.matchMedia(TOUCH_QUERY);
    const onChange = () => setIsTouchDevice(mql.matches);
    mql.addEventListener("change", onChange);
    // Re-sync on mount in case matchMedia state changed between the lazy
    // initializer and effect commit (rare — viewport rotation during React
    // commit — but cheap).
    setIsTouchDevice(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isTouchDevice;
}
