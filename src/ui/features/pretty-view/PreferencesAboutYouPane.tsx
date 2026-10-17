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
 *         GlobalFilesModal — 409 conflict triggers a kit confirm + reload.
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
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listGlobalFiles,
  readGlobalFile,
  writeGlobalFile,
  GlobalFileMtimeConflictError,
  type GlobalFileEntry,
} from "@/api/global-files-api";
import type { TabState } from "./IdentityFileTab";
import type { FileViewData } from "./file-viewers/FileView";
import { MarkdownEditor } from "./MarkdownEditor";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitLoading,
  KitSegmented,
  KitSelect,
  kitConfirm,
} from "@/components/kit";

// IMPLICIT_ABOUT_YOU_PATH: the path that the backend always includes per host
// (from backend global-files-config-loader.ts L59-217 IMPLICIT_GLOBAL_FILE
// constant). The first tab whose path matches this receives the "About you"
// label override per D-28.
const IMPLICIT_ABOUT_YOU_PATH = "~/.claude/CLAUDE.md";

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
  const [tabData, setTabData] = useState<Map<string, TabState<FileViewData>>>(new Map());

  // Per-path editor state — one draft per file path so tab switches don't
  // silently overwrite a user's unsaved edits (M1 fix). Paired with
  // `draftBaseMtimes` so the seed effect can tell "new content arrived from
  // the server" (mtime changed → re-seed, overwriting draft) from "user
  // switched away and back" (mtime unchanged → preserve their typed draft).
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [draftBaseMtimes, setDraftBaseMtimes] = useState<Map<string, number>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Convenience: draft for the currently-visible tab (empty string when the
  // tab hasn't loaded / been seeded yet).
  const draft = activeTab ? drafts.get(activeTab) ?? "" : "";

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
    // M1: also clear per-path drafts so a host switch doesn't leak a stale
    // draft for a path that happened to exist under both hosts' configs.
    setDrafts(new Map());
    setDraftBaseMtimes(new Map());
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

  // ── Seed drafts from active tab data ────────────────────────────────────
  // M1 fix: only re-seed the draft when either (a) we've never seeded this
  // path before, or (b) the server-side mtime has changed (i.e. save success
  // or 409-reload delivered fresh content). If the user just switched tabs
  // and came back, mtime is unchanged → we preserve whatever they had typed.
  const activeReady = activeTab ? tabData.get(activeTab) : undefined;
  const activeMtime =
    activeReady?.status === "ready" ? activeReady.data.mtime : null;
  useEffect(() => {
    if (!activeTab || activeReady?.status !== "ready") return;
    const baseMtime = draftBaseMtimes.get(activeTab);
    if (baseMtime === activeReady.data.mtime) return; // draft is still in sync with what we started editing → keep the user's edits
    setDrafts((prev) => new Map(prev).set(activeTab, activeReady.data.content));
    setDraftBaseMtimes((prev) => new Map(prev).set(activeTab, activeReady.data.mtime));
    setSaveError(null);
  // draftBaseMtimes is read inside but MUST NOT trigger — the effect only
  // reacts to the server-side mtime changing or the tab flipping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeMtime]);

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
        const shouldReload = await kitConfirm({
          title: "Reload from disk?",
          body: "The file changed on disk since you started editing. Reloading loses your local edits.",
          confirmLabel: "Reload",
          cancelLabel: "Keep my edits",
          destructive: true,
        });
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
        // User chose to keep draft — show the friendly error inline (M3 fix:
        // don't leak the raw "mtime mismatch" backend jargon to end users).
        setSaveError(
          "Not saved — the file changed since you started editing. Save again to overwrite, or close and reopen this to see the newer version.",
        );
        setSaving(false);
        return;
      }
      // M3 fix: generic user-facing wording rather than raw err.message,
      // which can be network-layer strings ("timeout of 30000ms exceeded")
      // that don't help the user.
      setSaveError("Save failed — please try again.");
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
    <div className="flex flex-col h-full gap-3">
      {/* Header row: blurb + (optional) host picker */}
      <div className="flex items-start justify-between gap-4 shrink-0 flex-wrap">
        <p className="m-0 text-[13px] text-[var(--k-t2)] leading-snug max-w-[400px]">
          Tell your agents anything you want them to know about you — how you work, your preferences, anything.
        </p>

        {/* Host picker: only when flatHosts.length > 1 (D-27) */}
        {showHostPicker && (
          <div data-testid="preferences-about-you-host-picker" className="shrink-0">
            <KitSelect
              size="sm"
              aria-label="Host"
              value={selectedHostId ?? ""}
              onChange={(e) =>
                setSelectedHostId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Pick a host…</option>
              {flatHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </KitSelect>
          </div>
        )}
      </div>

      {/* Tab strip: only when files.data.length > 1 (D-28) */}
      {showTabStrip && (
        <KitSegmented
          className="shrink-0 self-start max-w-full overflow-x-auto"
          aria-label="Files"
          value={activeTab ?? ""}
          onValueChange={(next) => setActiveTab(next)}
          options={(files as { status: "ready"; data: GlobalFileEntry[] }).data.map((file, index) => ({
            value: file.path,
            label: <span className="truncate">{getTabLabel(file, index === 0)}</span>,
            Icon: FileText,
            testId: `preferences-about-you-tab-${file.path}`,
          }))}
        />
      )}

      {/* Body: no host / loading / error / content */}
      {selectedHostId == null ? (
        <KitEmpty className="flex-1" title="Pick a host to load its configured files." />
      ) : files.status === "loading" ? (
        <KitLoading className="flex-1" />
      ) : files.status === "error" ? (
        <KitBanner tone="danger">{files.error}</KitBanner>
      ) : files.data.length === 0 ? (
        <KitEmpty
          className="flex-1"
          title="No global files configured for this host."
          body={
            <>
              Edit <code>/app/data/global-files.json</code> on the server to add entries.
            </>
          }
        />
      ) : activeTabState?.status === "loading" || !activeTabState ? (
        <KitLoading className="flex-1" />
      ) : activeTabState.status === "error" ? (
        <KitBanner tone="danger">{activeTabState.error}</KitBanner>
      ) : (
        // Ready: editor + save button (Pitfall 4 — flex-col h-full min-h-0)
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          <div className="flex justify-end gap-2 shrink-0">
            <KitButton
              variant="primary"
              onClick={() => { void handleSave(); }}
              disabled={draft === activeTabState.data.content}
              busy={saving}
            >
              {saving ? "Saving…" : "Save"}
            </KitButton>
          </div>
          <div className="flex-1 min-h-0">
            <MarkdownEditor
              filename={activeTab ?? "about-you.md"}
              content={draft}
              onChange={(next) => {
                if (!activeTab) return;
                setDrafts((prev) => new Map(prev).set(activeTab, next));
              }}
              disabled={saving}
            />
          </div>
          {saveError && (
            <p className="m-0 k-err" role="alert" data-testid="preferences-about-you-save-error">
              {saveError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
