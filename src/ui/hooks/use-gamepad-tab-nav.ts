import { useEffect, useRef } from "react";
import type { Tab } from "@/types/ui-types";

type PrevState = { left: boolean; right: boolean };

export function useGamepadTabNav(
  tabs: Tab[],
  activeTabId: string,
  setActiveTabId: (id: string) => void,
): void {
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const setActiveTabIdRef = useRef(setActiveTabId);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  setActiveTabIdRef.current = setActiveTabId;

  useEffect(() => {
    if (typeof navigator === "undefined" || !("getGamepads" in navigator)) {
      return;
    }

    const prevByIndex = new Map<number, PrevState>();
    let rafId: number | null = null;

    const navigate = (delta: -1 | 1) => {
      const currentTabs = tabsRef.current;
      if (currentTabs.length <= 1) return;
      const currentIdx = currentTabs.findIndex(
        (t) => t.id === activeTabIdRef.current,
      );
      if (currentIdx === -1) return;
      const targetIdx =
        delta < 0
          ? Math.max(0, currentIdx - 1)
          : Math.min(currentTabs.length - 1, currentIdx + 1);
      if (targetIdx === currentIdx) return;
      setActiveTabIdRef.current(currentTabs[targetIdx].id);
    };

    const tick = () => {
      if (!document.hidden) {
        const pads = navigator.getGamepads?.() ?? [];
        for (const pad of pads) {
          if (!pad) continue;
          const left = pad.buttons[14]?.pressed ?? false;
          const right = pad.buttons[15]?.pressed ?? false;
          const prev = prevByIndex.get(pad.index);
          if (prev) {
            if (left && !prev.left) navigate(-1);
            else if (right && !prev.right) navigate(+1);
          }
          prevByIndex.set(pad.index, { left, right });
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(tick);
    };

    const onConnect = () => start();
    const onDisconnect = () => {
      // Clear stale entry; loop keeps running cheaply.
      // Stopping entirely would require tracking active pad count and
      // the gain isn't worth the complexity.
    };

    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);

    // Eager start if a pad is already exposed (page reload with paired
    // controller, or a controller plugged in before mount).
    const existing = navigator.getGamepads?.() ?? [];
    if (existing.some((p) => p != null)) start();

    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);
}
