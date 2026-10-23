import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RotateCw } from "lucide-react";

import type { RowKebabMenuItem } from "@/features/pretty-conversations/RowKebabMenu";
import EditableFileModal from "@/features/pretty-view/EditableFileModal";
import { FileView } from "@/features/pretty-view/file-viewers/FileView";
import { FileViewSwitch, useMarkdownSwitchHost } from "@/features/pretty-view/file-viewers/FileWindowHead";
import { MarkdownSwitchHostContext } from "@/features/pretty-view/markdown-mode-switch";
import { FileSpeakButton } from "@/features/pretty-view/file-viewers/FileSpeakButton";
import {
  fileViewNeedsContent,
  resolveFileViewer,
} from "@/features/pretty-view/file-viewers/registry";
import {
  OPEN_FILE_IN_CONVERSATION_EVENT,
  buildSkynetFileUrl,
  fileNameOfPath,
  type OpenFileInConversationDetail,
} from "@/features/pretty-view/file-url";
import {
  describeFileUrlError,
  probeFileUrl,
  useFileUrlContent,
} from "@/features/pretty-view/file-url-content";
import { useIsMobile } from "@/hooks/use-mobile";
import { systemLogger } from "@/lib/frontend-logger";
import { encodeWorkspaceSpec, specForTab } from "@/lib/tab-url";
import { hasSkynetDragPayload } from "./SplitView";
import { subscribeDragSessionEnd } from "./drag-preview-session";
import { PANE_BAR_BUTTON_CLASS, PANE_BAR_SPEAK_CLASS, PaneBar } from "./PaneBar";

// ─── FilePane — a file shown read-only in its own pane ─────────────────────
//
// A chat-shared file (a Skynet file URL, `/file/<host>/<path>`) dragged out
// of a conversation into split view. The body is the shared FileView — the
// same viewers the file modal uses — opened read-only: no typing, cell edits
// or annotations, and no Save. Editing stays in the modal (⋯ → Open in modal).
//
// Bar (PaneBar, same family as app and remote-desktop panes):
//   - Left: Reload (re-reads the file from its machine) and Download.
//   - Title: the file type's icon and the file name (name only — Copy path
//     in the menu has where it lives).
//   - Right: read aloud (prose files — .md / .txt — once read), the view
//     switcher (types with more than one view), then ⋯.
//   - Menu (also right-click): Open in modal → Copy path → Download →
//     Move to new tab (desktop) → Close (desktop).
//
// When the file can't be shown (deleted, too large, no access) the pane stays
// with a notice saying why; Reload tries again. Views that load straight from
// the URL (images, PDFs, …) never see a read error, so the pane checks the
// URL still serves before trusting them.
//
// Open in modal: the modal's Save attaches the edited copy to a conversation,
// so the pane asks the conversation the file came from (`origin`) to open its
// own modal (OPEN_FILE_IN_CONVERSATION_EVENT). When that conversation isn't
// open in this window, the pane opens the modal itself, without Save.

export interface FilePaneProps {
  /** The file URL's host segment. */
  host: string;
  /** Absolute path on that host. */
  path: string;
  /** Encoded tab spec of the conversation the file was dragged from. */
  origin?: string | null;
  tabId: string;
  isVisible: boolean;
  /** Clicking the bar selects this pane (split focus). */
  onSelectPane?: (tabId: string) => void;
  /** Bar menu's Close / Move to new tab tear this pane down. */
  onCloseTab?: (tabId: string) => void;
}

type Probe = { status: "checking" } | { status: "ok" } | { status: "error"; errorClass: string };

export function FilePane({
  host,
  path,
  origin = null,
  tabId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isVisible,
  onSelectPane,
  onCloseTab,
}: FilePaneProps): ReactElement {
  const isMobile = useIsMobile();
  const url = useMemo(() => buildSkynetFileUrl(host, path), [host, path]);
  const filename = fileNameOfPath(path);
  const entry = resolveFileViewer(filename);
  const TitleIcon = entry.icon;
  const logCtx = { tabId, host, filename };

  const [viewMode, setViewMode] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const needsContent = fileViewNeedsContent(filename, viewMode, true);
  const content = useFileUrlContent({ url, enabled: needsContent, reloadToken });

  // Existence check for views that don't read the content themselves.
  const [probe, setProbe] = useState<Probe>({ status: "checking" });
  useEffect(() => {
    if (needsContent) return;
    const ctrl = new AbortController();
    setProbe({ status: "checking" });
    probeFileUrl(url, ctrl.signal)
      .then((errorClass) => {
        if (ctrl.signal.aborted) return;
        setProbe(errorClass === null ? { status: "ok" } : { status: "error", errorClass });
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [url, needsContent, reloadToken]);

  const errorClass = needsContent
    ? content.status === "error"
      ? content.error
      : null
    : probe.status === "error"
      ? probe.errorClass
      : null;
  const lastLoggedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (errorClass === lastLoggedErrorRef.current) return;
    lastLoggedErrorRef.current = errorClass;
    if (errorClass !== null) {
      systemLogger.warn(`[file-pane] can't show file: ${errorClass}`, {
        operation: "file_pane_unavailable",
        errorClass,
        reloadToken,
        ...logCtx,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorClass]);

  const reload = () => {
    systemLogger.info("[file-pane] reload", { operation: "file_pane_reload", ...logCtx });
    setReloadToken((n) => n + 1);
  };

  const download = () => {
    systemLogger.info("[file-pane] download", { operation: "file_pane_download", ...logCtx });
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Fallback modal (no source conversation in this window): view-only.
  const [localModalOpen, setLocalModalOpen] = useState(false);
  const openInModal = () => {
    let handled = false;
    if (origin) {
      const detail: OpenFileInConversationDetail = { origin, url, filename };
      handled = !window.dispatchEvent(
        new CustomEvent(OPEN_FILE_IN_CONVERSATION_EVENT, { cancelable: true, detail }),
      );
    }
    systemLogger.info("[file-pane] open in modal", {
      operation: "file_pane_open_in_modal",
      hasOrigin: origin !== null,
      handledByConversation: handled,
      ...logCtx,
    });
    if (!handled) setLocalModalOpen(true);
  };

  const menuItems = useMemo<RowKebabMenuItem[]>(() => {
    const items: RowKebabMenuItem[] = [
      { label: "Open in modal", testId: "file-pane-menu-open-modal", onClick: openInModal },
      {
        label: "Copy path",
        testId: "file-pane-menu-copy-path",
        onClick: () => {
          void navigator.clipboard?.writeText(path).then(
            () => systemLogger.info("[file-pane] copy path", { operation: "file_pane_copy_path", ...logCtx }),
            (err: unknown) =>
              systemLogger.warn(`[file-pane] copy path failed: ${(err as Error)?.message}`, {
                operation: "file_pane_copy_path",
                ...logCtx,
              }),
          );
        },
      },
      { label: "Download", testId: "file-pane-menu-download", onClick: download },
    ];
    // Desktop-only — mobile has no multi-window story, and on a phone the
    // pane IS the screen.
    if (!isMobile) {
      const spec = specForTab({ type: "file", file: { host, path, origin } });
      if (spec !== null) {
        items.push({
          label: "Move to new tab",
          testId: "file-pane-menu-move-new-window",
          onClick: () => {
            const w = window.open(
              "#" + encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true }),
              "_blank",
            );
            systemLogger.info("[file-pane-menu] move to new tab", {
              operation: "file_pane_menu_move_window",
              opened: w !== null,
              ...logCtx,
            });
            // Popup blocked → keep the pane rather than lose it.
            if (w !== null) onCloseTab?.(tabId);
          },
        });
      }
      if (onCloseTab) {
        items.push({
          label: "Close",
          testId: "file-pane-menu-close",
          onClick: () => onCloseTab(tabId),
        });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, host, path, origin, url, filename, tabId, onCloseTab]);

  // Drag shield: viewers can hold iframes (PDF, …) that swallow drag events,
  // so while a Skynet drag is in flight the body ignores the pointer and the
  // pane underneath sees the drop (same treatment as AppPane's frame).
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mute = (e: DragEvent) => {
      if (!hasSkynetDragPayload(e.dataTransfer)) return;
      const el = bodyRef.current;
      if (el !== null && el.style.pointerEvents !== "none") el.style.pointerEvents = "none";
    };
    const unsubscribe = subscribeDragSessionEnd(() => {
      const el = bodyRef.current;
      if (el !== null) el.style.pointerEvents = "";
    });
    window.addEventListener("dragstart", mute);
    window.addEventListener("dragover", mute);
    return () => {
      window.removeEventListener("dragstart", mute);
      window.removeEventListener("dragover", mute);
      unsubscribe();
    };
  }, []);

  const markdownSwitch = useMarkdownSwitchHost();
  const errorCopy = errorClass !== null ? describeFileUrlError(errorClass, url) : null;
  // Read aloud, as in the file modal's head. FileSpeakButton renders nothing
  // for files that aren't prose or have nothing to say.
  const speakText =
    errorClass === null && content.status === "ready" && content.data.isText !== false
      ? content.data.content
      : null;
  // Markdown's Formatted / Plain text switch sits here with the other view
  // switches, not on a row of its own inside the viewer.
  const switcher =
    entry.modes.length > 1 || (/\.md$/i.test(filename) && speakText !== null) ? (
      <FileViewSwitch
        filename={filename}
        mode={viewMode}
        onModeChange={setViewMode}
        formattedUnavailable={markdownSwitch.formattedUnavailable}
      />
    ) : null;
  const rightControls =
    speakText !== null || switcher !== null ? (
      <>
        {speakText !== null ? (
          <FileSpeakButton filename={filename} text={speakText} className={PANE_BAR_SPEAK_CLASS} />
        ) : null}
        {switcher}
      </>
    ) : null;

  return (
    <div className="flex flex-col h-full w-full" data-testid="file-pane" data-file-path={path}>
      <PaneBar
        tabId={tabId}
        testIdPrefix="file-pane"
        logTag="file-bar"
        logContext={{ host, filename }}
        dragPayload={{
          identityKey: null,
          hostId: null,
          descriptor: { tabType: "file", file: { host, path, origin }, label: filename },
        }}
        title={filename}
        titleIcon={<TitleIcon aria-hidden="true" />}
        rightControls={rightControls}
        menuItems={menuItems}
        onSelectPane={onSelectPane}
        navButtons={
          <>
            <button
              type="button"
              data-testid="file-pane-reload"
              aria-label="Reload from disk"
              title="Reload from disk"
              draggable={false}
              onClick={reload}
              className={PANE_BAR_BUTTON_CLASS}
            >
              <RotateCw aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="file-pane-download"
              aria-label="Download"
              title="Download"
              draggable={false}
              onClick={download}
              className={PANE_BAR_BUTTON_CLASS}
            >
              <Download aria-hidden="true" />
            </button>
          </>
        }
      />
      <div
        ref={bodyRef}
        className="relative flex-1 min-h-0 w-full overflow-auto bg-[var(--color-pv-base,#141520)] px-4 py-3"
        data-testid="file-pane-body"
      >
        {errorCopy !== null ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center"
            data-testid="file-pane-unavailable"
            data-error-class={errorClass ?? undefined}
          >
            <div className="text-base font-semibold text-[#f0ebe0]">{errorCopy.heading}</div>
            <div className="max-w-md text-sm text-[#a89a80]">{errorCopy.body}</div>
            <button
              type="button"
              onClick={reload}
              data-testid="file-pane-unavailable-reload"
              className="mt-1 px-4 py-2 rounded-md text-sm cursor-pointer bg-black/20 border border-white/10 hover:bg-black/30 text-[#e8e4d8]"
            >
              Reload
            </button>
          </div>
        ) : (
          <MarkdownSwitchHostContext.Provider value={markdownSwitch.host}>
          <FileView
            key={reloadToken}
            filename={filename}
            state={content}
            mediaUrl={url}
            downloadUrl={url}
            mode={viewMode ?? undefined}
            onModeChange={setViewMode}
            hideModeSwitcher={true}
            hideSpeakButton={true}
            readOnly={true}
          />
          </MarkdownSwitchHostContext.Provider>
        )}
      </div>
      {localModalOpen && (
        <EditableFileModal
          open={localModalOpen}
          onOpenChange={setLocalModalOpen}
          messageEventId=""
          url={url}
          filename={filename}
          agentIdentityName={null}
        />
      )}
    </div>
  );
}
