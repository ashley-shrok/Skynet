import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code2, Eye, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/dialog";
import { cn } from "@/lib/utils";
import {
  fetchTailnetUrl,
  fetchHostFileUrl,
} from "@/api/editable-file-api";
import GlobalFileTab, { type GlobalFileTabData } from "./GlobalFileTab";
import { classifyFileChipKind, type FileChipKind } from "./FileChip";
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
 * Phase 75 D-01 dispatch guard: fresh non-global regex used to decide which
 * fetch helper to call at open-time. MUST be non-global — .test() on a /g
 * regex mutates .lastIndex and returns alternating true/false (RESEARCH
 * Pitfall 6 + docblock warning on SKYNET_FILE_URL_RE_CLIENT).
 */
const FILE_URL_DISPATCH_RE = /^https:\/\/[^/]+\/file\//;

/**
 * Phase 75 D-01 URL parser for the modal's error-copy layer. Used ONLY to
 * extract the hostname to weave into the "Permission denied on <host>"
 * copy per D-02. Kept module-private; the fetch helper does its own
 * parsing for the network payload.
 */
const FILE_URL_HOSTNAME_RE =
  /^https:\/\/[^/]+\/file\/([a-zA-Z0-9._-]+)\//;

/**
 * Phase 75 D-02 error-class → human-readable copy map for the modal's
 * in-body error surface. Keys are the backend error-class strings emitted
 * by `pretty-view-fetch-host-file.ts` from Plan 75-01. Values contain a
 * heading (short) + body (sentence) rendered inside the modal's error
 * panel. NEVER include HTTP status codes or stack traces (T-40-05
 * invariant re-affirmed in the plan's threat model T-75-F2).
 *
 * `permission_denied` is special-cased at the render site because its
 * body copy weaves in the hostname parsed from the URL (safe — the user
 * typed/saw the URL in the message, no info leak).
 *
 * Unmapped classes (including axios error paths that do NOT carry a
 * backend class, so the message becomes the generic ApiError text) fall
 * back to the "generic" entry. This keeps the failure UX predictable:
 * user always sees a clean sentence, never raw error internals.
 */
type ErrorCopy = { heading: string; body: string };
const FILE_URL_ERROR_COPY: Record<string, ErrorCopy> = {
  host_unreachable: {
    heading: "Host unreachable",
    body: "The box may be offline or the SSH channel is down. Try again in a moment.",
  },
  not_found: {
    heading: "File not found",
    body: "No such file at that path. Check the URL or ask the agent to re-send.",
  },
  too_large: {
    heading: "File too large",
    body: "The 2 MB cap keeps the editor responsive. Ask for a smaller slice of the file.",
  },
  not_a_file: {
    heading: "Not a regular file",
    body: "Directories, sockets, and device files aren't viewable via file URLs.",
  },
  path_forbidden: {
    heading: "Path forbidden",
    body: "/proc, /sys, and /dev are not accessible via file URLs.",
  },
  path_traversal: {
    heading: "Invalid path",
    body: ". and .. segments aren't allowed in file URLs.",
  },
  path_must_be_absolute: {
    heading: "Invalid path",
    body: "The path in a file URL must be absolute (start with /).",
  },
  unknown_host: {
    heading: "Unknown host",
    body: "That host is not registered on this server, or you don't have access to it.",
  },
  ssh_timeout: {
    heading: "SSH timeout",
    body: "The host is slow or unreachable. Try again in a moment.",
  },
  invalid_hostname: {
    heading: "Invalid hostname",
    body: "The hostname in the URL contains unsupported characters.",
  },
  invalid_body: {
    heading: "Invalid request",
    body: "Something went wrong preparing the request. Refresh and try again.",
  },
  generic: {
    heading: "Can't fetch the file",
    body: "Something went wrong fetching the file. Try again, or check the URL.",
  },
};

/**
 * Phase 75 D-02: given a caught error and the original URL, return the
 * human-readable copy to render in the modal's error panel. The
 * `err.message` field carries the backend error-class string when the
 * error originates from `fetchHostFileUrl` (which throws `Error(class)`
 * on axios errors carrying `response.data.error === "<class>"`). For
 * `permission_denied` we splice in the hostname parsed from the URL to
 * make the sentence more actionable per the plan's suggested copy.
 *
 * For tailnet-URL errors (the Phase 40 flow), `err.message` is the raw
 * error text — none of the class keys match, so the "generic" fallback
 * renders. This preserves the Phase 40 in-body error UX. The Phase 40
 * error copy about "the agent's temporary server may have shut down"
 * is retained as the tailnet-specific override at the render site.
 */
function classifyModalError(
  err: unknown,
  url: string,
): { heading: string; body: string } {
  const message = err instanceof Error ? err.message : "";
  // Special case FIRST: permission_denied weaves in the hostname parsed
  // from the URL for a more actionable sentence. Keeping this before the
  // map lookup avoids the need for a placeholder map entry.
  if (message === "permission_denied") {
    const hostMatch = url.match(FILE_URL_HOSTNAME_RE);
    const host = hostMatch ? hostMatch[1] : "the host";
    return {
      heading: "Permission denied",
      body: `The server's SSH user can't read this file on ${host}. Ask the box owner to widen access.`,
    };
  }
  const copy = FILE_URL_ERROR_COPY[message];
  return copy ?? FILE_URL_ERROR_COPY.generic;
}

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
 * rev-2 draft-guard confirm gate (UI-SPEC L167-169, user explicit
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

  // Shape (2026-09-28) — classify by filename to decide viewer vs. editor.
  // Media kinds (image/audio/video and svg-in-rendered-mode) render a native
  // browser viewer straight from the URL and skip the base64→text fetch that
  // the editor needs. SVG can toggle to code mode, which flips the modal back
  // into the text-editor fetch flow.
  const kind: FileChipKind = useMemo(
    () => classifyFileChipKind(filename),
    [filename],
  );
  const [svgViewMode, setSvgViewMode] = useState<"rendered" | "code">("rendered");
  const usesEditorFetch =
    kind === "plain" || (kind === "svg" && svgViewMode === "code");

  // Pitfall 6: mtime sentinel MUST be stable across renders. Captured ONCE
  // at fetch-success, reset only when the modal closes.
  const initialMtimeRef = useRef<number>(0);
  // Rev-2: bypass the draft-guard confirm on save-success closes.
  const savingRef = useRef<boolean>(false);

  // D-04 fresh-fetch-on-open effect. `filename` IS included in the deps but
  // is derivable from `url`, so it should never change independently — the
  // extra dep is harmless (rev-3 M7: prior version's comment claimed it was
  // excluded, but the array said otherwise; comment now matches reality).
  //
  // Shape (2026-09-28) — skips the fetch entirely for pure-media kinds
  // (image/audio/video and svg-in-rendered-mode) since those render straight
  // from the URL. Fires normally for plain text kinds and for SVG when the
  // user has toggled to code mode.
  useEffect(() => {
    if (!open) {
      // Reset state on close so re-open starts fresh (D-06 stateless).
      setFetchState({ status: "loading" });
      setIsDirty(false);
      initialMtimeRef.current = 0;
      savingRef.current = false;
      setSvgViewMode("rendered");
      return;
    }

    if (!usesEditorFetch) {
      // Media viewer path — no fetch needed; render the native element
      // pointing at the URL. Leave fetchState untouched.
      return;
    }

    // Open transition — begin fresh fetch.
    let cancelled = false;
    setFetchState({ status: "loading" });
    setIsDirty(false);
    savingRef.current = false;

    // Phase 75 D-01: dispatch by URL shape. Both helpers return
    // TailnetFetchResult so the .then() chain below is byte-identical
    // for both. Uses a fresh non-global regex per RESEARCH Pitfall 6.
    const isFileUrl = FILE_URL_DISPATCH_RE.test(url);
    const fetchPromise = isFileUrl
      ? fetchHostFileUrl(url)
      : fetchTailnetUrl(url);

    fetchPromise
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
  }, [open, url, filename, usesEditorFetch]);

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
          <DialogTitle className="sr-only">
            {usesEditorFetch ? `Edit ${filename}` : `View ${filename}`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {usesEditorFetch
              ? "Textarea to edit the file's contents and save the result as an attachment on your next reply."
              : "Native browser viewer for the file's contents."}
          </DialogDescription>

          {/* Header — filename + optional "from {agentIdentityName}" muted
              sub-header + optional SVG view/code toggle + glass X close. */}
          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-3"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <div
              className="text-[15px] font-semibold text-[#f0ebe0] truncate"
              title={filename}
            >
              {filename}
            </div>
            {agentIdentityName ? (
              <div className="text-xs text-[#a89a80]">
                from {agentIdentityName}
              </div>
            ) : null}
            <div className="flex-1" />
            {/* SVG view/code toggle — only rendered for .svg files. Default
                view is "rendered"; toggle flips to "code" which triggers the
                text-editor fetch and shows the source in the code editor. */}
            {kind === "svg" ? (
              <button
                type="button"
                onClick={() =>
                  setSvgViewMode((m) => (m === "rendered" ? "code" : "rendered"))
                }
                aria-label={
                  svgViewMode === "rendered" ? "View source code" : "View rendered"
                }
                title={
                  svgViewMode === "rendered" ? "View source code" : "View rendered"
                }
                className="shrink-0 cursor-pointer inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
              >
                {svgViewMode === "rendered" ? (
                  <>
                    <Code2 className="size-3.5" aria-hidden />
                    <span>Source</span>
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5" aria-hidden />
                    <span>Rendered</span>
                  </>
                )}
              </button>
            ) : null}
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

          {/* Body branches — media viewer / loading / error / ready.
              Media kinds (image/audio/video and svg-in-rendered-mode) render
              a native browser viewer directly from the URL; no fetch, no
              text editor. Text kinds and svg-in-code-mode fall through to
              the existing loading/error/ready flow.
              Phase 40 UI-SPEC L110 tailnet copy kept verbatim as the
              tailnet-URL default (agent-server auto-kill guidance).
              Phase 75 D-02 layers per-class human copy on top for file
              URLs — see FILE_URL_ERROR_COPY + classifyModalError above.
              We do NOT delegate to GlobalFileTab's error branch here
              because the copy is Phase-40/75-specific. */}
          {!usesEditorFetch ? (
            <MediaViewer kind={kind} url={url} filename={filename} />
          ) : fetchState.status === "error" ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
              <div className="text-lg font-semibold text-[#f0ebe0]">
                {FILE_URL_DISPATCH_RE.test(url)
                  ? classifyModalError(new Error(fetchState.error), url).heading
                  : "Can't fetch the current file."}
              </div>
              <div className="text-sm text-[#a89a80] max-w-md">
                {/* UI-SPEC L110 verbatim tailnet copy — kept intact via
                    the fallback branch below (the literal apostrophe is
                    required by an existing grep gate so we render it as
                    a JS string expression rather than JSX text to avoid
                    the react/no-unescaped-entities lint rule). */}
                {FILE_URL_DISPATCH_RE.test(url)
                  ? classifyModalError(new Error(fetchState.error), url).body
                  : "The agent's temporary server may have shut down (they auto-kill after 30 minutes) or the network is unreachable. Ask the agent to re-share the file if you still want to edit it."}
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
                filename={filename}
              />
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Native browser viewer for media kinds (image, audio, video, and svg in
 * rendered mode). All four kinds source directly from the file URL — the
 * browser fetches with the current Skynet session cookies and renders
 * inline. Image / SVG cap at max-height so a tall picture doesn't blow out
 * the modal; audio is a single row of native controls in the middle of the
 * body; video renders with native controls and no autoplay (per shape
 * philosophy). Read-only — no save button, no draft state, no download
 * here (the chip's own download button handles save-to-disk).
 */
function MediaViewer({
  kind,
  url,
  filename,
}: {
  kind: FileChipKind;
  url: string;
  filename: string;
}): JSX.Element {
  if (kind === "image" || kind === "svg") {
    return (
      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6 bg-black/30">
        <img
          src={url}
          alt={filename}
          className="max-w-full max-h-full object-contain"
          draggable={false}
        />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-full max-w-xl"
        />
      </div>
    );
  }
  // video
  return (
    <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6 bg-black/30">
      <video
        src={url}
        controls
        preload="metadata"
        className="max-w-full max-h-full"
      />
    </div>
  );
}
