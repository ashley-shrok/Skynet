import { useEffect, useRef } from "react";
import type { Tab } from "@/types/ui-types";

export function useKeyboardTabNav(
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

  const enabledRef = useRef(true);

  useEffect(() => {
    const readEnabled = () => {
      const v = localStorage.getItem("keyboardTabNavEnabled");
      enabledRef.current = v === null ? true : v === "true";
    };
    readEnabled();
    const onEnabledChange = () => readEnabled();
    window.addEventListener("keyboardTabNavEnabledChanged", onEnabledChange);

    const navigate = (delta: -1 | 1) => {
      const currentTabs = tabsRef.current;
      const n = currentTabs.length;
      if (n <= 1) return;
      const currentIdx = currentTabs.findIndex(
        (t) => t.id === activeTabIdRef.current,
      );
      if (currentIdx === -1) return;
      const targetIdx = (((currentIdx + delta) % n) + n) % n;
      setActiveTabIdRef.current(currentTabs[targetIdx].id);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      if (e.code === "BracketLeft") {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        navigate(-1);
      } else if (e.code === "BracketRight") {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        navigate(+1);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(
        "keyboardTabNavEnabledChanged",
        onEnabledChange,
      );
    };
  }, []);
}
