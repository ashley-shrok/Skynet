import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { cn } from "@/lib/utils";
import {
  fetchTailnetUrl,
  fetchHostFileUrl,
} from "@/api/editable-file-api";
import type { TabState } from "./IdentityFileTab";
import {
  FileView,
  FileViewModeSwitcher,
  type FileViewData,
} from "./file-viewers/FileView";
import {
  fileViewNeedsContent,
  resolveFileViewer,
  resolveMode,
  type BinaryDraft,
} from "./file-viewers/registry";
import { base64ToBytes, decodeUtf8, looksLikeText } from "./file-viewers/text-sniff";

/**
 * Monotonic mtime counter (rev-3 2026-08-14 code-review M4). Previously the
 * modal used `Date.now()` as the mtime sentinel; two sub-millisecond opens
 * would collide, FileView's mtime-keyed draft reseed would
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
 * back to the "generic" entry.
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

function classifyModalError(
  err: unknown,
  url: string,
): { heading: string; body: string } {
  const message = err instanceof Error ? err.message : "";
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
 * EditableFileModal — file preview + edit modal for chat-shared files.
 *
 * Modal-unification 2026-09-29 (revised 2026-09-30 UAT): composes from
 * the canonical <Modal> shell with the standard blocking backdrop. The
 * original design intent was to keep the composer typable underneath so
 * the user could draft a reply while reading a shared file — but the
 * `blocking={false}` escape hatch has since been retired fleet-wide
 * (every modal blocks, no exceptions). If the read-and-type case
 * matters here, the user opens the file, remembers what they wanted to
 * write, closes the modal, then types.
 *
 * Head: title = filename. No meta, no subtitle, no "from <agentIdentityName>"
 * attribution (user 2026-09-29 — those were removed). For file types with
 * several view modes (e.g. SVG Rendered ↔ Source) the head renders the
 * shared <FileViewModeSwitcher> in the actions slot next to the close X.
 *
 * Body: the shared <FileView> (file-viewers/registry decides the viewer).
 *   - URL-sourced modes (image / audio / video / rendered SVG) render
 *     straight from the URL. No fetch.
 *   - Known-binary types show the "can't preview" notice. No fetch.
 *   - Content modes fetch the bytes; non-text bytes (server sniff, else
 *     client sniff) show the notice instead of decoding garbage.
 *   - Error: rich per-class copy (FILE_URL_ERROR_COPY) with a close button.
 *
 * Foot: rendered ONLY for editable content (fetched text). Viewers and
 * the binary notice get no foot — the head X is the only close path (user
 * 2026-09-29: "it should not show at all on file types that can't be
 * edited"). Foot has Close (secondary) + Save (primary). Save calls the
 * existing stage-and-close flow; Save is gated on `isDirty` (nothing to
 * stage if the draft matches the fetched content).
 *
 * Locked D-XX behaviors:
 *   D-03: additive edit affordance opens THIS modal; the modal never wraps
 *         the anchor.
 *   D-04: fresh fetch every open, visible in-body error on failure — never
 *         silently fall back to stale bytes.
 *   D-05: chrome forks from the canonical Modal (post-unification); the
 *         body is the shared FileView with `hideSaveButton`.
 *   D-06: editor stateless — mtime sentinel captured once at open, save =
 *         fresh attachment. Draft-guard confirm on close if dirty.
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
   * — depositing the edit as a chip in the ComposeBox attachment strip.
   */
  onStageEditedFile: (filename: string, content: string | Uint8Array) => void;
}

export default function EditableFileModal({
  open,
  onOpenChange,
  messageEventId: _messageEventId,
  url,
  filename,
  agentIdentityName: _agentIdentityName,
  onStageEditedFile,
}: EditableFileModalProps): JSX.Element {
  const [fetchState, setFetchState] = useState<TabState<FileViewData>>({
    status: "loading",
  });
  const [isDirty, setIsDirty] = useState(false);
  // Local draft mirror — FileView exposes it via `onDraftContentChange`
  // so the modal's own foot Save button can hand it back to `handleSave`.
  const [draft, setDraft] = useState<string>("");

  // The registry decides per view mode whether the file's content is needed.
  // URL-sourced modes (media, rendered SVG) and known-binary types skip the
  // fetch; switching SVG to Source flips the modal into the fetch flow.
  const [viewMode, setViewMode] = useState<string | null>(null);
  // Unsaved binary edits (PDF annotations) — saved as the edited file's bytes.
  const [binaryDraft, setBinaryDraft] = useState<BinaryDraft | null>(null);
  const usesEditorFetch = useMemo(
    () => fileViewNeedsContent(filename, viewMode, true),
    [filename, viewMode],
  );

  // Pitfall 6: mtime sentinel MUST be stable across renders. Captured ONCE
  // at fetch-success, reset only when the modal closes.
  const initialMtimeRef = useRef<number>(0);
  // Rev-2: bypass the draft-guard confirm on save-success closes.
  const savingRef = useRef<boolean>(false);

  // D-04 fresh-fetch-on-open effect. Skipped when the current view mode
  // doesn't need the content (see usesEditorFetch).
  useEffect(() => {
    if (!open) {
      // Reset state on close so re-open starts fresh (D-06 stateless).
      setFetchState({ status: "loading" });
      setIsDirty(false);
      setDraft("");
      initialMtimeRef.current = 0;
      savingRef.current = false;
      setViewMode(null);
      return;
    }

    if (!usesEditorFetch) {
      return;
    }

    let cancelled = false;
    setFetchState({ status: "loading" });
    setIsDirty(false);
    savingRef.current = false;

    // Phase 75 D-01: dispatch by URL shape.
    const isFileUrl = FILE_URL_DISPATCH_RE.test(url);
    const fetchPromise = isFileUrl
      ? fetchHostFileUrl(url)
      : fetchTailnetUrl(url);

    fetchPromise
      .then((result) => {
        if (cancelled) return;
        initialMtimeRef.current = ++mtimeCounter;
        // Decode base64 -> raw bytes -> UTF-8 (rev-3 2026-08-14 code-review
        // B2: TextDecoder avoids mojibake on non-ASCII content). Text-ness:
        // the extension, else the server's byte sniff (only sent when the
        // extension missed), else the same sniff client-side.
        const bytes = base64ToBytes(result.contentBase64);
        const isText =
          result.isTextByExt || (result.isTextByBytes ?? looksLikeText(bytes));
        setFetchState({
          status: "ready",
          data: {
            content: isText ? decodeUtf8(bytes) : "",
            mtime: initialMtimeRef.current,
            isText,
            bytes,
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
        // eslint-disable-next-line no-alert
        const confirmed = window.confirm("Discard unsaved changes?");
        if (!confirmed) return;
      }
      onOpenChange(nextOpen);
    },
    [isDirty, onOpenChange],
  );

  // Save handler — mtime is discarded (D-06: editor is stateless; there is
  // no host file to conflict-check against). Sets savingRef FIRST so the
  // subsequent onOpenChange(false) bypasses the draft-guard confirm.
  const handleSave = useCallback(
    async (content: string | Uint8Array): Promise<void> => {
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

  // FileView's onSave signature includes an expectedMtime we don't
  // need; adapt to the local handleSave shape.
  const onFileViewSave = useCallback(
    async (content: string, _expectedMtime: number): Promise<void> => {
      await handleSave(content);
    },
    [handleSave],
  );

  // Foot Save button — fires with the current draft, uses the same
  // handleSave path as FileView's internal save would.
  // Catch here (rather than let it become an unhandled rejection) since
  // there's no in-modal error surface for foot-save failures today —
  // handleSave already resets savingRef on throw so the next close will
  // fire the draft-guard confirm correctly.
  const onFootSave = useCallback(() => {
    const save = binaryDraft
      ? binaryDraft.getBytes().then((bytes) => handleSave(bytes))
      : handleSave(draft);
    save.catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("EditableFileModal foot save failed:", err);
    });
  }, [handleSave, draft, binaryDraft]);

  const isFileUrl = FILE_URL_DISPATCH_RE.test(url);
  const errorHeading =
    fetchState.status === "error"
      ? isFileUrl
        ? classifyModalError(new Error(fetchState.error), url).heading
        : "Can't fetch the current file."
      : "";
  const errorBody =
    fetchState.status === "error"
      ? isFileUrl
        ? classifyModalError(new Error(fetchState.error), url).body
        : "The agent's temporary server may have shut down (they auto-kill after 30 minutes) or the network is unreachable. Ask the agent to re-share the file if you still want to edit it."
      : "";

  // Foot (Close + Save) for editable content: fetched text, or a mode that
  // edits in place from the URL (PDF annotations → binary draft).
  const urlModeEditable =
    !usesEditorFetch && resolveMode(resolveFileViewer(filename), viewMode).editable;
  const showFoot =
    urlModeEditable ||
    (usesEditorFetch &&
      fetchState.status !== "error" &&
      !(fetchState.status === "ready" && fetchState.data.isText === false));

  const fileView = (
    <FileView
      filename={filename}
      state={fetchState}
      mediaUrl={url}
      downloadUrl={url}
      onSave={onFileViewSave}
      onDraftChange={setIsDirty}
      onDraftContentChange={setDraft}
      hideSaveButton={true}
      mode={viewMode ?? undefined}
      onModeChange={setViewMode}
      hideModeSwitcher={true}
      onBinaryDraftChange={setBinaryDraft}
    />
  );

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      size="editor"
      data-testid="editable-file-modal"
    >
      <ModalHead
        title={filename}
        actions={
          <FileViewModeSwitcher
            filename={filename}
            mode={viewMode}
            onModeChange={setViewMode}
          />
        }
      />

      {!usesEditorFetch ? (
        <div className="flex-1 min-h-0 flex flex-col">{fileView}</div>
      ) : fetchState.status === "error" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
          <div className="text-lg font-semibold text-[#f0ebe0]">
            {errorHeading}
          </div>
          <div className="text-sm text-[hsla(var(--pv-id-hue),22%,88%,0.7)] max-w-md">
            {errorBody}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            data-testid="editable-file-modal-error-close"
            className={cn(
              "mt-2 px-4 py-2 rounded-md text-sm cursor-pointer",
              "bg-black/20 border border-white/10",
              "hover:bg-black/30",
              "text-[#e8e4d8]",
            )}
          >
            Close
          </button>
        </div>
      ) : (
        <ModalBody className="p-0 overflow-y-auto flex flex-col px-6 py-4">
          {fileView}
        </ModalBody>
      )}

      {showFoot && (
        <ModalFoot>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            data-testid="editable-file-modal-close-foot"
            className={cn(
              "px-3 py-1.5 rounded-md text-[12.5px] cursor-pointer",
              "bg-black/20 border border-white/10",
              "hover:bg-black/30",
              "text-[#e8e4d8]",
            )}
          >
            Close
          </button>
          <button
            type="button"
            onClick={onFootSave}
            disabled={!isDirty || (!binaryDraft && fetchState.status !== "ready")}
            data-testid="editable-file-modal-save"
            className={cn(
              "px-4 py-1.5 rounded-md text-[12.5px] font-medium cursor-pointer",
              "bg-[hsla(var(--pv-id-hue),65%,45%,0.75)]",
              "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.85)]",
              "border border-[hsla(var(--pv-id-hue),65%,55%,0.7)]",
              "text-[#f4f1e8]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            Save
          </button>
        </ModalFoot>
      )}
    </Modal>
  );
}

