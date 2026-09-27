/**
 * PreferencesAboutYouPane — Plan 137-05 Task 1.
 *
 * Folds the entire GlobalFilesModal interior (host picker, per-file tab strip,
 * lazy per-tab SSH read, and mtime-optimistic save flow) into the About-you
 * pane of the preferences modal. Uses the shared MarkdownEditor (D-24).
 *
 * Design decisions:
 *   D-22: Rebranded from "Global files" to "About you"; pane blurb is the
 *         verbatim user-facing string from CONTEXT.md § Specifics.
 *   D-24: MarkdownEditor wrapper used (not raw textarea, not direct mdxeditor mount).
 *   D-25: Explicit Save button; disabled when draft unchanged or save in flight.
 *   D-26: mtime-optimistic-concurrency save flow preserved verbatim from
 *         GlobalFilesModal — 409 conflict triggers window.confirm + reload.
 *   D-27: Host picker only when flatHosts.length > 1.
 *   D-28: Tab strip only when files.data.length > 1; first tab labeled
 *         "About you" when its path matches IMPLICIT_ABOUT_YOU_PATH.
 *   D-29: Globe button retirement handled in Task 2 (PrettyConversationsPanel).
 *
 * State is owned locally (per D-05: panes reset on modal close).
 * Do NOT wrap in DialogPrimitive — this is a pane, not a modal.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listGlobalFiles,
  readGlobalFile,
  writeGlobalFile,
  GlobalFileMtimeConflictError,
  type GlobalFileEntry,
} from "@/api/global-files-api";
import type { TabState } from "./IdentityFileTab";
import type { GlobalFileTabData } from "./GlobalFileTab";
import { MarkdownEditor } from "./MarkdownEditor";

// IMPLICIT_ABOUT_YOU_PATH: the path that the backend always includes per host
// (from backend global-files-config-loader.ts L59-217 IMPLICIT_GLOBAL_FILE
// constant). The first tab whose path matches this receives the "About you"
// label override per D-28.
const IMPLICIT_ABOUT_YOU_PATH = "~/.claude/CLAUDE.md";

// Chrome/Linux desktop <option> popup inherits browser defaults, not the
// parent <select>'s Tailwind classes — reads near-black-on-black. Explicit
// inline bg + fg on every <option> forces readable contrast in the dropdown
// popup. Verbatim from GlobalFilesModal.tsx L33 (OPTION_STYLE constant).
const OPTION_STYLE = { backgroundColor: "#1a1a1a", color: "#e8e4d8" } as const;

// NOTE: duplicated from GlobalFilesModal.tsx (pending shared HostPickerList
// extraction — RESEARCH F1). Third instance intentional — keeps plan diff scoped.
function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) out.push(...collectAllHosts(child.children));
    else out.push(child);
  }
  return out;
}

export interface PreferencesAboutYouPaneProps {
  /** Host tree from useHostTree() upstream — same source GlobalFilesModal uses. */
  hostTree: HostFolder | null;
  /** Default host selection — the currently-focused session's host, if any. */
  defaultHostId: number | null;
  // userId kept for API compat with Plan 02 stub — not consumed by this pane
  userId?: string;
}

export function PreferencesAboutYouPane({
  hostTree,
  defaultHostId,
}: PreferencesAboutYouPaneProps): JSX.Element {
  // ── State atoms (verbatim from GlobalFilesModal.tsx L68-71) ──────────────
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [files, setFiles] = useState<TabState<GlobalFileEntry[]>>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Map<string, TabState<GlobalFileTabData>>>(new Map());

  // Per-active-tab editor state (draft + saving + error)
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const flatHosts = useMemo(
    () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
    [hostTree],
  );

  // ── Host auto-select (verbatim from GlobalFilesModal.tsx L78-94) ─────────
  useEffect(() => {
    // Prefer defaultHostId if it's in the fleet
    if (defaultHostId != null && flatHosts.some((h) => Number(h.id) === defaultHostId)) {
      setSelectedHostId(defaultHostId);
      return;
    }
    // Auto-select sole host
    if (flatHosts.length === 1) setSelectedHostId(Number(flatHosts[0].id));
  }, [defaultHostId, flatHosts]);

  // ── Files fetch (verbatim from GlobalFilesModal.tsx L97-119) ────────────
  useEffect(() => {
    if (selectedHostId == null) return;
    let cancelled = false;
    setFiles({ status: "loading" });
    setTabData(new Map());
    setActiveTab(null);
    listGlobalFiles(selectedHostId)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        if (entries.length > 0) setActiveTab(entries[0].path);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFiles({
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load files",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHostId]);

  // ── Lazy per-tab content load (verbatim from GlobalFilesModal.tsx L121-155) ──
  useEffect(() => {
    if (selectedHostId == null || !activeTab) return;
    if (tabData.has(activeTab)) return; // already loaded
    let cancelled = false;
    setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
    readGlobalFile(selectedHostId, activeTab)
      .then((result) => {
        if (cancelled) return;
        setTabData((prev) =>
          new Map(prev).set(activeTab, {
            status: "ready",
            data: { content: result.content, mtime: result.mtime },
          }),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTabData((prev) =>
          new Map(prev).set(activeTab, {
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load",
          }),
        );
      });
    return () => {
      cancelled = true;
    };
    // Intentional exhaustive-deps violation: including `tabData` re-runs this effect after
    // `setTabData({loading})`, whose cleanup sets `cancelled = true` on the still-in-flight
    // `readGlobalFile` (see plan 260805-7rq). The `tabData.has(activeTab)` gate inside the
    // body is a deliberate stale-closure read — "if the currently-known map already tracks
    // this tab, skip".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHostId, activeTab]);

  // ── Seed draft from active tab data ─────────────────────────────────────
  // Whenever activeTab data becomes ready (or mtime changes after save/409-reload),
  // seed the draft from the server-authoritative content.
  useEffect(() => {
    if (!activeTab) return;
    const state = tabData.get(activeTab);
    if (state?.status === "ready") {
      setDraft(state.data.content);
      setSaveError(null);
    }
  // Intentional: mtime is the reset key — re-seed when data is ready or mtime changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tabData.get(activeTab)?.status === "ready" ? (tabData.get(activeTab) as { status: "ready"; data: GlobalFileTabData }).data.mtime : null]);

  // ── Save handler with 409 UX (verbatim from GlobalFilesModal.tsx L157-189) ──
  const handleSave = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || !activeTab) return;
    const state = tabData.get(activeTab);
    if (state?.status !== "ready") return;

    setSaving(true);
    setSaveError(null);
    try {
      const result = await writeGlobalFile({
        hostId: selectedHostId,
        path: activeTab,
        content: draft,
        expectedMtime: state.data.mtime,
      });
      // Update tab with server-authoritative mtime so next save doesn't spurious-409
      setTabData((prev) =>
        new Map(prev).set(activeTab, {
          status: "ready",
          data: { content: draft, mtime: result.mtime },
        }),
      );
    } catch (err) {
      if (err instanceof GlobalFileMtimeConflictError) {
        const shouldReload = window.confirm(
          "The file changed on disk since you started editing. Reload from disk and lose your local edits?",
        );
        if (shouldReload) {
          setTabData((prev) =>
            new Map(prev).set(activeTab, {
              status: "ready",
              data: { content: err.currentContent, mtime: err.currentMtime },
            }),
          );
          // Don't rethrow — the user chose to reload; tab is reset silently
          setSaving(false);
          return;
        }
        // User chose to keep draft — show the error inline
        setSaveError(err.message);
        setSaving(false);
        return;
      }
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [selectedHostId, activeTab, tabData, draft]);

  // ── Derived state for current tab ────────────────────────────────────────
  const activeTabState = activeTab ? tabData.get(activeTab) : undefined;

  // ── Tab label helper (D-28) ──────────────────────────────────────────────
  function getTabLabel(file: GlobalFileEntry, isFirst: boolean): string {
    if (isFirst && file.path === IMPLICIT_ABOUT_YOU_PATH) return "About you";
    return file.label ?? file.path.split("/").pop() ?? file.path;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const showHostPicker = flatHosts.length > 1;
  const filesReady = files.status === "ready";
  const showTabStrip = filesReady && files.data.length > 1;

  return (
    <div className="flex flex-col h-full gap-3 p-6">
      {/* Header row: blurb + (optional) host picker */}
      <div className="flex items-start justify-between gap-4 shrink-0">
        <p className="text-[13px] text-[#a89a80] leading-snug max-w-[400px]">
          Tell your agents anything you want them to know about you — how you work, your preferences, anything.
        </p>

        {/* Host picker: only when flatHosts.length > 1 (D-27) */}
        {showHostPicker && (
          <div data-testid="preferences-about-you-host-picker" className="shrink-0">
            <select
              value={selectedHostId ?? ""}
              onChange={(e) =>
                setSelectedHostId(e.target.value ? Number(e.target.value) : null)
              }
              className="px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] text-sm outline-none cursor-pointer"
            >
              <option value="" style={OPTION_STYLE}>Pick a host…</option>
              {flatHosts.map((h) => (
                <option key={h.id} value={h.id} style={OPTION_STYLE}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tab strip: only when files.data.length > 1 (D-28) */}
      {showTabStrip && (
        <div className="flex gap-1 shrink-0 border-b border-white/10 pb-1">
          {(files as { status: "ready"; data: GlobalFileEntry[] }).data.map((file, index) => {
            const selected = activeTab === file.path;
            const label = getTabLabel(file, index === 0);
            return (
              <button
                key={file.path}
                type="button"
                data-testid={`preferences-about-you-tab-${file.path}`}
                onClick={() => setActiveTab(file.path)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] cursor-pointer transition-colors min-w-0",
                  selected
                    ? "text-[#f0ebe0] font-semibold bg-[hsla(220,80%,60%,0.18)]"
                    : "text-[#a89a80] hover:text-[#e8e4d8]",
                )}
                style={
                  selected
                    ? { boxShadow: "inset 0 0 0 1px hsla(220, 80%, 70%, 0.28)" }
                    : undefined
                }
              >
                <FileText size={14} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Body: no host / loading / error / content */}
      {selectedHostId == null ? (
        <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
          Pick a host to load its configured files.
        </div>
      ) : files.status === "loading" ? (
        <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
          Loading…
        </div>
      ) : files.status === "error" ? (
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm text-center">
          {files.error}
        </div>
      ) : files.data.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[#a89a80] gap-2 text-sm text-center">
          <div>No global files configured for this host.</div>
          <div className="text-xs opacity-70">
            Edit{" "}
            <code className="px-1 rounded bg-black/30">/app/data/global-files.json</code>{" "}
            on the server to add entries.
          </div>
        </div>
      ) : activeTabState?.status === "loading" || !activeTabState ? (
        <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
          Loading…
        </div>
      ) : activeTabState.status === "error" ? (
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm text-center">
          {activeTabState.error}
        </div>
      ) : (
        // Ready: editor + save button (Pitfall 4 — flex-col h-full min-h-0)
        <div className="flex flex-col h-full gap-2">
          <div className="flex justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={saving || draft === activeTabState.data.content}
              className="px-4 py-2 rounded-md bg-[hsla(220,80%,60%,0.2)] hover:bg-[hsla(220,80%,60%,0.3)] text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed text-sm cursor-pointer"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <MarkdownEditor
              filename={activeTab ?? "about-you.md"}
              content={draft}
              onChange={setDraft}
              disabled={saving}
            />
          </div>
          {saveError && (
            <div
              data-testid="preferences-about-you-save-error"
              className="text-sm text-red-400"
            >
              {saveError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
