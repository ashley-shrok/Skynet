/**
 * Phase 118 Plan 118-03 — WorkspaceTab.tsx
 *
 * The entire in-modal workspace file browser: list-mode + viewer-mode.
 *
 * Architecture:
 *   WorkspaceTab (default export)
 *     ├─ WorkspaceListView  — list-mode body (breadcrumb + toolbar + sortable
 *     │                       columns + drag-drop + host chip + row overflow)
 *     └─ WorkspaceFileViewer — viewer-mode body (md / text / image / binary)
 *
 * D-10 (no modal stacking): WorkspaceFileViewer is a plain <div> child — no
 * modal or portal chrome wrapping. Grep gate enforces zero modal imports.
 *
 * D-05 / D-06 (snapshot + no polling): a single useEffect + refreshKey counter.
 * No polling, no live subscriptions, no agent-facing side effects in this file.
 *
 * D-23 / D-24 (consumer-user register): every user-visible string is plain
 * English, no developer jargon (no "SSH", "SFTP", "endpoint", "regex",
 * "octal", "chmod", "curl").
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash,
  Upload,
} from "lucide-react";
import type { Identity } from "@/api/identities-api";
import {
  createWorkspaceFile,
  deleteWorkspaceEntry,
  downloadWorkspaceFileUrl,
  listWorkspace,
  mkdirWorkspace,
  readWorkspaceFile,
  renameWorkspaceEntry,
  uploadWorkspaceFile,
  writeWorkspaceFile,
} from "@/api/workspace-api";
import type { ListResponse, WorkspaceEntry } from "@/api/workspace-api";
import {
  resolveWorkspaceErrorCopy,
  WORKSPACE_ERROR_COPY,
} from "./workspace-error-copy";
import GlobalFileTab from "./GlobalFileTab";
import type { GlobalFileTabData } from "./GlobalFileTab";
import type { TabState } from "./IdentityFileTab";

// ---------------------------------------------------------------------------
// Lazy-load MarkdownEditor (avoids pulling ~1.5MB MDX bundle into initial load)
// Mirrors IdentityFileTab / MarkdownEditor's own Suspense pattern.
// ---------------------------------------------------------------------------

const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor }))
);

// ---------------------------------------------------------------------------
// File-type dispatch helpers (D-12)
// ---------------------------------------------------------------------------

const MD_RE = /\.md$/i;
const TEXT_RE =
  /\.(txt|json|ts|tsx|js|jsx|css|html|log|yml|yaml|py|sh|env|toml|ini|xml|csv|rs|go|java|c|cpp|h|rb|php|swift|kt)$/i;
const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp|svg)$/i;

function getFileViewType(
  name: string
): "markdown" | "text" | "image" | "binary" {
  if (MD_RE.test(name)) return "markdown";
  if (TEXT_RE.test(name)) return "text";
  if (IMAGE_RE.test(name)) return "image";
  // Extensionless files (.gitignore, LICENSE, Makefile, Dockerfile, …)
  // default to text — no extension can't be inferred as binary either.
  if (name.lastIndexOf(".") <= 0) return "text";
  return "binary";
}

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
// WorkspaceFileViewer — inline viewer-mode (D-09, D-10, D-11, D-12)
// NO modal/portal chrome — inline plain div only (D-10 enforcement).
// ---------------------------------------------------------------------------

interface OpenFileState {
  name: string;
  relativePath: string;
  type: "markdown" | "text" | "image" | "binary";
}

type FileFetchState =
  | { status: "loading" }
  | { status: "ready"; data: { contentBase64: string } }
  | { status: "error"; errorClass: string };

function WorkspaceFileViewer({
  file,
  onBack,
  identity,
  hostId,
}: {
  file: OpenFileState;
  onBack: () => void;
  identity: Identity;
  hostId: number;
  hue: number;
}): JSX.Element {
  const [fetchState, setFetchState] = useState<FileFetchState>({
    status: "loading",
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  // For GlobalFileTab — mtime=0 is last-write-wins V1 compromise (see SUMMARY)
  const [tabState, setTabState] = useState<TabState<GlobalFileTabData>>({
    status: "loading",
  });
  const [mdContent, setMdContent] = useState<string>("");
  // Unsaved-edit tracking so back-nav can confirm before discarding.
  // mdOriginalRef holds the last fetched/saved content for markdown-mode
  // dirty comparison. textDirty is fed by GlobalFileTab.onDraftChange.
  const mdOriginalRef = useRef<string>("");
  const [textDirty, setTextDirty] = useState(false);

  // Helper to decode base64 to UTF-8 string
  function decodeBase64(b64: string): string {
    try {
      return decodeURIComponent(
        atob(b64)
          .split("")
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("")
      );
    } catch {
      try {
        return atob(b64);
      } catch {
        return "";
      }
    }
  }

  // Fetch the file content for md / text / image (binary skips fetch)
  useEffect(() => {
    if (file.type === "binary") return;
    let cancelled = false;
    setFetchState({ status: "loading" });
    setTabState({ status: "loading" });
    setSaveError(null);
    readWorkspaceFile(identity.identityKey, hostId, file.relativePath)
      .then((data) => {
        if (!cancelled) {
          setFetchState({ status: "ready", data });
          const decoded = decodeBase64(data.contentBase64);
          setMdContent(decoded);
          mdOriginalRef.current = decoded;
          setTextDirty(false);
          setTabState({ status: "ready", data: { content: decoded, mtime: 0 } });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const errorClass =
            err instanceof Error ? err.message : "host_unreachable";
          setFetchState({ status: "error", errorClass });
          setTabState({ status: "error", error: errorClass });
        }
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.identityKey, hostId, file.relativePath, file.type]);

  // Save handler for md + text (all hooks unconditional — Rules of Hooks)
  const handleSave = useCallback(
    async (newContent: string) => {
      setSaveError(null);
      try {
        await writeWorkspaceFile(
          identity.identityKey,
          hostId,
          file.relativePath,
          newContent
        );
        // Success: content on disk now matches draft — clear dirty flags so
        // back-nav doesn't prompt for changes already persisted.
        mdOriginalRef.current = newContent;
        setTextDirty(false);
      } catch (err) {
        const errorClass =
          err instanceof Error ? err.message : "generic";
        const copy = resolveWorkspaceErrorCopy(errorClass);
        setSaveError(copy.heading + ": " + copy.body);
      }
    },
    [identity.identityKey, hostId, file.relativePath]
  );

  // Back-nav guard: confirm before discarding unsaved edits.
  const guardedBack = useCallback(() => {
    const mdDirty = file.type === "markdown" && mdContent !== mdOriginalRef.current;
    if (
      (mdDirty || textDirty) &&
      !window.confirm("Discard unsaved changes?")
    ) {
      return;
    }
    onBack();
  }, [file.type, mdContent, textDirty, onBack]);

  // Save adapter for GlobalFileTab (accepts mtime argument which we ignore — V1)
  const globalFileSave = useCallback(
    async (content: string, _mtime: number) => {
      await handleSave(content);
    },
    [handleSave]
  );

  // Derive MIME type for image data URIs
  const mimeByExt: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const mime = mimeByExt[ext] ?? "application/octet-stream";

  const downloadUrl = downloadWorkspaceFileUrl(
    identity.identityKey,
    hostId,
    file.relativePath
  );

  // Header
  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderBottom: "1px solid var(--color-pv-border-quiet)",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={guardedBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: "var(--color-pv-fg-muted)",
          cursor: "pointer",
          fontSize: 13,
          padding: "4px 8px",
          borderRadius: 6,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--color-pv-border-quiet)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "none";
        }}
      >
        <ChevronLeft size={14} />
        Back
      </button>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-pv-fg)",
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {file.name}
      </span>
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
    </div>
  );

  // Error state
  if (fetchState.status === "error") {
    const copy = resolveWorkspaceErrorCopy(fetchState.errorClass);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {header}
        <div style={{ padding: 16 }}>
          <ErrorBanner heading={copy.heading} body={copy.body} />
        </div>
      </div>
    );
  }

  // Body content
  let body: JSX.Element;

  if (file.type === "binary") {
    // Binary — skip fetch, show empty state + download
    body = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 16,
          color: "var(--color-pv-fg-muted)",
          padding: 24,
        }}
      >
        <File size={40} style={{ opacity: 0.4 }} />
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-pv-fg)",
              marginBottom: 6,
            }}
          >
            This file can&apos;t be previewed.
          </div>
          <div style={{ fontSize: 13 }}>
            Use the Download button above to save it.
          </div>
        </div>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 8,
            background:
              "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.18)",
            border:
              "1px solid hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
            color: "var(--color-pv-fg)",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          <Download size={14} />
          Download
        </a>
      </div>
    );
  } else if (file.type === "image") {
    if (fetchState.status === "loading") {
      body = (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-pv-fg-muted)",
            fontSize: 13,
          }}
        >
          Loading…
        </div>
      );
    } else {
      // data:image/<ext>;base64,<contentBase64> — MIME resolved from extension above
      const dataUri = `data:${mime};base64,${fetchState.data.contentBase64}`;
      body = (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <img
            src={dataUri}
            alt={file.name}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              display: "block",
              margin: "auto",
              borderRadius: 6,
            }}
          />
        </div>
      );
    }
  } else if (file.type === "markdown") {
    // Lazy-loaded MarkdownEditor — D-11 reuse, D-10 no modal wrapper.
    // The MDXEditor internal DOM has no built-in scroll, and the tab body
    // is height-constrained by the enclosing IdentityModal, so a tall
    // markdown file's content otherwise clips off the bottom (and takes the
    // save button below it out of reach). Wrap the editor in a
    // flex:1 / minHeight:0 / overflow:auto scroll container so tall files
    // scroll inside the tab while the save-button row below stays fixed.
    body = (
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          padding: "0 2px 2px",
        }}
      >
        {fetchState.status === "loading" ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-pv-fg-muted)",
              fontSize: 13,
            }}
          >
            Loading…
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <Suspense
              fallback={
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 24,
                    color: "var(--color-pv-fg-muted)",
                    fontSize: 13,
                  }}
                >
                  Loading editor…
                </div>
              }
            >
              <MarkdownEditor
                filename={file.name}
                content={mdContent}
                onChange={setMdContent}
              />
            </Suspense>
          </div>
        )}
        {fetchState.status === "ready" && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "8px 4px 4px",
              flexShrink: 0,
              gap: 8,
            }}
          >
            {saveError && (
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: "hsla(6, 80%, 55%, 0.9)",
                  alignSelf: "center",
                }}
              >
                {saveError}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                void handleSave(mdContent);
              }}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                background:
                  "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.2)",
                border:
                  "1px solid hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
                color: "var(--color-pv-fg)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Save
            </button>
          </div>
        )}
      </div>
    );
  } else {
    // text — GlobalFileTab (D-11 reuse, D-10 no modal wrapper)
    body = (
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          padding: "0 2px 2px",
        }}
      >
        <GlobalFileTab
          state={tabState}
          onSave={globalFileSave}
          onDraftChange={setTextDirty}
          filename={file.name}
        />
        {saveError && (
          <div
            style={{
              padding: "4px 8px",
              fontSize: 12,
              color: "hsla(6, 80%, 55%, 0.9)",
            }}
          >
            {saveError}
          </div>
        )}
      </div>
    );
  }

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
      {header}
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListState — mirrors TabState<T> from IdentityFileTab (D-05 fetch machine)
// ---------------------------------------------------------------------------

type ListState =
  | { status: "loading" }
  | { status: "ready"; data: ListResponse }
  | { status: "error"; errorClass: string };

// ---------------------------------------------------------------------------
// WorkspaceListView — list-mode body
// Toolbar + breadcrumb + sortable columns + drag-drop + host chip + row menu
// ---------------------------------------------------------------------------

interface WorkspaceListViewProps {
  currentPath: string[];
  onNavigate: (newPath: string[]) => void;
  onOpenFile: (file: OpenFileState) => void;
  identity: Identity;
  hostId: number;
  hue: number;
  refreshKey: number;
  onRefresh: () => void;
}

function WorkspaceListView({
  currentPath,
  onNavigate,
  onOpenFile,
  identity,
  hostId,
  hue,
  refreshKey,
  onRefresh,
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
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [renamingFor, setRenamingFor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // D-05: fetch on mount + whenever path, identity, hostId, or refreshKey changes
  useEffect(() => {
    if (!identity.identityKey) return;
    let cancelled = false;
    setListState({ status: "loading" });
    listWorkspace(identity.identityKey, hostId, currentPath.join("/"))
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
  }, [identity.identityKey, hostId, currentPath, refreshKey]);

  // Sort column toggling (D-14)
  function handleSortClick(col: "name" | "size" | "mtime") {
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
            identity.identityKey,
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
            identity.identityKey,
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
        await mkdirWorkspace(identity.identityKey, hostId, targetPath);
      } else {
        await createWorkspaceFile(identity.identityKey, hostId, targetPath);
      }
      setPendingNew(null);
      setNewName("");
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
    const targetPath =
      currentPath.length > 0
        ? currentPath.join("/") + "/" + entry.name
        : entry.name;
    try {
      await deleteWorkspaceEntry(identity.identityKey, hostId, targetPath);
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
    const fromPath =
      currentPath.length > 0
        ? currentPath.join("/") + "/" + entry.name
        : entry.name;
    const toPath =
      currentPath.length > 0
        ? currentPath.join("/") + "/" + renameValue.trim()
        : renameValue.trim();
    setRenameError(null);
    try {
      await renameWorkspaceEntry(identity.identityKey, hostId, fromPath, toPath);
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
    if (openMenuFor) {
      setOpenMenuFor(null);
      return;
    }
    if (entry.type === "directory") {
      onNavigate([...currentPath, entry.name]);
    } else {
      const viewType = getFileViewType(entry.name);
      const relativePath =
        currentPath.length > 0
          ? currentPath.join("/") + "/" + entry.name
          : entry.name;
      onOpenFile({ name: entry.name, relativePath, type: viewType });
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

  const sortableStyle = (col: "name" | "size" | "mtime"): React.CSSProperties => ({
    cursor: "pointer",
    userSelect: "none",
    color:
      sortKey === col
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
    if (sortKey !== col) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  // Sorted entries for rendering
  const sortedEntries =
    listState.status === "ready"
      ? sortEntries(listState.data.entries, sortKey, sortDir)
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
      onClick={() => {
        if (openMenuFor) setOpenMenuFor(null);
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
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flex: 1,
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
              if (currentPath.length > 0) onNavigate([]);
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
                    onNavigate(currentPath.slice(0, i + 1));
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

        {/* Loading state */}
        {listState.status === "loading" && (
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
        {listState.status === "error" && (
          <div style={{ padding: "8px 10px" }}>
            <ErrorBanner
              heading={resolveWorkspaceErrorCopy(listState.errorClass).heading}
              body={resolveWorkspaceErrorCopy(listState.errorClass).body}
            />
          </div>
        )}

        {/* Empty folder */}
        {listState.status === "ready" &&
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
        {listState.status === "ready" &&
          sortedEntries.map((entry) => {
            const isRenaming = renamingFor === entry.name;
            const menuOpen = openMenuFor === entry.name;
            const entryPath =
              currentPath.length > 0
                ? currentPath.join("/") + "/" + entry.name
                : entry.name;

            return (
              <div
                key={entry.name}
                style={{
                  ...rowStyle,
                  background: menuOpen
                    ? "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.06)"
                    : undefined,
                  position: "relative",
                }}
                onClick={() => {
                  if (isRenaming || menuOpen) return;
                  handleRowClick(entry);
                }}
                onMouseEnter={(e) => {
                  if (!menuOpen) {
                    (e.currentTarget as HTMLElement).style.background =
                      "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!menuOpen) {
                    (e.currentTarget as HTMLElement).style.background = "";
                  }
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

                {/* Overflow menu button */}
                <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    title="Actions"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--color-pv-fg-muted)",
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: menuOpen ? 1 : undefined,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuFor(menuOpen ? null : entry.name);
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      if (!menuOpen) {
                        (e.currentTarget as HTMLElement).style.opacity = "";
                      }
                    }}
                  >
                    <MoreVertical size={14} />
                  </button>

                  {/* Dropdown menu */}
                  {menuOpen && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 2px)",
                        zIndex: 50,
                        background: "var(--color-pv-base-mid)",
                        border: "1px solid var(--color-pv-border-quiet-strong)",
                        borderRadius: 8,
                        boxShadow:
                          "0 8px 24px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.06) inset",
                        minWidth: 140,
                        padding: "4px 0",
                      }}
                    >
                      {/* Rename */}
                      <button
                        type="button"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          padding: "7px 12px",
                          background: "none",
                          border: "none",
                          color: "var(--color-pv-fg)",
                          fontSize: 13,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        onClick={() => {
                          setOpenMenuFor(null);
                          setRenamingFor(entry.name);
                          setRenameValue(entry.name);
                          setRenameError(null);
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.background =
                            "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.1)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background =
                            "none";
                        }}
                      >
                        <Pencil size={13} style={{ opacity: 0.7 }} />
                        Rename
                      </button>

                      {/* Download (files only) */}
                      {entry.type !== "directory" && (
                        <a
                          href={downloadWorkspaceFileUrl(
                            identity.identityKey,
                            hostId,
                            entryPath
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            width: "100%",
                            padding: "7px 12px",
                            color: "var(--color-pv-fg)",
                            fontSize: 13,
                            cursor: "pointer",
                            textDecoration: "none",
                          }}
                          onClick={() => setOpenMenuFor(null)}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background =
                              "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.1)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background =
                              "none";
                          }}
                        >
                          <Download size={13} style={{ opacity: 0.7 }} />
                          Download
                        </a>
                      )}

                      <div
                        style={{
                          height: 1,
                          background: "var(--color-pv-border-quiet)",
                          margin: "4px 0",
                        }}
                      />

                      {/* Delete (D-07 — confirm before delete) */}
                      <button
                        type="button"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          padding: "7px 12px",
                          background: "none",
                          border: "none",
                          color: "hsla(6, 80%, 55%, 0.9)",
                          fontSize: 13,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        onClick={() => {
                          setOpenMenuFor(null);
                          void handleDelete(entry);
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.background =
                            "hsla(6, 80%, 53%, 0.1)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background =
                            "none";
                        }}
                      >
                        <Trash size={13} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

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
  identity: Identity;
  hostId: number;
  hue: number;
}

// ---------------------------------------------------------------------------
// WorkspaceTab — default export
// Switches between list-mode and viewer-mode based on viewMode state.
// currentPath is preserved during viewer-mode so Back returns to same folder.
// ---------------------------------------------------------------------------

export default function WorkspaceTab({
  identity,
  hostId,
  hue,
}: WorkspaceTabProps): JSX.Element {
  const [viewMode, setViewMode] = useState<"list" | "viewer">("list");
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [openFile, setOpenFile] = useState<OpenFileState | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Viewer mode — inline swap (D-09, D-10)
  if (viewMode === "viewer" && openFile) {
    return (
      <WorkspaceFileViewer
        file={openFile}
        onBack={() => {
          setViewMode("list");
        }}
        identity={identity}
        hostId={hostId}
        hue={hue}
      />
    );
  }

  // List mode
  return (
    <WorkspaceListView
      currentPath={currentPath}
      onNavigate={setCurrentPath}
      onOpenFile={(file) => {
        setOpenFile(file);
        setViewMode("viewer");
      }}
      identity={identity}
      hostId={hostId}
      hue={hue}
      refreshKey={refreshKey}
      onRefresh={() => setRefreshKey((k) => k + 1)}
    />
  );
}
