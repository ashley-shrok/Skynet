import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { cn } from "@/lib/utils";
import {
  FileView,
  FileViewModeSwitcher,
} from "./file-viewers/FileView";
import {
  fileViewNeedsContent,
  resolveFileViewer,
  resolveMode,
  type BinaryDraft,
} from "./file-viewers/registry";
import { FileSpeakButton } from "./file-viewers/FileSpeakButton";
import { describeFileUrlError, useFileUrlContent } from "./file-url-content";

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
 *   - Error: rich per-class copy (describeFileUrlError) with a close button.
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
   * Absent when there's no conversation to send to (a file pane whose
   * source conversation isn't open): the file opens view-only, no Save.
   */
  onStageEditedFile?: (filename: string, content: string | Uint8Array) => void;
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

  // Rev-2: bypass the draft-guard confirm on save-success closes.
  const savingRef = useRef<boolean>(false);

  // D-04 fresh fetch on every open, skipped when the current view mode
  // doesn't need the content (see usesEditorFetch).
  const fetchState = useFileUrlContent({ url, enabled: open && usesEditorFetch });

  // Reset on close so re-open starts fresh (D-06 stateless); a new read
  // starts clean.
  useEffect(() => {
    if (!open) {
      setIsDirty(false);
      setDraft("");
      savingRef.current = false;
      setViewMode(null);
      return;
    }
    if (!usesEditorFetch) return;
    setIsDirty(false);
    savingRef.current = false;
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
      if (!onStageEditedFile) return;
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

  const errorCopy =
    fetchState.status === "error" ? describeFileUrlError(fetchState.error, url) : null;
  const errorHeading = errorCopy?.heading ?? "";
  const errorBody = errorCopy?.body ?? "";

  // Foot (Close + Save) for editable content: fetched text, or a mode that
  // edits in place from the URL (PDF annotations → binary draft).
  const urlModeEditable =
    !usesEditorFetch && resolveMode(resolveFileViewer(filename), viewMode).editable;
  const canSave = !!onStageEditedFile;
  const showFoot =
    canSave &&
    (urlModeEditable ||
      (usesEditorFetch &&
        fetchState.status !== "error" &&
        !(fetchState.status === "ready" && fetchState.data.isText === false)));

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
      hideSpeakButton={true}
      onBinaryDraftChange={setBinaryDraft}
      readOnly={!canSave}
    />
  );
  const viewOnlyNote = canSave ? null : (
    <div
      className="shrink-0 text-[12px] text-[#a89a80] pb-2"
      data-testid="editable-file-modal-view-only-note"
    >
      View only — open the conversation this file came from to send an edited copy back.
    </div>
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
          <>
            {usesEditorFetch &&
              fetchState.status === "ready" &&
              fetchState.data.isText !== false && (
                <FileSpeakButton filename={filename} text={draft} />
              )}
            <FileViewModeSwitcher
              filename={filename}
              mode={viewMode}
              onModeChange={setViewMode}
            />
          </>
        }
      />

      {!usesEditorFetch ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {viewOnlyNote}
          {fileView}
        </div>
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
          {viewOnlyNote}
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

