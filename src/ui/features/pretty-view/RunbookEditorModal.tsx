import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { cn } from "@/lib/utils";
import {
  enumerateRunbookFiles,
  readRunbookFile,
  writeRunbookFile,
  createRunbookFile,
  deleteRunbookFile,
  deleteRunbook,
  RunbookFileMtimeConflictError,
  RunbookFileAlreadyExistsError,
  type RunbookFileEntry,
} from "@/api/runbooks-api";
import SkillFileTab, { type SkillFileTabData } from "./SkillFileTab";
import type { TabState } from "./IdentityFileTab";

// RunbookEditorModal — role-scoped multi-file editor for a single runbook.
//
// Modal-unification 2026-09-29:
//   - Shell: canonical <Modal hue={324} blocking={false}> (composer stays
//     interactive underneath, same as EditableFileModal).
//   - Head: meta = "Runbook · <roleName>", title = runbookName, actions =
//     Trash2 delete-runbook grouped tight with close X. "+ Add file"
//     moved OUT of the head DOWN into the file strip (tasting anatomy).
//   - File strip MOVED from bottom to TOP — sits directly under the head,
//     above the editor pane (IDE convention: tabs sit atop the surface
//     they select).
//   - Body: <ModalBody> holds the ACTIVE tab's editor only (Radix Tabs is
//     dropped — we pick the active file's SkillFileTab directly).
//   - Foot: canonical <ModalFoot> with Close (secondary) + Save (primary).
//     Save fires the active tab's write endpoint using the per-tab draft
//     map. SkillFileTab renders with `hideSaveButton={true}` — the outer
//     foot owns save placement.
//
// Per-tab draft tracking:
//   drafts   : Map<path, string>  — updated on every keystroke via
//                                   SkillFileTab.onDraftContentChange
//   dirtySet : Set<path>          — updated via onDraftChange; drives the
//                                   close-confirm draft-guard
//
// Close/draft-guard: any dirty tab AND !mid-save fires window.confirm
// ("Discard unsaved changes?"). savingRef bypasses on save-success closes
// (same pattern as EditableFileModal / ProjectFileModal).
//
// Delete-file affordance stays inside SkillFileTab (Trash2 next to Save
// slot). Delete-runbook lives in the head actions slot (Trash2 next to
// close X). Both use native window.confirm — no in-app confirm dialogs
// (fleet convention: natives for nested destructive confirms).
//
// Structured console.debug logging retained with [RunbookEditorModal]
// prefix per the role standing directive on log-first diagnostics.

export interface RunbookEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Host id — inherited from identity modal (no host picker in this modal). */
  hostId: number;
  /** Role slug — dimension threading through every runbooks-api call. */
  roleName: string;
  /** Runbook slug — the single runbook this modal edits. */
  runbookName: string;
  /** Optional portal container — parent controls portal target. */
  container?: HTMLElement | null;
}

export default function RunbookEditorModal({
  open,
  onOpenChange,
  hostId,
  roleName,
  runbookName,
  container,
}: RunbookEditorModalProps): JSX.Element {
  const [files, setFiles] = useState<TabState<RunbookFileEntry[]>>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Map<string, TabState<SkillFileTabData>>>(new Map());

  // Per-tab draft state — SkillFileTab keeps its own internal draft, we
  // mirror it here (via onDraftContentChange) so the foot Save can write
  // the correct content without a ref/imperative call. Keyed by path.
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Reset state on close.
  useEffect(() => {
    if (!open) {
      console.debug("[RunbookEditorModal] close");
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      setDrafts(new Map());
      setDirtySet(new Set());
      setSaving(false);
      savingRef.current = false;
    }
  }, [open]);

  // Fetch file list when modal opens (or when hostId/roleName/runbookName change).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    console.debug("[RunbookEditorModal] open", { hostId, roleName, runbookName });
    setFiles({ status: "loading" });
    setActiveTab(null);
    setTabData(new Map());
    setDrafts(new Map());
    setDirtySet(new Set());
    enumerateRunbookFiles(hostId, roleName, runbookName)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        console.debug("[RunbookEditorModal] files-ready", { count: entries.length });
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
  }, [open, hostId, roleName, runbookName]);

  // Lazy-load content for the active tab (one at a time to conserve SSH conns).
  useEffect(() => {
    if (!open || !activeTab) return;
    if (tabData.has(activeTab)) return; // already loaded
    let cancelled = false;
    console.debug("[RunbookEditorModal] tab-switch", { path: activeTab });
    setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
    readRunbookFile(hostId, roleName, runbookName, activeTab)
      .then((result) => {
        if (cancelled) return;
        setTabData((prev) =>
          new Map(prev).set(activeTab, {
            status: "ready",
            data: {
              content: result.content,
              mtime: result.mtime,
              isText: result.isText,
            },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hostId, roleName, runbookName, activeTab]);

  // Per-tab draft callbacks — factory functions per active tab keep the
  // callbacks referentially stable within a single tab's mount cycle.
  const handleDraftContentChange = useCallback(
    (path: string) => (draft: string) => {
      setDrafts((prev) => {
        if (prev.get(path) === draft) return prev;
        const next = new Map(prev);
        next.set(path, draft);
        return next;
      });
    },
    [],
  );
  const handleDraftDirtyChange = useCallback(
    (path: string) => (dirty: boolean) => {
      setDirtySet((prev) => {
        const currentlyDirty = prev.has(path);
        if (dirty === currentlyDirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(path);
        else next.delete(path);
        return next;
      });
    },
    [],
  );

  // Save handler — the SkillFileTab-facing signature (for handling its own
  // internal save button, though we hide it — this stays wired for the
  // conflict-reload branch which needs to update tab state).
  const handleSave = useCallback(
    async (path: string, content: string, expectedMtime: number): Promise<void> => {
      try {
        const result = await writeRunbookFile({
          hostId,
          role: roleName,
          runbook: runbookName,
          path,
          content,
          expectedMtime,
        });
        setTabData((prev) => {
          const prevEntry = prev.get(path);
          const prevIsText =
            prevEntry?.status === "ready" ? prevEntry.data.isText : true;
          return new Map(prev).set(path, {
            status: "ready",
            data: { content, mtime: result.mtime, isText: prevIsText },
          });
        });
        // After save-success, the draft matches the fresh mtime's content —
        // SkillFileTab's own effect will fire onDraftChange(false) on the
        // next tick, clearing this path from dirtySet.
        console.debug("[RunbookEditorModal] save-ok", { path, mtime: result.mtime });
      } catch (err) {
        if (err instanceof RunbookFileMtimeConflictError) {
          console.debug("[RunbookEditorModal] save-conflict", { path });
          const shouldReload = window.confirm(
            "The file changed on disk since you started editing. Reload from disk and lose your local edits?",
          );
          if (shouldReload) {
            setTabData((prev) => {
              const prevEntry = prev.get(path);
              const prevIsText =
                prevEntry?.status === "ready" ? prevEntry.data.isText : true;
              return new Map(prev).set(path, {
                status: "ready",
                data: {
                  content: err.currentContent,
                  mtime: err.currentMtime,
                  isText: prevIsText,
                },
              });
            });
            return;
          }
          throw err;
        }
        throw err;
      }
    },
    [hostId, roleName, runbookName],
  );

  // Foot Save — dispatches to active tab's save with the tracked draft.
  const handleFootSave = useCallback(async () => {
    if (saving) return;
    if (!activeTab) return;
    const tab = tabData.get(activeTab);
    if (tab?.status !== "ready") return;
    const draft = drafts.get(activeTab) ?? tab.data.content;
    if (draft === tab.data.content) return;
    setSaving(true);
    savingRef.current = true;
    try {
      await handleSave(activeTab, draft, tab.data.mtime);
    } catch (err) {
      window.alert(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
      savingRef.current = false;
    } finally {
      setSaving(false);
      // Leave savingRef true briefly so a subsequent close-on-save doesn't
      // re-prompt. It resets naturally on close via the reset-on-close effect.
    }
  }, [saving, activeTab, tabData, drafts, handleSave]);

  // Add-file handler — window.prompt per D-04.
  const handleAddFile = useCallback(async (): Promise<void> => {
    const raw = window.prompt("New file name (relative to runbook root):", "");
    if (raw == null) return;
    const relPath = raw.trim();
    if (relPath.length === 0) return;
    try {
      console.debug("[RunbookEditorModal] add-file", { path: relPath });
      await createRunbookFile(hostId, roleName, runbookName, relPath);
      const entries = await enumerateRunbookFiles(hostId, roleName, runbookName);
      setFiles({ status: "ready", data: entries });
      setActiveTab(relPath);
    } catch (err) {
      const msg =
        err instanceof RunbookFileAlreadyExistsError
          ? `A file named "${relPath}" already exists in this runbook.`
          : err instanceof Error
          ? `Couldn't create "${relPath}": ${err.message}`
          : `Couldn't create "${relPath}".`;
      window.alert(msg);
    }
  }, [hostId, roleName, runbookName]);

  // Delete-file handler — native confirm + delete + refetch.
  const handleDeleteFile = useCallback(
    async (doomedPath: string): Promise<void> => {
      if (!window.confirm(`Delete "${runbookName}/${doomedPath}"? This can't be undone.`)) return;
      try {
        console.debug("[RunbookEditorModal] delete-file", { path: doomedPath });
        await deleteRunbookFile(hostId, roleName, runbookName, doomedPath);
        const entries = await enumerateRunbookFiles(hostId, roleName, runbookName);
        setFiles({ status: "ready", data: entries });
        if (activeTab === doomedPath) {
          setActiveTab(entries.length > 0 ? entries[0].path : null);
        }
        setTabData((prev) => {
          const next = new Map(prev);
          next.delete(doomedPath);
          return next;
        });
        setDrafts((prev) => {
          const next = new Map(prev);
          next.delete(doomedPath);
          return next;
        });
        setDirtySet((prev) => {
          if (!prev.has(doomedPath)) return prev;
          const next = new Set(prev);
          next.delete(doomedPath);
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete";
        console.debug("[RunbookEditorModal] delete-file-error", { path: doomedPath, msg });
        window.alert(msg);
      }
    },
    [hostId, roleName, runbookName, activeTab],
  );

  // Delete-runbook handler — window.confirm + delete + close.
  const handleDeleteRunbook = useCallback(async (): Promise<void> => {
    if (
      !window.confirm(
        `Delete runbook "${runbookName}"? This removes the runbook folder and every file inside it. This can't be undone.`,
      )
    )
      return;
    try {
      console.debug("[RunbookEditorModal] delete-runbook", { runbookName });
      savingRef.current = true; // bypass draft-guard on the close-after-delete
      await deleteRunbook(hostId, roleName, runbookName);
      onOpenChange(false);
    } catch (err) {
      savingRef.current = false;
      const msg = err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete";
      console.debug("[RunbookEditorModal] delete-runbook-error", { runbookName, msg });
      window.alert(msg);
    }
  }, [hostId, roleName, runbookName, onOpenChange]);

  // Close/draft-guard.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && dirtySet.size > 0 && !savingRef.current) {
        // eslint-disable-next-line no-alert
        const confirmed = window.confirm("Discard unsaved changes?");
        if (!confirmed) return;
      }
      onOpenChange(nextOpen);
    },
    [dirtySet, onOpenChange],
  );

  const activeTabState =
    activeTab != null ? tabData.get(activeTab) : undefined;
  const canFootSave =
    !saving &&
    activeTab != null &&
    activeTabState?.status === "ready" &&
    dirtySet.has(activeTab);

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      hue={324}
      blocking={false}
      size="xl"
      container={container ?? undefined}
      className="max-h-[80vh] flex flex-col"
      data-testid="runbook-editor-modal"
    >
      <ModalHead
        meta={`Runbook · ${roleName}`}
        title={runbookName}
        closeTestId="runbook-editor-modal-close"
        actions={
          <button
            type="button"
            title="Delete this runbook"
            aria-label="Delete this runbook"
            onClick={() => {
              void handleDeleteRunbook();
            }}
            data-testid="runbook-editor-modal-delete-runbook"
            className="size-8 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
          >
            <Trash2 size={16} />
          </button>
        }
      />

      {/* File strip — sits directly under the head, above the editor pane
          (tasting anatomy: IDE convention, tabs atop the surface they
          select). Horizontal-scroll; intrinsic-width tabs; hue-tinted
          selected pill. "+ Add file" pill at the END of the strip
          (moved out of the head per tasting). */}
      {files.status === "ready" && (
        <div
          className={cn(
            "shrink-0 flex items-stretch gap-1 px-2 py-1.5 border-b overflow-x-auto",
            "border-b-[hsla(var(--pv-id-hue),60%,55%,0.18)]",
            "bg-black/25",
          )}
          style={{
            WebkitOverflowScrolling: "touch",
          }}
          data-testid="runbook-editor-modal-file-strip"
        >
          {files.data.map((file) => {
            const selected = activeTab === file.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setActiveTab(file.path)}
                data-testid={`runbook-editor-modal-tab-${file.path}`}
                aria-pressed={selected}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11.5px] cursor-pointer",
                  "transition-colors duration-150",
                  selected
                    ? "text-[#fbf5e8] bg-[hsla(var(--pv-id-hue),65%,55%,0.28)] border border-[hsla(var(--pv-id-hue),65%,60%,0.42)]"
                    : "text-[hsla(var(--pv-id-hue),22%,88%,0.65)] hover:text-[#e8e4d8] hover:bg-white/[0.04] border border-transparent",
                )}
              >
                <FileText size={12} />
                <span className="whitespace-nowrap">{file.path}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              void handleAddFile();
            }}
            data-testid="runbook-editor-modal-add-file"
            className={cn(
              "shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11.5px] cursor-pointer",
              "text-[hsla(var(--pv-id-hue),30%,90%,0.7)] hover:text-[#fbf5e8] hover:bg-white/[0.04]",
              "transition-colors duration-150",
            )}
          >
            <Plus size={12} /> Add file
          </button>
        </div>
      )}

      {/* Body — layered branches. */}
      {files.status === "loading" ? (
        <ModalBody className="flex items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] text-sm">
          Loading files…
        </ModalBody>
      ) : files.status === "error" ? (
        <ModalBody className="flex items-center justify-center text-red-400 text-sm px-6 text-center">
          Couldn&apos;t load files: {files.error}
        </ModalBody>
      ) : files.data.length === 0 ? (
        <ModalBody className="flex flex-col items-center justify-center text-[hsla(var(--pv-id-hue),22%,88%,0.65)] gap-2 text-sm text-center px-6">
          <div>This runbook has no files.</div>
          <div className="text-xs opacity-70">
            Use &quot;+ Add file&quot; to create one.
          </div>
        </ModalBody>
      ) : (
        <ModalBody
          className="p-0 flex flex-col min-h-0 overflow-y-auto px-6 py-4"
          data-testid="runbook-editor-modal-body"
        >
          {activeTab != null && (
            <SkillFileTab
              state={tabData.get(activeTab) ?? { status: "loading" }}
              onSave={(content, expectedMtime) =>
                handleSave(activeTab, content, expectedMtime)
              }
              onRequestDelete={() => {
                void handleDeleteFile(activeTab);
              }}
              filename={activeTab}
              hideSaveButton={true}
              onDraftContentChange={handleDraftContentChange(activeTab)}
              onDraftChange={handleDraftDirtyChange(activeTab)}
            />
          )}
        </ModalBody>
      )}

      {/* Foot — Close + Save. Rendered even when no files (Save disabled)
          so the modal chrome is consistent across states. */}
      <ModalFoot>
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          disabled={saving}
          data-testid="runbook-editor-modal-close-foot"
          className={cn(
            "px-3 py-1.5 rounded-md text-[12.5px] cursor-pointer",
            "bg-black/20 border border-white/10",
            "hover:bg-black/30",
            "text-[#e8e4d8]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          Close
        </button>
        <button
          type="button"
          onClick={() => {
            void handleFootSave();
          }}
          disabled={!canFootSave}
          data-testid="runbook-editor-modal-save"
          className={cn(
            "px-4 py-1.5 rounded-md text-[12.5px] font-medium cursor-pointer",
            "bg-[hsla(var(--pv-id-hue),65%,45%,0.75)]",
            "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.85)]",
            "border border-[hsla(var(--pv-id-hue),65%,55%,0.7)]",
            "text-[#f4f1e8]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </ModalFoot>
    </Modal>
  );
}
