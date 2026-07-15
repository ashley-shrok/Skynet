import { useEffect, useRef } from "react";
import type { Tab } from "@/types/ui-types";

export function useKeyboardCloseTab(
  tabs: Tab[],
  activeTabId: string,
  closeTab: (id: string) => void,
): void {
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const closeTabRef = useRef(closeTab);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  closeTabRef.current = closeTab;

  const enabledRef = useRef(true);

  useEffect(() => {
    const readEnabled = () => {
      const v = localStorage.getItem("keyboardCloseTabEnabled");
      enabledRef.current = v === null ? true : v === "true";
    };
    readEnabled();
    const onEnabledChange = () => readEnabled();
    window.addEventListener("keyboardCloseTabEnabledChanged", onEnabledChange);

    const closeActive = () => {
      const id = activeTabIdRef.current;
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab || tab.type === "dashboard") return;
      closeTabRef.current(id);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      if (e.code === "KeyL") {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        closeActive();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(
        "keyboardCloseTabEnabledChanged",
        onEnabledChange,
      );
    };
  }, []);
}
