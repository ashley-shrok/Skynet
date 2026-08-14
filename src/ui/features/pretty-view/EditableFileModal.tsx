import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/dialog";
import { cn } from "@/lib/utils";
import { fetchTailnetUrl } from "@/api/editable-file-api";
import GlobalFileTab, { type GlobalFileTabData } from "./GlobalFileTab";
import type { TabState } from "./IdentityFileTab";

/**
 * Monotonic mtime counter (rev-3 2026-08-14 code-review M4). Previously the
 * modal used `Date.now()` as the mtime sentinel; two sub-millisecond opens
 * would collide, GlobalFileTab's `useEffect([...state.data.mtime])` would
 * decline to re-seed the draft, and the second open's editor would show the
 * first open's draft (or empty). A monotonic counter guarantees a distinct
 * sentinel per modal-open lifecycle regardless of wall-clock resolution.
 */
let mtimeCounter = 0;

/**
 * Phase 40 Plan 40-03 Task 2 — EditableFileModal.
 *
 * LOCKED decisions honored:
 *   - D-03 (additive edit affordance): the affordance opens THIS modal; the
 *     modal never wraps the anchor.
 *   - D-04 (fresh fetch + visible failure over silent stale): every open
 *     fires a fresh `fetchTailnetUrl(url)`. Cached bytes from
 *     `useEditableFileEligibility` are NEVER consulted here. Fetch failure
 *     opens the modal with an explicit in-body error copy — never silently
 *     fall back. (Rev-2 /close 2026-08-14: the parallel sonner toast that
 *     originally rode alongside the in-body error was removed as an
 *     unsanctioned addition — its bottom-right anchor occluded the
 *     composebox on mobile. In-body error copy alone satisfies "visible
 *     failure over silent stale".)
 *   - D-05 (chrome fork from GlobalFilesModal minus host picker + tabs bar,
 *     editor body reuses GlobalFileTab verbatim): Portal + Overlay + Content
 *     structure copied VERBATIM from GlobalFilesModal.tsx L189-217; the X
 *     close button copied VERBATIM from L246-270; the host <select> and
 *     bottom Tabs bar are stripped. GlobalFileTab is imported unmodified
 *     (rev-2 adds one optional callback prop; existing signature untouched).
 *   - D-06 (editor stateless — mtime sentinel captured once at open, save =
 *     fresh attachment): `initialMtimeRef` is set ONCE at fetch-success and
 *     never reassigned across the modal's open lifecycle (Pitfall 6 defense
 *     — reseeding the draft would blow away every keystroke).
 *
 * rev-2 draft-guard confirm gate (UI-SPEC L167-169, Ashley explicit
 *   greenlight 2026-08-14): the modal wraps `onOpenChange` in
 *   `handleOpenChange`. On close-transitions when the draft is dirty AND
 *   not mid-save, it fires `window.confirm("Discard unsaved changes?")`.
 *   Confirm → close; cancel → suppress. Save-success closes bypass the
 *   guard via `savingRef`.
 *
 * Portal target (Pitfall 7 defense): DialogPrimitive.Portal is deliberately
 *   used WITHOUT a `container` prop → radix renders it into document.body,
 *   so the `inset-4` backdrop covers the entire viewport including the
 *   composer per UI-SPEC L216. (This is the opposite of IdentityModal
 *   which portals to `chatRegionEl` to leave the composer visible.)
 */

export interface EditableFileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageEventId: string;
  url: string;
  filename: string;
  agentIdentityName: string | null;
  /**
   * Callback invoked on Save with the edited (filename, content) tuple.
   * Plan 40-04 wires this to `uploads.stageAttachments("primary", [File])`
   * — depositing the edit as a chip in the ComposeBox attachment strip
   * (D-06: every save = fresh attachment; there is no host file to
   * conflict-check against).
   */
  onStageEditedFile: (filename: string, content: string) => void;
}

export default function EditableFileModal({
  open,
  onOpenChange,
  messageEventId: _messageEventId,
  url,
  filename,
  agentIdentityName,
  onStageEditedFile,
}: EditableFileModalProps): JSX.Element {
  const [fetchState, setFetchState] = useState<TabState<GlobalFileTabData>>({
    status: "loading",
  });
  const [isDirty, setIsDirty] = useState(false);

  // Pitfall 6: mtime sentinel MUST be stable across renders. Captured ONCE
  // at fetch-success, reset only when the modal closes.
  const initialMtimeRef = useRef<number>(0);
  // Rev-2: bypass the draft-guard confirm on save-success closes.
  const savingRef = useRef<boolean>(false);

  // D-04 fresh-fetch-on-open effect. `filename` IS included in the deps but
  // is derivable from `url`, so it should never change independently — the
  // extra dep is harmless (rev-3 M7: prior version's comment claimed it was
  // excluded, but the array said otherwise; comment now matches reality).
  useEffect(() => {
    if (!open) {
      // Reset state on close so re-open starts fresh (D-06 stateless).
      setFetchState({ status: "loading" });
      setIsDirty(false);
      initialMtimeRef.current = 0;
      savingRef.current = false;
      return;
    }

    // Open transition — begin fresh fetch.
    let cancelled = false;
    setFetchState({ status: "loading" });
    setIsDirty(false);
    savingRef.current = false;

    fetchTailnetUrl(url)
      .then((result) => {
        if (cancelled) return;
        // Capture the mtime sentinel ONCE at success — stable across all
        // subsequent renders of this modal's open lifecycle. Uses a module-
        // scope monotonic counter (rev-3 M4) rather than Date.now() to avoid
        // sub-ms collision between rapid opens seeding stale drafts.
        initialMtimeRef.current = ++mtimeCounter;
        // Decode base64 -> UTF-8 (rev-3 2026-08-14 code-review B2). The prior
        // `atob(...)` returned a Latin-1 "binary string" — non-ASCII content
        // (emoji, CJK, accented Latin, Cyrillic, ...) became mojibake in the
        // textarea, and saving without editing re-encoded that mojibake as
        // UTF-8 into a different byte sequence than the original: silent
        // destructive corruption. Two-step decode: base64 -> raw bytes ->
        // UTF-8 string via TextDecoder is the standard fix.
        const rawBytes = Uint8Array.from(atob(result.contentBase64), (c) =>
          c.charCodeAt(0),
        );
        const content = new TextDecoder("utf-8").decode(rawBytes);
        setFetchState({
          status: "ready",
          data: {
            content,
            mtime: initialMtimeRef.current,
          },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const detail =
          err instanceof Error ? err.message : "unknown fetch error";
        setFetchState({ status: "error", error: detail });
      });

    return () => {
      cancelled = true;
    };
  }, [open, url, filename]);

  // Draft-guard wrapper on onOpenChange. When closing (open→false) with a
  // dirty draft AND not mid-save, fire the confirm dialog. Passing through
  // unchanged on: opening, closing-clean, or closing-during-save.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDirty && !savingRef.current) {
        const confirmed = window.confirm("Discard unsaved changes?");
        if (!confirmed) return; // suppress the close
      }
      onOpenChange(nextOpen);
    },
    [isDirty, onOpenChange],
  );

  // Save handler — mtime is discarded (D-06: editor is stateless; there is
  // no host file to conflict-check against). Sets savingRef FIRST so the
  // subsequent onOpenChange(false) bypasses the draft-guard confirm.
  // (Rev-2 /close 2026-08-14: the save-success sonner toast was removed as
  // an unsanctioned addition — the shape never asked for ambient success
  // feedback, and the bottom-right anchor occluded the composebox on
  // mobile. The composebox chip appearing on save is confirmation enough.)
  //
  // Rev-3 M6: `try/finally` around the stage-and-close so that if
  // `onStageEditedFile` throws (or `onOpenChange`), `savingRef` is reset. If
  // savingRef stayed sticky-true after a failed save, the next close attempt
  // would silently bypass the draft-guard even though the content was never
  // stored anywhere and the user still has unsaved edits.
  const handleSave = useCallback(
    async (content: string, _expectedMtime: number): Promise<void> => {
      savingRef.current = true;
      try {
        onStageEditedFile(filename, content);
        onOpenChange(false);
      } catch (err) {
        savingRef.current = false;
        throw err;
      }
    },
    [filename, onOpenChange, onStageEditedFile],
  );

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={handleOpenChange}
      modal={false}
    >
      {/* Pitfall 7: intentionally NO `container` prop — portals to document.body
          so the inset-4 backdrop covers the composer per UI-SPEC L216. */}
      <DialogPrimitive.Portal>
        {/* Overlay — verbatim from GlobalFilesModal.tsx L189-196 */}
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/15",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        {/* Content — verbatim structure from GlobalFilesModal.tsx L197-217 */}
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // Verbatim from GlobalFilesModal.tsx L198-202: prevent modal
            // from closing when clicking outside (e.g. into the composer).
            // X and Esc remain valid close paths (routed via handleOpenChange).
            e.preventDefault();
          }}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background:
              "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
        >
          {/* a11y: sr-only title + description. Radix Dialog v1+ warns to
              console on every mount if no DialogDescription is present
              (aria-describedby target). Both are visually hidden — the
              in-body header carries the visible label; these serve screen
              readers and satisfy Radix's a11y contract. (Rev-3 M5.) */}
          <DialogTitle className="sr-only">Edit {filename}</DialogTitle>
          <DialogDescription className="sr-only">
            Textarea to edit the file's contents and save the result as an
            attachment on your next reply.
          </DialogDescription>

          {/* Header — Phase 40 custom: "Edit {filename}" + optional
              "from {agentIdentityName}" muted sub-header + glass X close. */}
          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-3"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <div
              className="text-[15px] font-semibold text-[#f0ebe0] truncate"
              title={filename}
            >
              Edit {filename}
            </div>
            {agentIdentityName ? (
              <div className="text-xs text-[#a89a80]">
                from {agentIdentityName}
              </div>
            ) : null}
            <div className="flex-1" />
            {/* Glass X close button — verbatim from GlobalFilesModal.tsx L246-270 */}
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.22)";
                  e.currentTarget.style.boxShadow =
                    "0 0 20px hsla(220, 60%, 50%, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.10)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </DialogHeader>

          {/* Body branches — loading / error / ready */}
          {fetchState.status === "error" ? (
            // In-body error copy per UI-SPEC L110 (verbatim). We do NOT
            // delegate to GlobalFileTab's error branch here because the
            // copy is Phase-40-specific (agent-server auto-kill guidance).
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
              <div className="text-lg font-semibold text-[#f0ebe0]">
                {"Can't fetch the current file."}
              </div>
              <div className="text-sm text-[#a89a80] max-w-md">
                {/* UI-SPEC L110 verbatim (Task 3 grep gate depends on the
                    literal apostrophe — use a JS string expression to keep
                    the source text exact without triggering the JSX
                    react/no-unescaped-entities lint rule). */}
                {"The agent's temporary server may have shut down (they auto-kill after 30 minutes) or the network is unreachable. Ask the agent to re-share the file if you still want to edit it."}
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="mt-2 px-4 py-2 rounded-md text-[#e8e4d8] cursor-pointer text-sm transition-[background-color,border-color,box-shadow] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.22)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.10)";
                }}
              >
                Close
              </button>
            </div>
          ) : (
            // Loading + ready branches: delegate to GlobalFileTab which
            // handles both natively. Wrap in the same overflow-y-auto
            // container GlobalFilesModal uses at L310.
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <GlobalFileTab
                state={fetchState}
                onSave={handleSave}
                onDraftChange={setIsDirty}
              />
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
