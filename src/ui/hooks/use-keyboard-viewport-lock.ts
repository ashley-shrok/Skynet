import * as React from "react";
import { systemLogger } from "@/lib/frontend-logger";

// iOS keyboard-viewport lock (compose-caret-offset-ios).
//
// iOS Safari / PWA doesn't shrink the layout viewport (100dvh) when the
// on-screen keyboard opens — it scrolls the document instead so the focused
// field clears the keyboard (observed: window.scrollY=413 with html/body/#root
// all `overflow: hidden; height: 100dvh`). While the document sits scrolled
// like that, WebKit's tap-to-caret hit test and the space-bar trackpad map
// coordinates against the UNscrolled page, so the caret lands in the wrong
// spot and trackpad drags jump hundreds of px upward.
//
// Fix: while the keyboard is up, size the app to the visual viewport
// (`--app-height` on <html>, consumed by index.css + AppShell) so the compose
// box already sits above the keyboard, and pin the document scroll at 0.
// With nothing to scroll, the offset never exists. Keyboard down → the var is
// removed and everything falls back to 100dvh (patch #144 safe-area behavior
// untouched).

// iOS never changes innerHeight for the keyboard; a visual viewport this much
// shorter means the keyboard (not the URL bar / a pinch) is up.
const KEYBOARD_MIN_PX = 150;

export function useKeyboardViewportLock(enabled: boolean): void {
  React.useEffect(() => {
    if (!enabled) return;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    let open = false;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const nowOpen = window.innerHeight - vv.height > KEYBOARD_MIN_PX;
      if (nowOpen) {
        root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
        root.classList.add("kb-open");
        if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0);
      } else if (open) {
        root.style.removeProperty("--app-height");
        root.classList.remove("kb-open");
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      }
      if (nowOpen !== open) {
        systemLogger.info(
          `[kb-lock] ${nowOpen ? "open" : "close"} vvH=${Math.round(vv.height)} innerH=${window.innerHeight} vvOT=${Math.round(vv.offsetTop)} scrollY=${Math.round(window.scrollY)}`,
        );
      }
      open = nowOpen;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    apply();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      root.style.removeProperty("--app-height");
      root.classList.remove("kb-open");
    };
  }, [enabled]);
}
