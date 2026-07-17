import { useEffect, useRef } from "react";
import type { Tab } from "@/types/ui-types";

export function useKeyboardTogglePrettyMode(
  tabs: Tab[],
  activeTabId: string,
  toggleForTab: (id: string) => void,
): void {
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const toggleRef = useRef(toggleForTab);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  toggleRef.current = toggleForTab;

  const enabledRef = useRef(true);

  useEffect(() => {
    const readEnabled = () => {
      const v = localStorage.getItem("keyboardTogglePrettyModeEnabled");
      enabledRef.current = v === null ? true : v === "true";
    };
    readEnabled();
    const onEnabledChange = () => readEnabled();
    window.addEventListener(
      "keyboardTogglePrettyModeEnabledChanged",
      onEnabledChange,
    );

    const fire = () => {
      const id = activeTabIdRef.current;
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab || tab.type !== "terminal") return;
      toggleRef.current(id);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      if (e.code === "KeyO") {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        fire();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(
        "keyboardTogglePrettyModeEnabledChanged",
        onEnabledChange,
      );
    };
  }, []);
}
