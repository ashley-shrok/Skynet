import { useCallback, useSyncExternalStore } from "react";

/**
 * Markdown editing style — "formatted" (MDXEditor, what-you-see) or "plain"
 * (the code editor with markdown highlighting, editing the source text).
 *
 * Per-browser preference like the code editor's soft-wrap: chosen once, it
 * applies to every markdown editor in the app and survives reloads. Every
 * open editor follows a change at once (same tab via a window event, other
 * tabs via the storage event). Safe when localStorage is unavailable: the
 * choice then lasts for this page only.
 */

export type MarkdownEditorMode = "formatted" | "plain";

export const MARKDOWN_MODE_STORAGE_KEY = "skynet.markdownEditor.mode";
const CHANGE_EVENT = "skynet:markdown-editor-mode";

let memoryMode: MarkdownEditorMode | null = null;

export function readMarkdownEditorMode(): MarkdownEditorMode {
  if (memoryMode) return memoryMode;
  if (typeof window === "undefined") return "formatted";
  try {
    return window.localStorage.getItem(MARKDOWN_MODE_STORAGE_KEY) === "plain" ? "plain" : "formatted";
  } catch {
    return "formatted";
  }
}

export function writeMarkdownEditorMode(mode: MarkdownEditorMode): void {
  if (typeof window === "undefined") return;
  memoryMode = mode;
  try {
    window.localStorage.setItem(MARKDOWN_MODE_STORAGE_KEY, mode);
    // Storage works: read from it again, so other tabs' changes show up.
    memoryMode = null;
  } catch {
    // ignore: memoryMode keeps the choice for this page
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === MARKDOWN_MODE_STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useMarkdownEditorMode(): [MarkdownEditorMode, (mode: MarkdownEditorMode) => void] {
  const mode = useSyncExternalStore(subscribe, readMarkdownEditorMode, () => "formatted" as const);
  const setMode = useCallback((next: MarkdownEditorMode) => writeMarkdownEditorMode(next), []);
  return [mode, setMode];
}
