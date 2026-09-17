/**
 * MarkdownEditor — shared controlled markdown editor (phase 111, plan 01).
 *
 * The eight surfaces in Phase 112's scope (four file tabs + BountyCard
 * premise + AddWakeupDialog instruction + EditableFileModal +
 * RunbookEditorModal) all drop this in place of a raw <textarea>. This
 * component owns:
 *   - The filetype gate (D-06): `/\.md$/i` → MDXEditor (pretty); otherwise
 *     → verbatim raw <textarea> markup preserved byte-for-byte from the
 *     existing tabs' "tuned" styling (see GlobalFileTab.tsx L106-111).
 *   - The lazy Suspense boundary (D-02): MDXEditor's ~1.5MB bundle is
 *     dynamic-imported so callers that never open a .md file don't pay for
 *     it. Mirrors the SSHAuthDialog / Terminal.tsx pattern.
 *   - The `key={filename}` remount for the lazy child (RESEARCH §Pitfall 1):
 *     MDXEditor is uncontrolled after mount, so a filename change remounts
 *     the child with the new markdown. Tab surfaces mount once per file
 *     open — safe. BountyCard/AddWakeupDialog use a fixed synthetic
 *     filename per open — also safe.
 *
 * Callers are responsible for the `content` state + `onChange` handler
 * (controlled input). The component NEVER knows about "save"; that stays
 * with each caller's existing handler.
 */

import { lazy, Suspense } from "react";

// Lazy-loaded: @mdxeditor/editor bundles Lexical + CodeMirror + Radix
// Dialog + react-hook-form + js-yaml — ~1.5MB uncompressed. Only paid for
// on first mount of a .md-filetype editor. Mirrors the shape at
// src/ui/features/terminal/Terminal.tsx L34-39.
const MdxEditorImpl = lazy(() => import("./MdxEditorImpl").then((m) => ({ default: m.MdxEditorImpl })));

export interface MarkdownEditorProps {
  /** Filename (with extension) — drives the D-06 filetype gate. Pass a
   *  synthetic `.md` name for markdown-content fields that don't map to a
   *  file (BountyCard premise → "premise.md", AddWakeupDialog instruction
   *  → "wakeup.md"). */
  filename: string;
  /** Current content (controlled). */
  content: string;
  /** Called on every keystroke (pretty mode) / every input event (raw
   *  mode). Parent owns the string. */
  onChange: (next: string) => void;
  /** When true, the editor is read-only. Wire from saving state or
   *  view-mode. */
  disabled?: boolean;
  /** Optional placeholder — only visible on the raw <textarea> branch. */
  placeholder?: string;
}

// Textarea styling copied VERBATIM from GlobalFileTab.tsx L106-111 per the
// project directive `do NOT reinvent, it's tuned` (see the load-bearing
// comment at GlobalFileTab.tsx L102-103). Same class survives across all
// four file tabs today; consolidating it here keeps the visual contract.
const RAW_TEXTAREA_CLASS =
  "font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]";

export function MarkdownEditor({
  filename,
  content,
  onChange,
  disabled,
  placeholder,
}: MarkdownEditorProps): JSX.Element {
  const isMarkdown = /\.md$/i.test(filename);

  if (!isMarkdown) {
    return (
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        className={RAW_TEXTAREA_CLASS}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
      />
    );
  }

  // Suspense fallback preserves layout to avoid a jump while the ~1.5MB
  // MDXEditor chunk loads (RESEARCH §Pattern 1). The fallback is a
  // read-only textarea styled identically to the raw branch so users see
  // their content immediately.
  return (
    <Suspense
      fallback={
        <textarea
          value={content}
          onChange={() => {}}
          className={RAW_TEXTAREA_CLASS}
          spellCheck={false}
          disabled
          readOnly
        />
      }
    >
      <MdxEditorImpl
        key={filename}
        content={content}
        onChange={onChange}
        disabled={disabled}
      />
    </Suspense>
  );
}
