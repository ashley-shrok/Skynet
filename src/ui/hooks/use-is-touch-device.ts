import * as React from "react";

// Touchscreen phones/tablets report `pointer: coarse` + `hover: none`; every
// desktop reports `pointer: fine` + `hover: hover` regardless of window width.
// This is the reliable "is this a touchscreen device" signal — narrow desktop
// windows are still desktops. Distinct from `useIsMobile` (width-based) which
// gates space-adaptive behaviour that DOES want to fire at narrow widths.
const TOUCH_QUERY = "(pointer: coarse) and (hover: none)";

export function useIsTouchDevice() {
  const [isTouchDevice, setIsTouchDevice] = React.useState<boolean | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(TOUCH_QUERY);
    const onChange = () => setIsTouchDevice(mql.matches);
    mql.addEventListener("change", onChange);
    setIsTouchDevice(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isTouchDevice;
}
