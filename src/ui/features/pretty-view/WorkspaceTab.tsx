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
  KitBanner,
  KitButton,
  KitCrumbs,
  KitEmpty,
  KitIconButton,
  KitInput,
  KitLoading,
  KitSearch,
  KitToolbar,
  KitToolbarSpacer,
  kitAlert,
  kitConfirm,
} from "@/components/kit";
import {
  RowKebabContextMenuSurface,
  RowKebabMenu,
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
    <KitBanner tone="danger" className="my-2">
      <div className="font-semibold">{heading}</div>
      <div className="text-[12.5px] opacity-85">{body}</div>
    </KitBanner>
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

  // Close guard: confirm before discarding unsaved edits. One question at a
  // time — another close request while it's open is ignored.
  const confirmingRef = useRef(false);
  const guardedClose = useCallback(async () => {
    if (dirty) {
      if (confirmingRef.current) return;
      confirmingRef.current = true;
      try {
        const ok = await kitConfirm({
          title: "Discard unsaved changes?",
          body: `Your edits to ${file.name} haven't been saved.`,
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
          destructive: true,
        });
        if (!ok) return;
      } finally {
        confirmingRef.current = false;
      }
    }
    onClose();
  }, [dirty, onClose, file.name]);

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
      {/* A link styled as the kit's ordinary small button (downloads need <a>). */}
      <a
        href={downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="k-btn no-underline"
        data-variant="secondary"
        data-size="sm"
      >
        <Download aria-hidden="true" />
        Download
      </a>
      {canSave && (
        <KitButton
          variant="primary"
          size="sm"
          onClick={() => {
            void (binaryDraft ? handleSaveBytes(binaryDraft) : handleSave(draft));
          }}
          busy={saving}
          disabled={!dirty}
        >
          {saving ? "Saving…" : "Save"}
        </KitButton>
      )}
    </>
  );

  let body: ReactNode;
  if (fileState.status === "error") {
    const copy = resolveWorkspaceErrorCopy(errorClass ?? fileState.error);
    body = (
      <ErrorBanner heading={copy.heading} body={copy.body} />
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
        if (!next) void guardedClose();
      }}
      hue={hue}
      size="editor"
      data-testid="workspace-file-modal"
    >
      <ModalHead title={file.name} actions={headActions} />
      <ModalBody className="p-0 flex flex-col px-6 py-4">
        {body}
        {saveError && (
          <KitBanner tone="danger" className="mt-2 shrink-0">
            {saveError}
          </KitBanner>
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
  /** The listing on screen is for the folder in the breadcrumb (not still the
   *  previous folder's, mid-navigation). */
  const listShowsCurrentFolder =
    listState.status === "ready" && listState.data.path === currentPath.join("/");

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
    setFlashPath(null);
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
    if (!flashPath) return;
    // The folder failed to load — drop the ring rather than let it fire on
    // some later listing.
    if (listState.status === "error") {
      setFlashPath(null);
      return;
    }
    if (!listShowsCurrentFolder || showingResults) return;
    const row = Array.from(
      listBodyRef.current?.querySelectorAll<HTMLElement>("[data-path]") ?? [],
    ).find((el) => el.dataset.path === flashPath);
    row?.scrollIntoView?.({ block: "nearest" });
    const timer = setTimeout(() => setFlashPath(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashPath, listState, listShowsCurrentFolder, showingResults]);

  /** Go to the folder a search result lives in and point it out there. */
  function showInFolder(entry: WorkspaceEntry) {
    const folder = entry.path.split("/").slice(0, -1);
    if (folder.join("/") === currentPath.join("/")) {
      // Already here — the listing is loaded; just end the search.
      clearSearch();
    } else {
      navigateTo(folder);
    }
    setFlashPath(entry.path);
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
    const ok = await kitConfirm({
      title: `Delete "${entry.name}"?`,
      body:
        entry.type === "directory"
          ? "The folder and everything in it will be deleted. This can't be undone."
          : "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const targetPath = pathOf(entry);
    try {
      await deleteWorkspaceEntry(target, hostId, targetPath);
      onRefresh();
    } catch (err) {
      const errorClass = err instanceof Error ? err.message : "generic";
      const copy = resolveWorkspaceErrorCopy(errorClass);
      await kitAlert({ title: copy.heading, body: copy.body });
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

  // Name / Size / Modified columns, shared by the header and every row.
  const gridCols = "grid grid-cols-[28px_minmax(0,1fr)_80px_100px_32px] items-center";

  const activeSort = showingResults ? searchSort : { key: sortKey, dir: sortDir };
  const sortableClass = (col: "name" | "size" | "mtime"): string =>
    `inline-flex items-center gap-[3px] cursor-pointer select-none hover:text-[var(--k-t1)] ${
      activeSort?.key === col ? "text-[var(--k-acc-text)]" : "text-[var(--k-t3)]"
    }`;

  const arrowChar = (col: "name" | "size" | "mtime"): string => {
    if (!activeSort || activeSort.key !== col) return "";
    return activeSort.dir === "asc" ? " ▲" : " ▼";
  };

  const crumbs = [
    {
      label: "Workspace",
      onClick: currentPath.length > 0 ? () => navigateTo([]) : undefined,
    },
    ...currentPath.map((seg, i) => ({
      label: seg,
      onClick: i < currentPath.length - 1 ? () => navigateTo(currentPath.slice(0, i + 1)) : undefined,
    })),
  ];

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
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar: breadcrumb + action buttons */}
      <KitToolbar className="mx-2.5 mt-1 shrink-0" aria-label="Files">
        {/* Breadcrumb (D-13). Sized to its one-line width: when the path
            doesn't fit beside the buttons, the buttons wrap below and the
            path gets the whole line instead of squeezing into a narrow
            column beside them — on a phone or in a narrow modal alike. */}
        <KitCrumbs
          aria-label="Folder path"
          crumbs={crumbs}
          className="flex-[1_1_max-content] flex-wrap"
        />
        <KitToolbarSpacer />

        {/* Hidden file input for upload */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFilePickerChange(e);
          }}
        />

        {/* Upload button (D-16) */}
        <KitButton
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          title="Upload files to this folder"
        >
          <Upload aria-hidden="true" />
          Upload
        </KitButton>

        {/* New folder (D-17) */}
        <KitButton
          size="sm"
          onClick={() => {
            setPendingNew("folder");
            setNewName("");
            setNewError(null);
          }}
          title="Create a new folder here"
        >
          <FolderPlus aria-hidden="true" />
          New folder
        </KitButton>

        {/* New file (D-17) */}
        <KitButton
          size="sm"
          onClick={() => {
            setPendingNew("file");
            setNewName("");
            setNewError(null);
          }}
          title="Create a new file here"
        >
          <FilePlus aria-hidden="true" />
          New file
        </KitButton>

        {/* Refresh (D-05) */}
        <KitIconButton label="Refresh" size="sm" onClick={onRefresh}>
          <RefreshCw />
        </KitIconButton>
      </KitToolbar>

      {/* Search box — its own full-width row so it fits on a phone. Searches
          this folder and every folder below it, by name, as you type. */}
      <div className="flex items-center gap-2 px-2.5 pt-2 shrink-0">
        <KitSearch
          ref={searchInputRef}
          value={query}
          onValueChange={setQuery}
          wrapperClassName="flex-1 min-w-0"
          onKeyDown={(e) => {
            // Esc clears the search (KitSearch does that, and keeps the
            // modal open while there's text); also let go of the box.
            if (e.key === "Escape") {
              clearSearch();
              searchInputRef.current?.blur();
            }
          }}
          maxLength={SEARCH_MAX_QUERY_CHARS}
          placeholder="Search this folder and its subfolders"
          aria-label="Search files and folders"
          data-testid="workspace-search-input"
        />
        {searchActive && searching && (
          <span
            className="text-[12.5px] text-[var(--k-t3)] whitespace-nowrap"
            data-testid="workspace-search-searching"
          >
            Searching…
          </span>
        )}
      </div>

      {/* First-encounter intro — what this tab is / what it shows. */}
      <div className="px-3.5 pt-2 pb-2 text-[12.5px] text-[var(--k-t3)] shrink-0">
        {introCopy ??
          "This agent's file workspace. Anything you drop in, they can read; anything they save, you can grab from here."}
      </div>

      {/* Upload error banner */}
      {uploadError && (
        <div className="px-2.5">
          <ErrorBanner
            heading="Upload failed"
            body={uploadError}
          />
        </div>
      )}

      {/* Column headers */}
      <div
        className={`${gridCols} px-2.5 py-1 mx-1 shrink-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--k-t3)]`}
      >
        <span />
        <span>
          <span className={sortableClass("name")} onClick={() => handleSortClick("name")}>
            Name{arrowChar("name")}
          </span>
        </span>
        <span
          className={`${sortableClass("size")} justify-end`}
          onClick={() => handleSortClick("size")}
        >
          Size{arrowChar("size")}
        </span>
        <span
          className={`${sortableClass("mtime")} pl-3`}
          onClick={() => handleSortClick("mtime")}
        >
          Modified{arrowChar("mtime")}
        </span>
        <span />
      </div>

      {/* File list body with drag-drop (D-16) */}
      <div
        ref={listBodyRef}
        className="flex-1 overflow-auto relative px-1 pb-2"
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
            className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-1.5 px-2.5 py-1.5 mb-1 rounded-[12px] bg-[var(--k-s1)]"
          >
            <span className="flex justify-center">
              {pendingNew === "folder" ? (
                <Folder size={16} className="text-[var(--k-acc-text)]" aria-hidden="true" />
              ) : (
                <File size={16} className="text-[var(--k-t3)]" aria-hidden="true" />
              )}
            </span>
            <KitInput
              autoFocus
              size="sm"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={
                pendingNew === "folder" ? "New folder name" : "New file name"
              }
              aria-label={pendingNew === "folder" ? "New folder name" : "New file name"}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setPendingNew(null);
                  setNewError(null);
                }
              }}
            />
            <KitButton type="submit" variant="primary" size="sm">
              Create
            </KitButton>
            <KitButton
              size="sm"
              onClick={() => {
                setPendingNew(null);
                setNewError(null);
              }}
            >
              Cancel
            </KitButton>
          </form>
        )}
        {newError && (
          <div className="px-1.5">
            <ErrorBanner heading="Could not create" body={newError} />
          </div>
        )}

        {/* Rename error banner */}
        {renameError && (
          <div className="px-1.5">
            <ErrorBanner heading="Could not rename" body={renameError} />
          </div>
        )}

        {/* Search failed — shown in place of results */}
        {searchActive && searchError && (
          <div className="px-1.5">
            <ErrorBanner
              heading={resolveWorkspaceErrorCopy(searchError).heading}
              body={resolveWorkspaceErrorCopy(searchError).body}
            />
          </div>
        )}

        {/* A limit cut the search short — say which, never hide it silently */}
        {showingResults && !searchError && searchData && (searchData.truncated || searchData.timedOut) && (
          <KitBanner tone="info" className="mx-1.5 my-1.5" data-testid="workspace-search-limit-notice">
            {searchData.timedOut
              ? "Search stopped after 5 seconds — there may be more matches."
              : "Showing the first 200 matches — type more to narrow it."}
          </KitBanner>
        )}

        {/* No matches */}
        {showingResults && !searchError && sortedEntries.length === 0 && (
          <KitEmpty
            data-testid="workspace-search-no-matches"
            icon={<Search aria-hidden="true" />}
            title="No matches"
            body="Nothing here or in the folders below has a name like that."
          />
        )}

        {/* Loading state */}
        {!showingResults && listState.status === "loading" && (
          <KitLoading className="px-2.5" />
        )}

        {/* Error state */}
        {!showingResults && listState.status === "error" && (
          <div className="px-1.5">
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
            <KitEmpty
              icon={<Folder aria-hidden="true" />}
              title="Empty folder"
              body="Drop files here or use the toolbar."
            />
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
            const flashing = flashPath === entryPath && !showingResults && listShowsCurrentFolder;
            const menuItems = rowMenuItems(entry);

            return (
              // Right-click the row → the same menu as its ⋮.
              <RowKebabContextMenuSurface key={entryPath} items={menuItems}>
              <div
                data-testid="workspace-row"
                data-path={entryPath}
                data-flash={flashing ? "" : undefined}
                className={`${gridCols} relative px-2.5 py-[7px] rounded-[10px] cursor-pointer text-[13px] text-[var(--k-t1)] hover:bg-[var(--k-s1)] transition-shadow duration-[400ms] data-[flash]:shadow-[inset_0_0_0_2px_var(--k-acc)]`}
                // Dimmed while a newer search runs.
                style={searchActive && searching ? { opacity: 0.5 } : undefined}
                onClick={() => {
                  if (isRenaming) return;
                  handleRowClick(entry);
                }}
              >
                {/* Icon */}
                <span className="flex items-center justify-center">
                  {entry.type === "directory" ? (
                    <Folder size={16} className="text-[var(--k-acc-text)]" aria-hidden="true" />
                  ) : (
                    <File size={16} className="text-[var(--k-t3)]" aria-hidden="true" />
                  )}
                </span>

                {/* Name — inline rename input */}
                {isRenaming ? (
                  <form
                    onSubmit={(e) => {
                      void handleRenameSubmit(e, entry);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 min-w-0"
                  >
                    <KitInput
                      autoFocus
                      size="sm"
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      aria-label={`New name for ${entry.name}`}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setRenamingFor(null);
                          setRenameError(null);
                        }
                      }}
                      className="flex-1 min-w-0"
                    />
                    <KitButton type="submit" variant="primary" size="sm">
                      OK
                    </KitButton>
                    <KitButton
                      size="sm"
                      onClick={() => {
                        setRenamingFor(null);
                        setRenameError(null);
                      }}
                    >
                      Cancel
                    </KitButton>
                  </form>
                ) : (
                  <span className="flex flex-col min-w-0">
                    <span className="truncate" title={entry.name}>
                      {entry.name}
                    </span>
                    {showingResults && (
                      <span
                        className="truncate text-[11.5px] text-[var(--k-t3)]"
                        title={resultLocation(entry, currentPath)}
                        data-testid="workspace-result-location"
                      >
                        {resultLocation(entry, currentPath)}
                      </span>
                    )}
                  </span>
                )}

                {/* Size */}
                <span className="text-[12px] text-[var(--k-t3)] text-right">
                  {entry.type !== "directory"
                    ? formatBytes(entry.size)
                    : "—"}
                </span>

                {/* Modified */}
                <span className="text-[12px] text-[var(--k-t3)] pl-3">
                  {formatMtime(entry.mtimeMs)}
                </span>

                {/* Row menu — the app's standard ⋮ menu; right-click on the
                    row opens the same one. */}
                <span className="flex justify-center">
                  <RowKebabMenu
                    items={menuItems}
                    ariaLabel={`Actions for ${entry.name}`}
                    testId="workspace-row-menu"
                  />
                </span>
              </div>
              </RowKebabContextMenuSurface>
            );
          })}

        {/* What the search never looks in — always said under results */}
        {showingResults && !searchError && (
          <div
            className="px-2.5 pt-2.5 pb-3.5 text-[11.5px] text-[var(--k-t3)] text-center"
            data-testid="workspace-search-skipped-note"
          >
            Package and environment folders aren't searched.
          </div>
        )}

        {/* Drag-drop overlay (D-16, dragCounter pattern) */}
        {dragActive && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none rounded-[12px] border-2 border-dashed border-[var(--k-acc)] bg-[var(--k-acc-soft)]">
            <div className="rounded-[12px] bg-[var(--k-menu)] px-7 py-4 text-center text-[14px] font-semibold text-[var(--k-t1)] shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
              Drop to upload
              <div className="mt-1 text-[11.5px] font-normal text-[var(--k-t3)]">
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
