/**
 * Phase 118 Plan 118-03 — WorkspaceTab.tsx
 *
 * The entire in-modal workspace file browser: file list + file viewer.
 *
 * Architecture:
 *   WorkspaceTab (default export)
 *     ├─ WorkspaceListView  — list body (breadcrumb + toolbar + sortable
 *     │                       columns + drag-drop + host chip + row overflow)
 *     └─ WorkspaceFileViewer — editor-size <Modal> stacked over the host
 *                              modal (supersedes the old inline D-10 swap, so
 *                              files get the same room as the chat viewer)
 *
 * D-05 / D-06 (snapshot + no polling): a single useEffect + refreshKey counter.
 * No polling, no live subscriptions, no agent-facing side effects in this file.
 *
 * D-23 / D-24 (consumer-user register): every user-visible string is plain
 * English, no developer jargon (no "SSH", "SFTP", "endpoint", "regex",
 * "octal", "chmod", "curl").
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Download,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import {
  RowKebabMenu,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
} from "@/features/pretty-conversations/RowKebabMenu";
import {
  createWorkspaceFile,
  deleteWorkspaceEntry,
  downloadWorkspaceFileUrl,
  listWorkspace,
  mkdirWorkspace,
  readWorkspaceFile,
  renameWorkspaceEntry,
  searchWorkspace,
  uploadWorkspaceFile,
  writeWorkspaceFile,
} from "@/api/workspace-api";
import type {
  ListResponse,
  SearchResponse,
  WorkspaceEntry,
  WorkspaceTarget,
} from "@/api/workspace-api";

/**
 * Stable per-target string for React dep arrays. Two targets that resolve to
 * the same folder produce the same string; anything else (including a fresh
 * object reference to the same target) produces the same string too, so the
 * effect/callback deps are keyed on the underlying key rather than the object
 * identity.
 */
function targetDepKey(t: WorkspaceTarget): string {
  if (t.kind === "identity") return `identity:${t.identityKey}`;
  if (t.kind === "project") return `project:${t.projectSlug}`;
  return `role:${t.roleSlug}`;
}
import { resolveWorkspaceErrorCopy } from "./workspace-error-copy";
import type { TabState } from "./IdentityFileTab";
import {
  FileUnavailableNotice,
  FileView,
  FileViewModeSwitcher,
  type FileViewData,
} from "./file-viewers/FileView";
import { Modal, ModalBody, ModalHead } from "@/components/modal";
import {
  fileViewIsEditable,
  fileViewNeverNeedsContent,
  isTextByName,
  type BinaryDraft,
} from "./file-viewers/registry";
import { base64ToBytes, decodeUtf8, looksLikeText } from "./file-viewers/text-sniff";
import { FileSpeakButton } from "./file-viewers/FileSpeakButton";

// ---------------------------------------------------------------------------
// Sorting — folders always above files (D-15)
// ---------------------------------------------------------------------------

function sortEntries(
  entries: WorkspaceEntry[],
  sortKey: "name" | "size" | "mtime",
  sortDir: "asc" | "desc"
): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    // Folders before files — always (D-15)
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    let va: string | number;
    let vb: string | number;
    if (sortKey === "name") {
      va = a.name.toLowerCase();
      vb = b.name.toLowerCase();
    } else if (sortKey === "size") {
      va = a.size ?? 0;
      vb = b.size ?? 0;
    } else {
      va = a.mtimeMs;
      vb = b.mtimeMs;
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
}

/** Folder depth of a search result below the folder searched from. */
function depthBelow(entry: WorkspaceEntry, startPath: string[]): number {
  return entry.path.split("/").length - startPath.length;
}

/**
 * Default order for search results: nearest first (fewer folders deep), then
 * alphabetical. A column-header click switches to the normal sort.
 */
function sortNearestFirst(entries: WorkspaceEntry[], startPath: string[]): WorkspaceEntry[] {
  return [...entries].sort(
    (a, b) =>
      depthBelow(a, startPath) - depthBelow(b, startPath) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

/** The folder a search result sits in, relative to the folder searched from. */
function resultLocation(entry: WorkspaceEntry, startPath: string[]): string {
  const parent = entry.path.split("/").slice(startPath.length, -1);
  return parent.length === 0 ? "in this folder" : `in ${parent.join("/")}`;
}

/** Pause after the last keystroke before a search is sent. */
const SEARCH_DEBOUNCE_MS = 350;

/** Longest search the server accepts — the box stops typing here, so it never errors. */
const SEARCH_MAX_QUERY_CHARS = 200;

// ---------------------------------------------------------------------------
// Display formatters (consumer-user friendly — no octal, no shell format)
// ---------------------------------------------------------------------------

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
    units.length - 1
  );
  const val = bytes / Math.pow(1024, i);
  return i === 0 ? `${bytes} B` : `${val.toFixed(1)} ${units[i]}`;
}

function formatMtime(mtimeMs: number): string {
  if (!mtimeMs) return "—";
  const now = Date.now();
  const diff = Math.max(0, now - mtimeMs);
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  // Fall back to date string for older files
  return new Date(mtimeMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(mtimeMs).getFullYear() !== new Date().getFullYear()
        ? "numeric"
        : undefined,
  });
}

// ---------------------------------------------------------------------------
// Inline error banner (shared by list-mode and viewer-mode)
// ---------------------------------------------------------------------------

function ErrorBanner({
  heading,
  body,
}: {
  heading: string;
  body: string;
}): JSX.Element {
  return (
    <div
      style={{
        background: "hsla(6, 80%, 53%, 0.12)",
        border: "1px solid hsla(6, 80%, 53%, 0.28)",
        borderRadius: 8,
        padding: "10px 14px",
        margin: "8px 0",
        color: "var(--color-pv-fg)",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
        {heading}
      </div>
      <div style={{ fontSize: 12, color: "var(--color-pv-fg-muted)" }}>
        {body}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceFileViewer — full-size file modal stacked over the host modal
// (identity / role). Closing it lands back on the list, folder intact.
// ---------------------------------------------------------------------------

interface OpenFileState {
  name: string;
  relativePath: string;
  /** From the listing; null when unknown. Drives the too-large skip. */
  size: number | null;
}

/** Mirrors the backend read cap (MAX_READ_BYTES in workspace-routes.ts). */
const PREVIEW_MAX_BYTES = 2_000_000;

/** Monotonic version token for FileView's draft reseed (fetch + save). */
let workspaceFileVersion = 0;

function WorkspaceFileViewer({
  file,
  onClose,
  target,
  hostId,
  hue,
}: {
  file: OpenFileState;
  onClose: () => void;
  target: WorkspaceTarget;
  hostId: number;
  hue: number;
}): JSX.Element {
  // The shared file-viewer registry picks the body (D-12 dispatch now lives
  // in file-viewers/registry). Media streams from the inline download URL
  // (any size, Range-capable) and known-binary types show the notice, so
  // neither fetches. Text over the read cap gets the too-large notice.
  const neverNeedsContent = fileViewNeverNeedsContent(file.name);
  const isTooLarge =
    !neverNeedsContent && file.size !== null && file.size > PREVIEW_MAX_BYTES;
  const skipFetch = neverNeedsContent || isTooLarge;

  const [fileState, setFileState] = useState<TabState<FileViewData>>({
    status: "loading",
  });
  // Raw error class for the ErrorBanner copy lookup (fileState.error holds
  // the same string, kept separate for readability at the render site).
  const [errorClass, setErrorClass] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<string | null>(null);
  // Unsaved-edit tracking so back-nav can confirm before discarding.
  // FileView feeds both: the dirty flag and the draft for the header Save.
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (skipFetch) return;
    let cancelled = false;
    setFileState({ status: "loading" });
    setErrorClass(null);
    setSaveError(null);
    readWorkspaceFile(target, hostId, file.relativePath)
      .then((data) => {
        if (cancelled) return;
        const bytes = base64ToBytes(data.contentBase64);
        const isText = isTextByName(file.name) || looksLikeText(bytes);
        setDirty(false);
        setFileState({
          status: "ready",
          data: {
            content: isText ? decodeUtf8(bytes) : "",
            mtime: ++workspaceFileVersion,
            isText,
            bytes,
          },
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const cls = err instanceof Error ? err.message : "host_unreachable";
        setErrorClass(cls);
        setFileState({ status: "error", error: cls });
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDepKey(target), hostId, file.relativePath, skipFetch]);

  // Save handler (last-write-wins V1 — the workspace write has no mtime check)
  const handleSave = useCallback(
    async (newContent: string) => {
      setSaveError(null);
      setSaving(true);
      try {
        await writeWorkspaceFile(
          target,
          hostId,
          file.relativePath,
          newContent
        );
        // Success: the saved text is the new baseline, so the draft is clean
        // and back-nav doesn't prompt. Bytes are dropped — url modes (e.g.
        // rendered SVG) rebuild their src from the saved text.
        setFileState({
          status: "ready",
          data: { content: newContent, mtime: ++workspaceFileVersion, isText: true },
        });
        setDirty(false);
      } catch (err) {
        const cls = err instanceof Error ? err.message : "generic";
        const copy = resolveWorkspaceErrorCopy(cls);
        setSaveError(copy.heading + ": " + copy.body);
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetDepKey(target), hostId, file.relativePath]
  );

  // Binary edits (PDF annotations): written back through the upload route,
  // which replaces the file atomically. Last-write-wins like text saves.
  const [binaryDraft, setBinaryDraft] = useState<BinaryDraft | null>(null);
  const handleSaveBytes = useCallback(
    async (draftToSave: BinaryDraft) => {
      setSaveError(null);
      setSaving(true);
      try {
        const bytes = await draftToSave.getBytes();
        await uploadWorkspaceFile(
          target,
          hostId,
          file.relativePath,
          // globalThis: `File` in this module is the lucide icon.
          new globalThis.File([bytes as BlobPart], file.name, { type: "application/octet-stream" })
        );
        draftToSave.markSaved(bytes);
      } catch (err) {
        const cls = err instanceof Error ? err.message : "generic";
        const copy = resolveWorkspaceErrorCopy(cls);
        setSaveError(copy.heading + ": " + copy.body);
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetDepKey(target), hostId, file.relativePath, file.name]
  );

  // Close guard: confirm before discarding unsaved edits.
  const guardedClose = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }, [dirty, onClose]);

  const canSave =
    (!skipFetch &&
      fileState.status === "ready" &&
      (fileViewIsEditable(file.name, viewMode, fileState.data.isText) || dirty)) ||
    // Modes that edit in place from the URL (PDF) never fetch content.
    (neverNeedsContent && fileViewIsEditable(file.name, viewMode, undefined));

  const downloadUrl = downloadWorkspaceFileUrl(
    target,
    hostId,
    file.relativePath
  );
  const mediaUrl = downloadWorkspaceFileUrl(target, hostId, file.relativePath, {
    inline: true,
  });

  const headActions = (
    <>
      {!skipFetch &&
        !isTooLarge &&
        fileState.status === "ready" &&
        fileState.data.isText !== false && (
          <FileSpeakButton filename={file.name} text={draft} />
        )}
      <FileViewModeSwitcher
        filename={file.name}
        mode={viewMode}
        onModeChange={setViewMode}
      />
      <a
        href={downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "1px solid var(--color-pv-border-quiet)",
          color: "var(--color-pv-fg-muted)",
          cursor: "pointer",
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 6,
          textDecoration: "none",
        }}
      >
        <Download size={13} />
        Download
      </a>
      {canSave && (
        <button
          type="button"
          onClick={() => {
            void (binaryDraft ? handleSaveBytes(binaryDraft) : handleSave(draft));
          }}
          disabled={saving || !dirty}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.2)",
            border: "1px solid hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
            color: "var(--color-pv-fg)",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 12px",
            borderRadius: 6,
            fontWeight: 600,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      )}
    </>
  );

  let body: ReactNode;
  if (fileState.status === "error") {
    const copy = resolveWorkspaceErrorCopy(errorClass ?? fileState.error);
    body = (
      <div style={{ padding: 16 }}>
        <ErrorBanner heading={copy.heading} body={copy.body} />
      </div>
    );
  } else if (isTooLarge) {
    body = (
      <FileUnavailableNotice
        heading="Too large to preview"
        body="Files over 2 MB can't be shown here."
        downloadUrl={downloadUrl}
        filename={file.name}
      />
    );
  } else {
    body = (
      <FileView
        filename={file.name}
        state={fileState}
        mediaUrl={mediaUrl}
        downloadUrl={downloadUrl}
        onSave={(content) => handleSave(content)}
        hideSaveButton
        onDraftChange={setDirty}
        onDraftContentChange={setDraft}
        mode={viewMode ?? undefined}
        onModeChange={setViewMode}
        hideModeSwitcher
        hideSpeakButton
        onBinaryDraftChange={setBinaryDraft}
      />
    );
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) guardedClose();
      }}
      hue={hue}
      size="editor"
      data-testid="workspace-file-modal"
    >
      <ModalHead title={file.name} actions={headActions} />
      <ModalBody className="p-0 flex flex-col px-6 py-4">
        {body}
        {saveError && (
          <div
            style={{
              padding: "4px 8px",
              fontSize: 12,
              color: "hsla(6, 80%, 55%, 0.9)",
              flexShrink: 0,
            }}
          >
            {saveError}
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ListState — mirrors TabState<T> from IdentityFileTab (D-05 fetch machine)
// ---------------------------------------------------------------------------

type ListState =
  | { status: "loading" }
  | { status: "ready"; data: ListResponse }
  | { status: "error"; errorClass: string };

/**
 * A file/folder row that opens its menu on right-click — the same items as
 * its ⋮, like rows everywhere else in the app. Phone long-press stays native.
 */
function RowMenuSurface({
  items,
  children,
  ...rest
}: {
  items: RowKebabMenuItem[];
  children: ReactNode;
  "data-testid"?: string;
  "data-path"?: string;
  "data-flash"?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ctx = useRowKebabContextMenu(items);
  return (
    <div {...rest} onContextMenu={ctx.onContextMenu}>
      {children}
      {ctx.menu}
    </div>
  );
}

/** How long "Show in folder" rings the item it landed on. */
const FLASH_MS = 2000;

// ---------------------------------------------------------------------------
// WorkspaceListView — list-mode body
// Toolbar + breadcrumb + sortable columns + drag-drop + host chip + row menu
// ---------------------------------------------------------------------------

interface WorkspaceListViewProps {
  currentPath: string[];
  onNavigate: (newPath: string[]) => void;
  onOpenFile: (file: OpenFileState) => void;
  target: WorkspaceTarget;
  hostId: number;
  hue: number;
  refreshKey: number;
  onRefresh: () => void;
  /** Names to hide from the listing (e.g. the role's own <slug>.md file). */
  hiddenNames?: readonly string[];
  /** Custom intro copy above the file list. Falls back to the identity default. */
  introCopy?: string;
}

function WorkspaceListView({
  currentPath,
  onNavigate,
  onOpenFile,
  target,
  hostId,
  hue,
  refreshKey,
  onRefresh,
  hiddenNames,
  introCopy,
}: WorkspaceListViewProps): JSX.Element {
  const [listState, setListState] = useState<ListState>({
    status: "loading",
  });
  const [sortKey, setSortKey] = useState<"name" | "size" | "mtime">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingNew, setPendingNew] = useState<"folder" | "file" | null>(null);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [renamingFor, setRenamingFor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Search: the box's text, the last results shown, whether a newer search
  // is in flight, and its error. Results stay on screen (dimmed) while a
  // newer search runs, so the list never blanks between keystrokes.
  const [query, setQuery] = useState("");
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Column sort for results; null = nearest first. */
  const [searchSort, setSearchSort] = useState<{
    key: "name" | "size" | "mtime";
    dir: "asc" | "desc";
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Item "Show in folder" landed on — ringed briefly once its folder loads. */
  const [flashPath, setFlashPath] = useState<string | null>(null);
  const listBodyRef = useRef<HTMLDivElement>(null);
  const trimmedQuery = query.trim();
  const searchActive = trimmedQuery.length > 0;
  /** Results replace the folder listing once the first search answers. */
  const showingResults = searchActive && searchData !== null;

  // D-05: fetch on mount + whenever path, target, hostId, or refreshKey changes
  useEffect(() => {
    let cancelled = false;
    setListState({ status: "loading" });
    listWorkspace(target, hostId, currentPath.join("/"))
      .then((data) => {
        if (!cancelled) setListState({ status: "ready", data });
      })
      .catch((err) => {
        if (!cancelled) {
          const errorClass =
            err instanceof Error ? err.message : "host_unreachable";
          setListState({ status: "error", errorClass });
        }
      });
    return () => {
      cancelled = true;
    };
    // refreshKey in deps means the refresh button re-runs the effect (D-05)
  }, [targetDepKey(target), hostId, currentPath, refreshKey]);

  // Search: debounced, latest-wins. Each run aborts the one before it (the
  // server then stops that search on the host), so a slow older answer can
  // never land over a newer one. refreshKey re-runs it after a rename,
  // delete or file close.
  useEffect(() => {
    if (!searchActive) {
      setSearchData(null);
      setSearching(false);
      setSearchError(null);
      setSearchSort(null);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchWorkspace(target, hostId, currentPath.join("/"), trimmedQuery, ctrl.signal)
        .then((data) => {
          if (ctrl.signal.aborted) return;
          setSearchData(data);
          setSearchError(null);
          setSearching(false);
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          setSearchError(err instanceof Error ? err.message : "search_failed");
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmedQuery, searchActive, targetDepKey(target), hostId, currentPath, refreshKey]);

  /** Empty the search box; the effect above drops the results. */
  function clearSearch() {
    setQuery("");
  }

  /** Go to a folder. Leaving the folder searched from ends the search. */
  function navigateTo(path: string[]) {
    clearSearch();
    onNavigate(path);
  }

  /** Path of an entry relative to the target root (results carry their own). */
  function pathOf(entry: WorkspaceEntry): string {
    if (showingResults) return entry.path;
    return currentPath.length > 0 ? currentPath.join("/") + "/" + entry.name : entry.name;
  }

  // "Show in folder": once the folder's listing is on screen, scroll the item
  // into view, then drop the ring after a moment.
  useEffect(() => {
    if (!flashPath || listState.status !== "ready" || showingResults) return;
    const row = Array.from(
      listBodyRef.current?.querySelectorAll<HTMLElement>("[data-path]") ?? [],
    ).find((el) => el.dataset.path === flashPath);
    row?.scrollIntoView?.({ block: "nearest" });
    const timer = setTimeout(() => setFlashPath(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashPath, listState, showingResults]);

  /** Go to the folder a search result lives in and point it out there. */
  function showInFolder(entry: WorkspaceEntry) {
    const segments = entry.path.split("/");
    setFlashPath(entry.path);
    navigateTo(segments.slice(0, -1));
  }

  /** The row menu — shared by the ⋮ button and right-click. */
  function rowMenuItems(entry: WorkspaceEntry): RowKebabMenuItem[] {
    const entryPath = pathOf(entry);
    const items: RowKebabMenuItem[] = [];
    if (showingResults) {
      items.push({
        label: "Show in folder",
        onClick: () => showInFolder(entry),
        testId: "workspace-row-show-in-folder",
      });
    }
    items.push({
      label: "Rename",
      onClick: () => {
        setRenamingFor(entryPath);
        setRenameValue(entry.name);
        setRenameError(null);
      },
      testId: "workspace-row-rename",
    });
    if (entry.type !== "directory") {
      items.push({
        label: "Download",
        onClick: () => {
          window.open(downloadWorkspaceFileUrl(target, hostId, entryPath), "_blank", "noopener,noreferrer");
        },
        testId: "workspace-row-download",
      });
    }
    items.push({
      label: "Delete",
      danger: true,
      separatorBefore: true,
      onClick: () => void handleDelete(entry),
      testId: "workspace-row-delete",
    });
    return items;
  }

  // Sort column toggling (D-14)
  function handleSortClick(col: "name" | "size" | "mtime") {
    if (showingResults) {
      setSearchSort((cur) =>
        cur && cur.key === col
          ? { key: col, dir: cur.dir === "asc" ? "desc" : "asc" }
          : { key: col, dir: "asc" },
      );
      return;
    }
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
  }

  // Drag-drop handlers (D-16, dragCounter pattern).
  // All four call stopPropagation so PrettyView's outer composer drop-target
  // does not also fire — otherwise the file lands as a composer attachment
  // alongside our workspace upload.
  function onDragEnter(e: React.DragEvent) {
    if (
      !e.dataTransfer ||
      !Array.from(e.dataTransfer.types).includes("Files")
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragActive(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (
      !e.dataTransfer ||
      !Array.from(e.dataTransfer.types).includes("Files")
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    const prefix = currentPath.length > 0 ? currentPath.join("/") + "/" : "";
    setUploadError(null);
    try {
      await Promise.all(
        files.map((f) =>
          uploadWorkspaceFile(
            target,
            hostId,
            prefix + f.name,
            f
          )
        )
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.message : "generic";
      const copy = resolveWorkspaceErrorCopy(errorClass);
      setUploadError(copy.heading + ": " + copy.body);
    }
    clearSearch();
    onRefresh();
  }

  // Upload via file picker (D-16)
  async function handleFilePickerChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const prefix = currentPath.length > 0 ? currentPath.join("/") + "/" : "";
    setUploadError(null);
    try {
      await Promise.all(
        files.map((f) =>
          uploadWorkspaceFile(
            target,
            hostId,
            prefix + f.name,
            f
          )
        )
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.message : "generic";
      const copy = resolveWorkspaceErrorCopy(errorClass);
      setUploadError(copy.heading + ": " + copy.body);
    }
    // Reset the input so the same file can be uploaded again
    if (fileInputRef.current) fileInputRef.current.value = "";
    clearSearch();
    onRefresh();
  }

  // Create new folder / file (D-17)
  async function handleNewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const targetPath =
      currentPath.length > 0
        ? currentPath.join("/") + "/" + newName.trim()
        : newName.trim();
    setNewError(null);
    try {
      if (pendingNew === "folder") {
        await mkdirWorkspace(target, hostId, targetPath);
      } else {
        await createWorkspaceFile(target, hostId, targetPath);
      }
      setPendingNew(null);
      setNewName("");
      clearSearch();
      onRefresh();
    } catch (err) {
      const errorClass = err instanceof Error ? err.message : "generic";
      const copy = resolveWorkspaceErrorCopy(errorClass);
      setNewError(copy.heading + ": " + copy.body);
    }
  }

  // Delete (D-07 — single generic confirm)
  async function handleDelete(entry: WorkspaceEntry) {
    if (!window.confirm(`Delete "${entry.name}"?`)) return;
    const targetPath = pathOf(entry);
    try {
      await deleteWorkspaceEntry(target, hostId, targetPath);
      onRefresh();
    } catch (err) {
      const errorClass = err instanceof Error ? err.message : "generic";
      const copy = resolveWorkspaceErrorCopy(errorClass);
      alert(copy.heading + "\n\n" + copy.body);
    }
  }

  // Rename
  async function handleRenameSubmit(e: React.FormEvent, entry: WorkspaceEntry) {
    e.preventDefault();
    if (!renameValue.trim() || renameValue.trim() === entry.name) {
      setRenamingFor(null);
      return;
    }
    // Renaming keeps the item in its own folder (a result's may be deeper).
    const fromPath = pathOf(entry);
    const parent = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1) : "";
    const toPath = parent + renameValue.trim();
    setRenameError(null);
    try {
      await renameWorkspaceEntry(target, hostId, fromPath, toPath);
      setRenamingFor(null);
      setRenameValue("");
      onRefresh();
    } catch (err) {
      const errorClass = err instanceof Error ? err.message : "generic";
      const copy = resolveWorkspaceErrorCopy(errorClass);
      setRenameError(copy.heading + ": " + copy.body);
    }
  }

  // Click on a row (D-09, D-13)
  function handleRowClick(entry: WorkspaceEntry) {
    if (entry.type === "directory") {
      navigateTo(pathOf(entry).split("/"));
    } else {
      onOpenFile({ name: entry.name, relativePath: pathOf(entry), size: entry.size });
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const toolbarBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 500,
    color: "var(--color-pv-fg-muted)",
    background: "var(--color-pv-surface-quiet-alt)",
    border: "1px solid var(--color-pv-border-quiet)",
    borderRadius: 6,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const colHeaderStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "28px 1fr 80px 100px 32px",
    alignItems: "center",
    padding: "4px 10px",
    borderBottom: "1px solid var(--color-pv-border-quiet)",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-pv-fg-dim)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    flexShrink: 0,
  };

  const activeSort = showingResults ? searchSort : { key: sortKey, dir: sortDir };
  const sortableStyle = (col: "name" | "size" | "mtime"): React.CSSProperties => ({
    cursor: "pointer",
    userSelect: "none",
    color:
      activeSort?.key === col
        ? "hsla(var(--pv-id-hue, 220), 70%, 75%, 1)"
        : "var(--color-pv-fg-dim)",
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
  });

  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "28px 1fr 80px 100px 32px",
    alignItems: "center",
    padding: "5px 10px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    color: "var(--color-pv-fg)",
  };

  const arrowChar = (col: "name" | "size" | "mtime"): string => {
    if (!activeSort || activeSort.key !== col) return "";
    return activeSort.dir === "asc" ? " ▲" : " ▼";
  };

  // Sorted entries for rendering. `hiddenNames` filter applies ONLY at the
  // repo root (currentPath.length === 0) — nested folders never see it. This
  // matches the intent: a role-file entry lives at `<slug>.md` in the root of
  // the role folder, and we hide only that name; user files nested under the
  // same name in a subfolder are unaffected.
  //
  // Search results: same hidden names, matched against the result's path from
  // the target root so only the root-level file is hidden. Nearest first until
  // a column header is clicked.
  const visibleResults = showingResults && searchData
    ? searchData.results.filter((e) => !(hiddenNames?.includes(e.path) ?? false))
    : [];
  const sortedEntries = showingResults
    ? searchSort
      ? sortEntries(visibleResults, searchSort.key, searchSort.dir)
      : sortNearestFirst(visibleResults, currentPath)
    : listState.status === "ready"
      ? sortEntries(
          currentPath.length === 0 && hiddenNames && hiddenNames.length > 0
            ? listState.data.entries.filter((e) => !hiddenNames.includes(e.name))
            : listState.data.entries,
          sortKey,
          sortDir,
        )
      : [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--color-pv-surface-quiet)",
      }}
    >
      {/* Toolbar: breadcrumb + action buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px 6px",
          flexShrink: 0,
          flexWrap: "wrap",
          borderBottom: "1px solid var(--color-pv-border-quiet)",
        }}
      >
        {/* Breadcrumb (D-13) */}
        {/* Sized to its one-line width: when the path doesn't fit beside the
            buttons, the buttons wrap below and the path gets the whole line
            (wrapping within it if it must) instead of squeezing into a narrow
            column beside them — on a phone or in a narrow modal alike. */}
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flex: "1 1 max-content",
            minWidth: 0,
            flexWrap: "wrap",
          }}
          aria-label="Folder path"
        >
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color:
                currentPath.length === 0
                  ? "var(--color-pv-fg)"
                  : "hsla(var(--pv-id-hue, 220), 70%, 75%, 1)",
              cursor: currentPath.length > 0 ? "pointer" : "default",
              fontSize: 13,
              fontWeight: 600,
              padding: "2px 4px",
            }}
            onClick={() => {
              if (currentPath.length > 0) navigateTo([]);
            }}
          >
            Workspace
          </button>
          {currentPath.map((seg, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center" }}>
              <ChevronRight
                size={13}
                style={{ color: "var(--color-pv-fg-dim)", margin: "0 1px" }}
              />
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  color:
                    i === currentPath.length - 1
                      ? "var(--color-pv-fg)"
                      : "hsla(var(--pv-id-hue, 220), 70%, 75%, 1)",
                  cursor:
                    i === currentPath.length - 1 ? "default" : "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "2px 4px",
                }}
                onClick={() => {
                  if (i < currentPath.length - 1) {
                    navigateTo(currentPath.slice(0, i + 1));
                  }
                }}
              >
                {seg}
              </button>
            </span>
          ))}
        </nav>

        {/* Hidden file input for upload */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            void handleFilePickerChange(e);
          }}
        />

        {/* Upload button (D-16) */}
        <button
          type="button"
          style={toolbarBtnStyle}
          onClick={() => fileInputRef.current?.click()}
          title="Upload files to this folder"
        >
          <Upload size={13} />
          Upload
        </button>

        {/* New folder (D-17) */}
        <button
          type="button"
          style={toolbarBtnStyle}
          onClick={() => {
            setPendingNew("folder");
            setNewName("");
            setNewError(null);
          }}
          title="Create a new folder here"
        >
          <FolderPlus size={13} />
          New folder
        </button>

        {/* New file (D-17) */}
        <button
          type="button"
          style={{
            ...toolbarBtnStyle,
            background:
              "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.14)",
            borderColor:
              "hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
            color: "var(--color-pv-fg)",
          }}
          onClick={() => {
            setPendingNew("file");
            setNewName("");
            setNewError(null);
          }}
          title="Create a new file here"
        >
          <FilePlus size={13} />
          New file
        </button>

        {/* Refresh (D-05) */}
        <button
          type="button"
          style={{
            ...toolbarBtnStyle,
            padding: "5px 8px",
          }}
          onClick={onRefresh}
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Search box — its own full-width row so it fits on a phone. Searches
          this folder and every folder below it, by name, as you type. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px 0",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            background: "var(--color-pv-surface-quiet-alt)",
            border: "1px solid var(--color-pv-border-quiet)",
            borderRadius: 6,
          }}
          onClick={() => searchInputRef.current?.focus()}
        >
          <Search size={13} style={{ color: "var(--color-pv-fg-dim)", flexShrink: 0 }} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc clears the search; the modal stays open while there is
              // something to clear (data-modal-esc-local).
              if (e.key === "Escape") {
                clearSearch();
                searchInputRef.current?.blur();
              }
            }}
            maxLength={SEARCH_MAX_QUERY_CHARS}
            data-modal-esc-local={query.length > 0 ? "" : undefined}
            placeholder="Search this folder and its subfolders"
            aria-label="Search files and folders"
            data-testid="workspace-search-input"
            style={{
              flex: 1,
              minWidth: 0,
              background: "none",
              border: "none",
              outline: "none",
              fontSize: 13,
              color: "var(--color-pv-fg)",
            }}
          />
        </div>
        {searchActive && searching && (
          <span
            style={{ fontSize: 12, color: "var(--color-pv-fg-muted)", whiteSpace: "nowrap" }}
            data-testid="workspace-search-searching"
          >
            Searching…
          </span>
        )}
      </div>

      {/* First-encounter intro — what this tab is / what it shows. */}
      <div
        style={{
          padding: "6px 10px 8px",
          fontSize: 12,
          color: "var(--color-pv-fg-muted)",
          flexShrink: 0,
        }}
      >
        {introCopy ??
          "This agent's file workspace. Anything you drop in, they can read; anything they save, you can grab from here."}
      </div>

      {/* Upload error banner */}
      {uploadError && (
        <div style={{ padding: "0 10px" }}>
          <ErrorBanner
            heading="Upload failed"
            body={uploadError}
          />
        </div>
      )}

      {/* Column headers */}
      <div style={colHeaderStyle}>
        <span />
        <span>
          <span
            style={sortableStyle("name")}
            onClick={() => handleSortClick("name")}
          >
            Name{arrowChar("name")}
          </span>
        </span>
        <span
          style={{
            ...sortableStyle("size"),
            justifyContent: "flex-end",
          }}
          onClick={() => handleSortClick("size")}
        >
          Size{arrowChar("size")}
        </span>
        <span
          style={{
            ...sortableStyle("mtime"),
            paddingLeft: 12,
          }}
          onClick={() => handleSortClick("mtime")}
        >
          Modified{arrowChar("mtime")}
        </span>
        <span />
      </div>

      {/* File list body with drag-drop (D-16) */}
      <div
        ref={listBodyRef}
        style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={(e) => {
          void onDrop(e);
        }}
      >
        {/* Inline "new" input row (D-17) */}
        {pendingNew && (
          <form
            onSubmit={(e) => {
              void handleNewSubmit(e);
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr auto auto",
              alignItems: "center",
              padding: "4px 10px",
              gap: 6,
              background:
                "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.06)",
              borderBottom: "1px solid var(--color-pv-border-quiet)",
            }}
          >
            <span style={{ display: "flex", justifyContent: "center" }}>
              {pendingNew === "folder" ? (
                <Folder
                  size={16}
                  style={{
                    color: "hsla(var(--pv-id-hue, 220), 70%, 75%, 0.8)",
                  }}
                />
              ) : (
                <File
                  size={16}
                  style={{ color: "var(--color-pv-fg-muted)" }}
                />
              )}
            </span>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={
                pendingNew === "folder" ? "New folder name" : "New file name"
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setPendingNew(null);
                  setNewError(null);
                }
              }}
              style={{
                background: "var(--color-pv-surface-quiet-alt)",
                border: "1px solid var(--color-pv-border-quiet-strong)",
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 13,
                color: "var(--color-pv-fg)",
                outline: "none",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 6,
                background:
                  "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.2)",
                border:
                  "1px solid hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
                color: "var(--color-pv-fg)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingNew(null);
                setNewError(null);
              }}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 6,
                background: "none",
                border: "1px solid var(--color-pv-border-quiet)",
                color: "var(--color-pv-fg-muted)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </form>
        )}
        {newError && (
          <div style={{ padding: "0 10px" }}>
            <ErrorBanner heading="Could not create" body={newError} />
          </div>
        )}

        {/* Rename error banner */}
        {renameError && (
          <div style={{ padding: "0 10px" }}>
            <ErrorBanner heading="Could not rename" body={renameError} />
          </div>
        )}

        {/* Search failed — shown in place of results */}
        {searchActive && searchError && (
          <div style={{ padding: "8px 10px" }}>
            <ErrorBanner
              heading={resolveWorkspaceErrorCopy(searchError).heading}
              body={resolveWorkspaceErrorCopy(searchError).body}
            />
          </div>
        )}

        {/* A limit cut the search short — say which, never hide it silently */}
        {showingResults && !searchError && searchData && (searchData.truncated || searchData.timedOut) && (
          <div
            style={{
              margin: "6px 10px",
              padding: "6px 10px",
              fontSize: 12,
              color: "var(--color-pv-fg-muted)",
              background: "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.06)",
              border: "1px solid var(--color-pv-border-quiet)",
              borderRadius: 6,
            }}
            data-testid="workspace-search-limit-notice"
          >
            {searchData.timedOut
              ? "Search stopped after 5 seconds — there may be more matches."
              : "Showing the first 200 matches — type more to narrow it."}
          </div>
        )}

        {/* No matches */}
        {showingResults && !searchError && sortedEntries.length === 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: 32,
              gap: 8,
              color: "var(--color-pv-fg-muted)",
            }}
            data-testid="workspace-search-no-matches"
          >
            <Search size={28} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: 13 }}>No matches</div>
            <div style={{ fontSize: 11, color: "var(--color-pv-fg-dim)" }}>
              Nothing here or in the folders below has a name like that.
            </div>
          </div>
        )}

        {/* Loading state */}
        {!showingResults && listState.status === "loading" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
              color: "var(--color-pv-fg-muted)",
              fontSize: 13,
            }}
          >
            Loading…
          </div>
        )}

        {/* Error state */}
        {!showingResults && listState.status === "error" && (
          <div style={{ padding: "8px 10px" }}>
            <ErrorBanner
              heading={resolveWorkspaceErrorCopy(listState.errorClass).heading}
              body={resolveWorkspaceErrorCopy(listState.errorClass).body}
            />
          </div>
        )}

        {/* Empty folder */}
        {!searchActive &&
          listState.status === "ready" &&
          sortedEntries.length === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 32,
                gap: 8,
                color: "var(--color-pv-fg-muted)",
              }}
            >
              <Folder size={32} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 13 }}>Empty folder</div>
              <div style={{ fontSize: 11, color: "var(--color-pv-fg-dim)" }}>
                Drop files here or use the toolbar.
              </div>
            </div>
          )}

        {/* File/folder rows (D-08 — show everything) */}
        {/* While a search runs, whatever is on screen (the folder, or the
            previous results) stays put, dimmed, until the new answer lands. */}
        {(showingResults || listState.status === "ready") &&
          !(searchActive && searchError) &&
          sortedEntries.map((entry) => {
            // Keyed by path: results from different folders can share a name.
            const entryPath = pathOf(entry);
            const isRenaming = renamingFor === entryPath;
            const flashing = flashPath === entryPath;

            return (
              <RowMenuSurface
                key={entryPath}
                items={rowMenuItems(entry)}
                data-testid="workspace-row"
                data-path={entryPath}
                data-flash={flashing ? "" : undefined}
                style={{
                  ...rowStyle,
                  opacity: searchActive && searching ? 0.5 : undefined,
                  // "Show in folder" landed here — ring it for a moment.
                  boxShadow: flashing
                    ? "inset 0 0 0 2px hsla(var(--pv-id-hue, 220), 80%, 70%, 0.7)"
                    : undefined,
                  transition: "box-shadow 0.4s",
                  position: "relative",
                }}
                onClick={() => {
                  if (isRenaming) return;
                  handleRowClick(entry);
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.05)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "";
                }}
              >
                {/* Icon */}
                <span
                  style={{ display: "flex", justifyContent: "center", alignItems: "center" }}
                >
                  {entry.type === "directory" ? (
                    <Folder
                      size={16}
                      style={{
                        color: "hsla(var(--pv-id-hue, 220), 70%, 75%, 0.8)",
                      }}
                    />
                  ) : (
                    <File
                      size={16}
                      style={{ color: "var(--color-pv-fg-muted)" }}
                    />
                  )}
                </span>

                {/* Name — inline rename input */}
                {isRenaming ? (
                  <form
                    onSubmit={(e) => {
                      void handleRenameSubmit(e, entry);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "flex", gap: 4, alignItems: "center" }}
                  >
                    <input
                      autoFocus
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setRenamingFor(null);
                          setRenameError(null);
                        }
                      }}
                      style={{
                        background: "var(--color-pv-surface-quiet-alt)",
                        border:
                          "1px solid var(--color-pv-border-quiet-strong)",
                        borderRadius: 6,
                        padding: "2px 6px",
                        fontSize: 13,
                        color: "var(--color-pv-fg)",
                        outline: "none",
                        flex: 1,
                        minWidth: 0,
                      }}
                    />
                    <button
                      type="submit"
                      style={{
                        padding: "2px 8px",
                        fontSize: 11,
                        borderRadius: 5,
                        background:
                          "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.2)",
                        border:
                          "1px solid hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
                        color: "var(--color-pv-fg)",
                        cursor: "pointer",
                      }}
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingFor(null);
                        setRenameError(null);
                      }}
                      style={{
                        padding: "2px 8px",
                        fontSize: 11,
                        borderRadius: 5,
                        background: "none",
                        border: "1px solid var(--color-pv-border-quiet)",
                        color: "var(--color-pv-fg-muted)",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                        color: "var(--color-pv-fg)",
                      }}
                      title={entry.name}
                    >
                      {entry.name}
                    </span>
                    {showingResults && (
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 11,
                          color: "var(--color-pv-fg-dim)",
                        }}
                        title={resultLocation(entry, currentPath)}
                        data-testid="workspace-result-location"
                      >
                        {resultLocation(entry, currentPath)}
                      </span>
                    )}
                  </span>
                )}

                {/* Size */}
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--color-pv-fg-muted)",
                    textAlign: "right",
                  }}
                >
                  {entry.type !== "directory"
                    ? formatBytes(entry.size)
                    : "—"}
                </span>

                {/* Modified */}
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--color-pv-fg-muted)",
                    paddingLeft: 12,
                  }}
                >
                  {formatMtime(entry.mtimeMs)}
                </span>

                {/* Row menu — the app's standard ⋮ menu; right-click on the
                    row opens the same one (RowMenuSurface). */}
                <span style={{ display: "flex", justifyContent: "center" }}>
                  <RowKebabMenu
                    items={rowMenuItems(entry)}
                    ariaLabel={`Actions for ${entry.name}`}
                    testId="workspace-row-menu"
                  />
                </span>
              </RowMenuSurface>
            );
          })}

        {/* What the search never looks in — always said under results */}
        {showingResults && !searchError && (
          <div
            style={{ padding: "10px 10px 14px", fontSize: 11, color: "var(--color-pv-fg-dim)", textAlign: "center" }}
            data-testid="workspace-search-skipped-note"
          >
            Package and environment folders aren't searched.
          </div>
        )}

        {/* Drag-drop overlay (D-16, dragCounter pattern) */}
        {dragActive && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `2px dashed hsla(var(--pv-id-hue, 220), 80%, 70%, 0.6)`,
              borderRadius: 10,
              background: "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.07)",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                background: "var(--color-pv-surface-quiet)",
                border: `1px solid hsla(var(--pv-id-hue, 220), 80%, 70%, 0.4)`,
                borderRadius: 10,
                padding: "16px 28px",
                textAlign: "center",
                color: "var(--color-pv-fg)",
                fontSize: 14,
                fontWeight: 600,
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              }}
            >
              Drop to upload
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-pv-fg-muted)",
                  marginTop: 4,
                  fontWeight: 400,
                }}
              >
                workspace
                {currentPath.length > 0
                  ? "/" + currentPath.join("/") + "/"
                  : "/"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WorkspaceTabProps {
  target: WorkspaceTarget;
  hostId: number;
  hue: number;
  /**
   * Names hidden from the listing at the frontend layer (backend still returns
   * them; this is a UX affordance, not an access control). Used by RoleModal to
   * hide the role's own `<slug>.md` file, since editing it lives on the
   * dedicated Role File tab.
   */
  hiddenNames?: readonly string[];
  /** Optional intro copy shown above the file list. Identity default when absent. */
  introCopy?: string;
}

// ---------------------------------------------------------------------------
// WorkspaceTab — default export
// File list, plus the file modal stacked over it while a file is open.
// ---------------------------------------------------------------------------

export default function WorkspaceTab({
  target,
  hostId,
  hue,
  hiddenNames,
  introCopy,
}: WorkspaceTabProps): JSX.Element {
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [openFile, setOpenFile] = useState<OpenFileState | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // The list stays mounted under the file modal so closing it returns to
  // the same folder and scroll position. Refresh on close picks up saves.
  return (
    <>
      <WorkspaceListView
        currentPath={currentPath}
        onNavigate={setCurrentPath}
        onOpenFile={setOpenFile}
        target={target}
        hostId={hostId}
        hue={hue}
        refreshKey={refreshKey}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        hiddenNames={hiddenNames}
        introCopy={introCopy}
      />
      {openFile && (
        <WorkspaceFileViewer
          file={openFile}
          onClose={() => {
            setOpenFile(null);
            setRefreshKey((k) => k + 1);
          }}
          target={target}
          hostId={hostId}
          hue={hue}
        />
      )}
    </>
  );
}
