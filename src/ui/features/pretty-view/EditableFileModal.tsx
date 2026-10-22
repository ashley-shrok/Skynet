import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, ModalBody } from "@/components/modal";
import { KitButton, KitEmpty, kitConfirm } from "@/components/kit";
import { FileView } from "./file-viewers/FileView";
import {
  fileViewNeedsContent,
  resolveFileViewer,
  resolveMode,
  type BinaryDraft,
} from "./file-viewers/registry";
import {
  FileViewSwitch,
  FileWindowActions,
  FileWindowHead,
  fileMenuItems,
  useFileEditing,
  useKeepScroll,
  useMarkdownSwitchHost,
} from "./file-viewers/FileWindowHead";
import { isSpeakableFile } from "./file-viewers/file-speak";
import { MarkdownSwitchHostContext } from "./markdown-mode-switch";
import { folderOfPath, parseSkynetFileUrl } from "./file-url";
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
 * Head: the shared file-window head (FileWindowHead) — type tile, name,
 * "machine · folder", read aloud for prose, the view switch (markdown's
 * Formatted / Plain text included), then Edit or Save, then ⋯ (Download,
 * Copy path). How the file opens follows its type (fileOpenKind): pictures
 * and media just show; documents open for reading with Edit; code, text and
 * tables open ready to type. Save here attaches the edited copy to the next
 * message (the chip in the compose box shows it went there).
 *
 * Body: the shared <FileView> (file-viewers/registry decides the viewer).
 *   - URL-sourced modes (image / audio / video / rendered SVG) render
 *     straight from the URL. No fetch.
 *   - Known-binary types show the "can't preview" notice. No fetch.
 *   - Content modes fetch the bytes; non-text bytes (server sniff, else
 *     client sniff) show the notice instead of decoding garbage.
 *   - Error: rich per-class copy (describeFileUrlError) with a close button.
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
  // so the head's Save button can hand it back to `handleSave`.
  const [draft, setDraft] = useState<string>("");

  // The registry decides per view mode whether the file's content is needed.
  // URL-sourced modes (media, rendered SVG) and known-binary types skip the
  // fetch; switching SVG to Source flips the modal into the fetch flow.
  const [viewMode, setViewMode] = useState<string | null>(null);
  // Unsaved binary edits (PDF annotations) — saved as the edited file's bytes.
  const [binaryDraft, setBinaryDraft] = useState<BinaryDraft | null>(null);
  const { host: markdownHost, formattedUnavailable } = useMarkdownSwitchHost();
  const editing = useFileEditing({ filename, dirty: isDirty });
  const bodyRef = useKeepScroll(`${editing.locked}:${editing.draftKey}`);
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
  // One discard question at a time — a second close request while it is
  // open (Esc, head X) is ignored rather than stacking another dialog.
  const confirmingRef = useRef(false);
  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (!nextOpen && isDirty && !savingRef.current) {
        if (confirmingRef.current) return;
        confirmingRef.current = true;
        try {
          const confirmed = await kitConfirm({
            title: "Discard unsaved changes?",
            body: "Your edits to this file haven't been saved.",
            confirmLabel: "Discard",
            cancelLabel: "Keep editing",
            destructive: true,
          });
          if (!confirmed) return;
        } finally {
          confirmingRef.current = false;
        }
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

  // Head save button — fires with the current draft, uses the same
  // handleSave path as FileView's internal save would.
  // Catch here (rather than let it become an unhandled rejection) since
  // there's no in-modal error surface for save failures today —
  // handleSave already resets savingRef on throw so the next close will
  // fire the draft-guard confirm correctly.
  const onHeadSave = useCallback(() => {
    const save = binaryDraft
      ? binaryDraft.getBytes().then((bytes) => handleSave(bytes))
      : handleSave(draft);
    save.catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("EditableFileModal save failed:", err);
    });
  }, [handleSave, draft, binaryDraft]);

  const errorCopy =
    fetchState.status === "error" ? describeFileUrlError(fetchState.error, url) : null;
  const errorHeading = errorCopy?.heading ?? "";
  const errorBody = errorCopy?.body ?? "";

  // Editable here: a conversation to send the copy to, and either a mode
  // that edits in place from the URL (PDF annotations → binary draft) or
  // fetched text in an editable view (or one already holding edits).
  const canSave = !!onStageEditedFile;
  const currentMode = resolveMode(resolveFileViewer(filename), viewMode);
  const urlModeEditable = !usesEditorFetch && currentMode.editable;
  const textReady =
    usesEditorFetch && fetchState.status === "ready" && fetchState.data.isText !== false;
  const editable = canSave && (urlModeEditable || (textReady && (currentMode.editable || isDirty)));

  const parsed = parseSkynetFileUrl(url);
  const subtitle = parsed ? `${parsed.host} · ${folderOfPath(parsed.path)}` : undefined;

  const fileView = (
    <MarkdownSwitchHostContext.Provider value={markdownHost}>
      <FileView
        key={editing.draftKey}
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
        readOnly={!canSave || editing.locked}
      />
    </MarkdownSwitchHostContext.Provider>
  );
  const viewOnlyNote = canSave ? null : (
    <div
      className="shrink-0 text-[12px] text-[var(--k-t3)] pb-2"
      data-testid="editable-file-modal-view-only-note"
    >
      View only — open the conversation this file came from to send an edited copy back.
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => void handleOpenChange(o)}
      size="editor"
      data-testid="editable-file-modal"
    >
      <FileWindowHead
        filename={filename}
        subtitle={subtitle}
        speakText={textReady && isSpeakableFile(filename) ? draft : null}
        switcher={
          // Markdown's switch only once there's markdown to show.
          !/\.md$/i.test(filename) || textReady ? (
            <FileViewSwitch
              filename={filename}
              mode={viewMode}
              onModeChange={setViewMode}
              formattedUnavailable={formattedUnavailable}
            />
          ) : null
        }
        actions={
          editable ? (
            <FileWindowActions
              kind={editing.kind}
              editing={editing.editing}
              editable={editable}
              dirty={isDirty}
              saving={false}
              onEdit={editing.startEditing}
              onCancel={() => void editing.cancelEditing().then((done) => { if (done) setBinaryDraft(null); })}
              onSave={onHeadSave}
            />
          ) : null
        }
        menuItems={fileMenuItems({ downloadUrl: url, filename, path: parsed?.path })}
      />

      {!usesEditorFetch ? (
        <div className="flex-1 min-h-0 flex flex-col px-6 pb-4 max-sm:px-5">
          {viewOnlyNote}
          {fileView}
        </div>
      ) : fetchState.status === "error" ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          <KitEmpty
            title={errorHeading}
            body={<span className="block max-w-md">{errorBody}</span>}
            action={
              <KitButton
                onClick={() => onOpenChange(false)}
                data-testid="editable-file-modal-error-close"
              >
                Close
              </KitButton>
            }
          />
        </div>
      ) : (
        <ModalBody ref={bodyRef} className="p-0 overflow-y-auto flex flex-col px-6 pt-1 pb-4">
          {viewOnlyNote}
          {fileView}
        </ModalBody>
      )}
    </Modal>
  );
}
