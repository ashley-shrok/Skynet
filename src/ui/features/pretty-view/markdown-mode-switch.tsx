import { createContext } from "react";
import { KitSegmented } from "@/components/kit";
import { useMarkdownEditorMode, type MarkdownEditorMode } from "./markdown-editor-mode-preference";

/**
 * The "Formatted | Plain text" switch for markdown files.
 *
 * Where it sits:
 *   - In a file window or file pane, the host puts it in its header beside
 *     the other view switches. The host provides MarkdownSwitchHostContext;
 *     editors inside then draw no switch of their own and report when the
 *     formatted view can't show the file.
 *   - Anywhere else (agent file, role file, About you, …) the editor draws
 *     it at the end of its own toolbar row.
 *
 * The choice is one per-browser preference, so every switch and editor
 * follows a change at once.
 */

export interface MarkdownSwitchHost {
  /** The editor fell back to plain text: this file can't be shown formatted. */
  onFormattedUnavailable: (unavailable: boolean) => void;
  /** What the last editor here reported (a rebuilt editor starts from it). */
  formattedUnavailable?: () => boolean;
}

export const MarkdownSwitchHostContext = createContext<MarkdownSwitchHost | null>(null);

export const FORMATTED_UNAVAILABLE_COPY =
  "This file has markup the formatted view can't show, so it opens as plain text.";

const OPTIONS: ReadonlyArray<{ value: MarkdownEditorMode; label: string; title: string }> = [
  { value: "formatted", label: "Formatted", title: "Show formatting (headings, bold, lists)" },
  { value: "plain", label: "Plain text", title: "Show the markdown source text" },
];

export function MarkdownModeSwitch({
  formattedUnavailable = false,
  size,
}: {
  formattedUnavailable?: boolean;
  size?: "sm";
}): JSX.Element {
  const [mode, setMode] = useMarkdownEditorMode();
  const current: MarkdownEditorMode = formattedUnavailable ? "plain" : mode;
  // A greyed-out segment takes no pointer, so its own hover text can't show:
  // the reason rides on the whole switch instead.
  return (
    <span className="inline-flex" title={formattedUnavailable ? FORMATTED_UNAVAILABLE_COPY : undefined} data-testid="markdown-mode-switch">
    <KitSegmented
      aria-label="Markdown view"
      size={size}
      value={current}
      onValueChange={setMode}
      testIdPrefix="markdown-mode"
      options={OPTIONS.map((o) => {
        const off = o.value === "formatted" && formattedUnavailable;
        return { value: o.value, label: o.label, disabled: off, title: off ? FORMATTED_UNAVAILABLE_COPY : o.title };
      })}
    />
    </span>
  );
}
