import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, FileQuestion } from "lucide-react";
import { Skeleton } from "@/components/skeleton";
import { cn } from "@/lib/utils";
import type { TabState } from "../IdentityFileTab";
import {
  mimeFor,
  resolveFileViewer,
  resolveMode,
  type BinaryDraft,
  type FileViewMode,
  type FileViewerEntry,
} from "./registry";

/**
 * FileView — the shared body for every surface that opens an arbitrary file
 * (chat file modal, skills editor, runbooks editor, workspace file browser).
 *
 * Looks the filename up in the file-viewer registry and renders the matching
 * mode: a native media viewer, the text/code editor, or the "can't preview"
 * notice for binary content. Hosts keep their own chrome (where Save lives,
 * delete buttons, back/download, close guards) and own fetching + saving;
 * FileView owns the draft, the mode switcher, and the viewer choice.
 *
 * Draft seeding: the draft is reset from `state.data.content` whenever the
 * fetched mtime changes, derived during render (not in an effect) because
 * MDXEditor is uncontrolled after mount — an effect-based reseed lands after
 * the editor has already mounted with the stale draft.
 */

export interface FileViewData {
  /** Decoded text. "" when the file isn't text. */
  content: string;
  /** Version token; a change reseeds the draft (save echo, reload, tab switch). */
  mtime: number;
  /** false → the bytes aren't text; content-mode views show the binary notice. */
  isText?: boolean;
  /** Raw bytes when the host has them; used to build blob URLs for media. */
  bytes?: Uint8Array;
}

export interface FileViewProps {
  filename: string;
  state: TabState<FileViewData>;
  /**
   * Browser-loadable URL for the file. When set, "url" modes (media, rendered
   * SVG) render from it directly and don't need `state` to be ready.
   */
  mediaUrl?: string | null;
  /** Offered on the binary notice when set. */
  downloadUrl?: string | null;
  onSave?: (content: string, expectedMtime: number) => Promise<void>;
  /** Host renders its own Save button (fed by onDraftContentChange). */
  hideSaveButton?: boolean;
  /** Fires when the draft diverges from / converges back to the loaded content. */
  onDraftChange?: (dirty: boolean) => void;
  /** Fires with the raw draft on every change, for hosts with their own Save. */
  onDraftContentChange?: (draft: string) => void;
  /** Extra controls at the start of the toolbar row (e.g. a delete button). */
  toolbarStart?: ReactNode;
  /** Controlled mode id. Omit to let FileView keep it. */
  mode?: string;
  onModeChange?: (mode: string) => void;
  /** Host renders <FileViewModeSwitcher> itself (e.g. in a modal head). */
  hideModeSwitcher?: boolean;
  /**
   * Binary edits (PDF annotations): the current unsaved draft, or null.
   * Hosts with their own Save button write `await draft.getBytes()` and
   * then call `draft.markSaved(bytes)`.
   */
  onBinaryDraftChange?: (draft: BinaryDraft | null) => void;
  /** Used by FileView's own Save button when a binary draft is pending. */
  onSaveBytes?: (bytes: Uint8Array, expectedMtime: number) => Promise<void>;
}

export function FileViewModeSwitcher({
  filename,
  mode,
  onModeChange,
}: {
  filename: string;
  mode: string | null | undefined;
  onModeChange: (mode: string) => void;
}): JSX.Element | null {
  const entry = resolveFileViewer(filename);
  if (entry.modes.length < 2) return null;
  const current = resolveMode(entry, mode);
  return (
    <div className="pv-variant-tabs" role="tablist" aria-label="View mode">
      {entry.modes.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={current.id === m.id}
          onClick={() => onModeChange(m.id)}
          data-testid={`file-view-mode-${m.id}`}
          className={cn("pv-variant-tab", current.id === m.id && "on")}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function FileUnavailableNotice({
  heading = "Can't preview this file",
  body = "This file type can't be shown here.",
  downloadUrl,
  filename,
}: {
  heading?: string;
  body?: string;
  downloadUrl?: string | null;
  filename?: string;
}): JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 h-full min-h-[400px] p-6 text-center"
      data-testid="file-view-unavailable"
    >
      <FileQuestion size={28} className="text-[#a89a80]" aria-hidden />
      <div className="text-sm font-semibold text-[#e8e4d8]">{heading}</div>
      <div className="text-sm text-[#a89a80]">{body}</div>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          download={filename}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold no-underline",
            "bg-[hsla(var(--pv-id-hue,220),80%,60%,0.18)] border border-[hsla(var(--pv-id-hue,220),80%,70%,0.28)]",
            "text-[#e8e4d8] hover:bg-[hsla(var(--pv-id-hue,220),80%,60%,0.28)]",
          )}
        >
          <Download size={14} aria-hidden />
          Download
        </a>
      ) : null}
    </div>
  );
}

/**
 * Browser-loadable src for "url" modes: the host's URL when given, else a
 * blob URL built from fetched bytes (or from the text for text-based formats
 * like SVG). Revoked when it changes or the view unmounts.
 */
function useModeSrc(
  entry: FileViewerEntry,
  mode: FileViewMode,
  filename: string,
  mediaUrl: string | null | undefined,
  state: TabState<FileViewData>,
): string | null {
  const data = state.status === "ready" ? state.data : null;
  const blobUrl = useMemo(() => {
    if (mode.needs !== "url" || mediaUrl || !data) return null;
    const type = mimeFor(entry, filename);
    if (data.bytes) return URL.createObjectURL(new Blob([data.bytes as BlobPart], { type }));
    if (data.isText !== false) return URL.createObjectURL(new Blob([data.content], { type }));
    return null;
  }, [entry, mode.needs, filename, mediaUrl, data]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  return mode.needs === "url" ? (mediaUrl ?? blobUrl) : null;
}

export function FileView({
  filename,
  state,
  mediaUrl,
  downloadUrl,
  onSave,
  hideSaveButton = false,
  onDraftChange,
  onDraftContentChange,
  toolbarStart,
  mode: modeProp,
  onModeChange,
  hideModeSwitcher = false,
  onBinaryDraftChange,
  onSaveBytes,
}: FileViewProps): JSX.Element {
  const entry = resolveFileViewer(filename);
  const [innerMode, setInnerMode] = useState<string | null>(null);
  const mode = resolveMode(entry, modeProp ?? innerMode);
  const setMode = useCallback(
    (next: string) => {
      setInnerMode(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );

  const [draft, setDraft] = useState<string>(() =>
    state.status === "ready" ? state.data.content : "",
  );
  const [lastSeenMtime, setLastSeenMtime] = useState<number | null>(() =>
    state.status === "ready" ? state.data.mtime : null,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (state.status === "ready" && state.data.mtime !== lastSeenMtime) {
    setLastSeenMtime(state.data.mtime);
    setDraft(state.data.content);
    setSaveError(null);
  }

  useEffect(() => {
    if (!onDraftContentChange || state.status !== "ready") return;
    onDraftContentChange(draft);
  }, [draft, state, onDraftContentChange]);

  const [binaryDraft, setBinaryDraft] = useState<BinaryDraft | null>(null);
  const handleBinaryDraft = useCallback(
    (next: BinaryDraft | null) => {
      setBinaryDraft(next);
      onBinaryDraftChange?.(next);
    },
    [onBinaryDraftChange],
  );

  // Dirty = unsaved text edits or a pending binary draft. Binary modes (PDF)
  // never fetch content, so this can't wait for state to be ready.
  useEffect(() => {
    if (!onDraftChange) return;
    const textDirty = state.status === "ready" && draft !== state.data.content;
    onDraftChange(textDirty || binaryDraft !== null);
  }, [draft, state, binaryDraft, onDraftChange]);

  const handleSave = useCallback(async () => {
    const mtime = state.status === "ready" ? state.data.mtime : 0;
    if (binaryDraft && onSaveBytes) {
      setSaving(true);
      setSaveError(null);
      try {
        const bytes = await binaryDraft.getBytes();
        await onSaveBytes(bytes, mtime);
        binaryDraft.markSaved(bytes);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (state.status !== "ready" || !onSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft, state.data.mtime);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [state, draft, onSave, binaryDraft, onSaveBytes]);

  const src = useModeSrc(entry, mode, filename, mediaUrl, state);

  const showSwitcher = !hideModeSwitcher && entry.modes.length > 1;
  // Save shows in editable modes, and in any mode while the draft is dirty
  // so edits made in one mode (e.g. diff Raw) aren't stranded in another.
  const canEdit =
    state.status === "ready" &&
    state.data.isText !== false &&
    (mode.editable || draft !== state.data.content);
  const showSave =
    !hideSaveButton && ((canEdit && !!onSave) || (!!binaryDraft && !!onSaveBytes));
  const toolbar =
    toolbarStart || showSwitcher || showSave ? (
      <div className="flex justify-end gap-2 shrink-0 items-center">
        {toolbarStart}
        {showSwitcher ? (
          <div className="mr-auto order-first">
            <FileViewModeSwitcher filename={filename} mode={mode.id} onModeChange={setMode} />
          </div>
        ) : null}
        {showSave ? (
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={
              saving ||
              (!binaryDraft && (state.status !== "ready" || draft === state.data.content))
            }
            className="px-4 py-2 rounded-md bg-[hsla(var(--pv-id-hue,220),80%,60%,0.2)] hover:bg-[hsla(var(--pv-id-hue,220),80%,60%,0.3)] text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed text-sm cursor-pointer"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        ) : null}
      </div>
    ) : null;

  const View = mode.View;
  // The notice keeps the toolbar so host controls (e.g. delete) still work.
  const notice = (
    <div className="flex flex-col h-full gap-2">
      {toolbar}
      <FileUnavailableNotice downloadUrl={downloadUrl} filename={filename} />
    </div>
  );

  if (mode.needs === "none") return notice;

  // URL-sourced modes render straight from the host's URL — no fetch needed.
  if (mode.needs === "url" && mediaUrl) {
    return (
      <div className="flex flex-col h-full gap-2">
        {toolbar}
        <div className="flex-1 min-h-0">
          <View
            key={filename}
            filename={filename}
            src={src}
            content=""
            onChange={setDraft}
            disabled={saving}
            onBinaryDraft={handleBinaryDraft}
          />
        </div>
        {saveError && <div className="text-sm text-red-400 px-1">{saveError}</div>}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load file: {state.error}
      </div>
    );
  }

  if (mode.needs === "content" && state.data.isText === false) return notice;
  if (mode.needs === "url" && !src) return notice;

  return (
    <div className="flex flex-col h-full gap-2">
      {toolbar}
      <div className="flex-1 min-h-0">
        <View
          key={filename}
          filename={filename}
          src={src}
          content={mode.needs === "content" ? draft : ""}
          onChange={setDraft}
          disabled={saving}
          onBinaryDraft={handleBinaryDraft}
        />
      </div>
      {saveError && <div className="text-sm text-red-400 px-1">{saveError}</div>}
    </div>
  );
}
