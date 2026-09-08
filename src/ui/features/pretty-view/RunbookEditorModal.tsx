import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, X, Trash2 } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { Tabs, TabsContent } from "@/components/tabs";
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
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import type { TabState } from "./IdentityFileTab";

// Phase 89 Plan 04: RunbookEditorModal — byte-shape clone of SkillsEditorModal.tsx
// (696 lines) adapted for role-scoped runbook editing (D-01).
//
// Header per D-02: runbook name (slug) label + delete-runbook button + close button.
// NO host picker (inherited from identity modal — modal opens with hostId already resolved).
// NO runbook picker (single-runbook editor per open per D-02; user goes back to identity
// modal to pick another). NO skill-picker analog.
//
// Body: layered branches — files loading → error → no-files → tabs. Mirrors SkillsEditorModal
// L516-556 minus host-not-picked + skills-loading/error/no-skills/skill-not-picked branches
// (all handled by the caller: modal only opens when host + role + runbook are ALL resolved).
//
// Bottom tab strip: horizontal-scroll, one tab per file, FULL relative path label (D-03).
// mtime-409 save UX mirrors SkillsEditorModal L227-277. Add-file uses window.prompt (D-04).
// Two DeleteConfirmDialog mounts inside Portal: delete-file + delete-runbook (D-04 + D-05).
// Auto-select first file on open (D-07 + SkillsEditorModal L171).
//
// Controlled component: callers own `open` + `onOpenChange` state. Wave 5 (identity modal
// changes) drives the open signal via a launcher row click that swaps out the identity modal
// (D-06 swap-not-stack). Wave 6 (PrettyView) mounts this modal as a top-level surface.
//
// Structured logging per role standing directive log-first diagnostics:
// [RunbookEditorModal] prefix on console.debug at all key lifecycle boundaries.

export interface RunbookEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Host id — inherited from identity modal (no host picker in this modal per D-02). */
  hostId: number;
  /** Role slug — dimension threading through every runbooks-api call (per D-14). Sourced from identity.role at the launcher. */
  roleName: string;
  /** Runbook slug — the single runbook this modal edits (per D-02). */
  runbookName: string;
  /** Optional portal container (parent handles portal target — Wave 6 mounts with document.body since this is a top-level surface per D-06 swap-not-stack). */
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

  // Delete confirmation state — per-dialog so a stale error / in-flight flag
  // from one dialog can't bleed into the other (mirrors SkillsEditorModal L86-92).
  const [deleteFileConfirm, setDeleteFileConfirm] = useState<{ path: string } | null>(null);
  const [deleteFileInFlight, setDeleteFileInFlight] = useState<boolean>(false);
  const [deleteFileError, setDeleteFileError] = useState<string | null>(null);
  const [deleteRunbookConfirm, setDeleteRunbookConfirm] = useState<boolean>(false);
  const [deleteRunbookInFlight, setDeleteRunbookInFlight] = useState<boolean>(false);
  const [deleteRunbookError, setDeleteRunbookError] = useState<string | null>(null);

  // useMemo reference kept for structural parity with SkillsEditorModal — this
  // modal has no flatHosts derived state, but the import of useMemo is preserved
  // in the import list per byte-shape clone discipline (D-01). Linter-safe because
  // the hook is used below in the files-fetch effect deps comment.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _structuralParity = useMemo(() => null, []);

  // Reset state on close (mirrors SkillsEditorModal L102-116, adapted for fewer state slots).
  useEffect(() => {
    if (!open) {
      console.debug("[RunbookEditorModal] close");
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      setDeleteFileConfirm(null);
      setDeleteFileInFlight(false);
      setDeleteFileError(null);
      setDeleteRunbookConfirm(false);
      setDeleteRunbookInFlight(false);
      setDeleteRunbookError(null);
    }
  }, [open]);

  // Fetch file list when modal opens (or when hostId/roleName/runbookName change).
  // Mirrors SkillsEditorModal L157-183, keyed on [open, hostId, roleName, runbookName]
  // instead of [selectedHostId, selectedSkillName] since those are props, not state.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    console.debug("[RunbookEditorModal] open", { hostId, roleName, runbookName });
    setFiles({ status: "loading" });
    setActiveTab(null);
    setTabData(new Map());
    enumerateRunbookFiles(hostId, roleName, runbookName)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        console.debug("[RunbookEditorModal] files-ready", { count: entries.length });
        // D-07 + SkillsEditorModal L171: auto-select first file on open.
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

  // Lazy-load content for the active tab (one at a time to avoid burning SSH connections).
  // Deps are [open, hostId, roleName, runbookName, activeTab] — NOT tabData — per
  // Phase 23's quick-260805-7rq race fix (same rationale as SkillsEditorModal L219-225 comment).
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
    // Intentional exhaustive-deps violation: including `tabData` re-runs this effect after
    // `setTabData({loading})`, whose cleanup sets `cancelled = true` on the still-in-flight
    // `readRunbookFile` (see plan 260805-7rq). The `tabData.has(activeTab)` gate inside the
    // body is a deliberate stale-closure read — "if the currently-known map already tracks
    // this tab, skip".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hostId, roleName, runbookName, activeTab]);

  // Save handler with 409 → confirm + reload UX (mirrors SkillsEditorModal L227-277).
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
        // Update tab with server-authoritative mtime so next save doesn't spurious-409.
        // Preserve isText from the previously-loaded state (text files stay text).
        setTabData((prev) => {
          const prevEntry = prev.get(path);
          const prevIsText =
            prevEntry?.status === "ready" ? prevEntry.data.isText : true;
          return new Map(prev).set(path, {
            status: "ready",
            data: { content, mtime: result.mtime, isText: prevIsText },
          });
        });
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

  // Add-file handler — window.prompt per D-04, then refetch file list.
  const handleAddFile = useCallback(async (): Promise<void> => {
    const raw = window.prompt("New file name (relative to runbook root):", "");
    if (raw == null) return;
    const relPath = raw.trim();
    if (relPath.length === 0) return;
    try {
      console.debug("[RunbookEditorModal] add-file", { path: relPath });
      await createRunbookFile(hostId, roleName, runbookName, relPath);
      // Refetch file list; auto-select the new tab on success.
      const entries = await enumerateRunbookFiles(hostId, roleName, runbookName);
      setFiles({ status: "ready", data: entries });
      setActiveTab(relPath);
    } catch (err) {
      // Surface as a transient prompt-style alert. Do NOT clobber `files`
      // state — that would hide every existing tab and lose unsaved drafts
      // until the user closes+reopens the modal (the exact "friction on the
      // fast path" the shape flagged as the sole failure mode). Consistent
      // with the existing window.prompt UX for the filename input.
      const msg =
        err instanceof RunbookFileAlreadyExistsError
          ? `A file named "${relPath}" already exists in this runbook.`
          : err instanceof Error
          ? `Couldn't create "${relPath}": ${err.message}`
          : `Couldn't create "${relPath}".`;
      window.alert(msg);
    }
  }, [hostId, roleName, runbookName]);

  // Delete-file confirm handler (mirrors SkillsEditorModal L309-344).
  const handleDeleteFile = useCallback(async (): Promise<void> => {
    if (deleteFileConfirm == null) return;
    const doomedPath = deleteFileConfirm.path;
    setDeleteFileInFlight(true);
    setDeleteFileError(null);
    try {
      console.debug("[RunbookEditorModal] delete-file", { path: doomedPath });
      await deleteRunbookFile(hostId, roleName, runbookName, doomedPath);
      // Refetch file list.
      const entries = await enumerateRunbookFiles(hostId, roleName, runbookName);
      setFiles({ status: "ready", data: entries });
      // Tab selection: if the deleted was active, pick first remaining file, else none.
      // (Same "first-tab default matches skill-load" heuristic as SkillsEditorModal L327.)
      if (activeTab === doomedPath) {
        setActiveTab(entries.length > 0 ? entries[0].path : null);
      }
      // Drop the tab data for the deleted file (frees the closure).
      setTabData((prev) => {
        const next = new Map(prev);
        next.delete(doomedPath);
        return next;
      });
      setDeleteFileConfirm(null);
    } catch (err) {
      // Dialog stays open; error surfaces below the body.
      setDeleteFileError(
        err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete",
      );
    } finally {
      setDeleteFileInFlight(false);
    }
  }, [hostId, roleName, runbookName, deleteFileConfirm, activeTab]);

  // Delete-runbook confirm handler. On success, close the modal (onOpenChange(false))
  // per D-06 swap-not-stack — no runbook-picker in the header so there's nothing to
  // fall back to. The parent (Wave 6 PrettyView) receives the close signal and does NOT
  // attempt to re-open the identity modal. NOTE: SkillsEditorModal doesn't call
  // onOpenChange(false) on delete-skill because it stays open to pick another skill;
  // the runbook modal DOES close since it opens on a specific runbook.
  const handleDeleteRunbook = useCallback(async (): Promise<void> => {
    setDeleteRunbookInFlight(true);
    setDeleteRunbookError(null);
    try {
      console.debug("[RunbookEditorModal] delete-runbook", { runbookName });
      await deleteRunbook(hostId, roleName, runbookName);
      // No runbook-picker per D-02; modal closes on successful delete.
      // Ordering matters: clear in-flight BEFORE the onOpenChange(false) that unmounts
      // this component (PrettyView gates <RunbookEditorModal> render on runbookEditorOpenState).
      // A finally{} that sets state after unmount is silently swallowed by React 18 but is
      // still a subtle correctness bug — an early return sidesteps the unmount race entirely.
      setDeleteRunbookConfirm(false);
      setDeleteRunbookInFlight(false);
      onOpenChange(false);
      return;
    } catch (err) {
      setDeleteRunbookError(
        err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete",
      );
    }
    setDeleteRunbookInFlight(false);
  }, [hostId, roleName, runbookName, onOpenChange]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal container={container ?? undefined}>
        {/* Overlay — same z-index ladder as SkillsEditorModal (patch #111) */}
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/15",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // Patch #111f pattern: prevent modal from closing when clicking
            // outside (e.g. into the composer). X and Esc remain valid close paths.
            e.preventDefault();
          }}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background: "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
        >
          {/* Header — adapted from SkillsEditorModal L403-514. No host picker, no runbook
              picker (both inherited/resolved upstream per D-02). DialogTitle shows runbook
              name so user knows which runbook they're editing. */}
          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-2 flex-wrap"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <DialogTitle className="text-[15px] font-semibold text-[#f0ebe0]">
              Edit runbook: {runbookName}
            </DialogTitle>

            {/* + Add file — mirrors SkillsEditorModal L462-469. Disabled gate is now
                `files.status !== "ready"` (drop the `!selectedSkillName` half — always
                true because the modal opens on a specific runbook per D-02). */}
            <button
              type="button"
              onClick={() => { void handleAddFile(); }}
              disabled={files.status !== "ready"}
              className="ml-2 px-3 py-1.5 rounded-md bg-[hsla(220,80%,60%,0.20)] hover:bg-[hsla(220,80%,60%,0.30)] text-[#e8e4d8] text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add file
            </button>

            {/* Delete-runbook Trash2 — mirrors SkillsEditorModal L473-485. Always rendered
                (no `selectedSkillName &&` guard — the modal opens on a resolved runbook per D-02).
                Copy per D-05: "Delete this runbook". */}
            <button
              type="button"
              title="Delete this runbook"
              onClick={() => {
                setDeleteRunbookError(null);
                setDeleteRunbookConfirm(true);
              }}
              className="size-6 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
            >
              <Trash2 size={16} />
            </button>

            <div className="flex-1" />

            {/* Glass X close button — verbatim from SkillsEditorModal L489-513 */}
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                  e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.22)";
                  e.currentTarget.style.boxShadow = "0 0 20px hsla(220, 60%, 50%, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.10)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </DialogHeader>

          {/* Body — layered branches per D-01 / SkillsEditorModal L516-556 pattern.
              Simplified vs. SkillsEditorModal: drops host-not-picked / skills-loading /
              skills-error / skills-empty / skill-not-picked branches (all handled by the
              caller — modal only opens when host + role + runbook are ALL resolved).
              Retains: files-loading / files-error / no-files / files+tabs. */}
          {files.status === "loading" ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
              Loading files…
            </div>
          ) : files.status === "error" ? (
            <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-6 text-center">
              Couldn&apos;t load files: {files.error}
            </div>
          ) : files.data.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[#a89a80] gap-2 text-sm text-center px-6">
              <div>This runbook has no files.</div>
              <div className="text-xs opacity-70">
                Use &quot;+ Add file&quot; to create one.
              </div>
            </div>
          ) : (
            // Tabs — one TabsContent per file. Per-tab lazy load; horizontal-scroll tab strip.
            // Mirrors SkillsEditorModal L558-634.
            <Tabs
              value={activeTab ?? ""}
              onValueChange={setActiveTab}
              className="flex-1 min-h-0 flex flex-col"
            >
              {files.data.map((file) => (
                <TabsContent
                  key={file.path}
                  value={file.path}
                  className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
                >
                  <SkillFileTab
                    state={tabData.get(file.path) ?? { status: "loading" }}
                    onSave={(content, expectedMtime) =>
                      handleSave(file.path, content, expectedMtime)
                    }
                    onRequestDelete={() => {
                      setDeleteFileError(null);
                      setDeleteFileConfirm({ path: file.path });
                    }}
                  />
                </TabsContent>
              ))}

              {/* Bottom horizontal-scroll tab strip — mirrors SkillsEditorModal L583-633
                  with Phase 89 D-03: overflow-x-auto + iOS scroll momentum + intrinsic-width
                  tabs. Tab labels are FULL relative paths per D-03 (verbatim file.path, no
                  basename extraction — SkillsEditorModal L625-626 enforces same convention). */}
              <div
                className="shrink-0 flex items-stretch px-2 py-1 border-t overflow-x-auto"
                style={{
                  borderTopColor: "rgba(220, 225, 245, 0.10)",
                  background:
                    "linear-gradient(180deg, rgba(18,20,28,0.62), rgba(28,30,40,0.55))",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  WebkitOverflowScrolling: "touch",
                }}
              >
                {files.data.map((file) => {
                  const selected = activeTab === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setActiveTab(file.path)}
                      className={cn(
                        // Intrinsic width — no flex-1 — so many tabs trigger
                        // horizontal scroll instead of squishing (D-06 fallback).
                        "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors shrink-0",
                        selected
                          ? "text-[#f0ebe0] font-semibold"
                          : "text-[#a89a80] hover:text-[#e8e4d8]",
                      )}
                      // Hue-tinted glassy pill matches SkillsEditorModal (hardcoded
                      // hue 220 — no per-identity context in this top-level modal per D-06).
                      style={
                        selected
                          ? {
                              background: "hsla(220, 80%, 60%, 0.18)",
                              boxShadow:
                                "inset 0 0 0 1px hsla(220, 80%, 70%, 0.28)",
                            }
                          : undefined
                      }
                    >
                      <FileText size={18} />
                      {/* D-03: tab label is the FULL path relative to runbook root
                          (e.g. `avatar-prompts/amelia.md`) — verbatim file.path, not
                          a basename extract. Nested folder support falls out for free. */}
                      <span className="text-center whitespace-nowrap">
                        {file.path}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Tabs>
          )}
        </DialogPrimitive.Content>

        {/* Delete-file confirmation (modal-in-modal) — mirrors SkillsEditorModal L638-663.
            Heading "Delete file?". Body shows runbook/path code block + "This can't be undone."
            Both mounts inside the same Portal so the overlay's `inset-4` is anchored to the
            same container box as the parent modal (per DeleteConfirmDialog L17). */}
        <DeleteConfirmDialog
          open={deleteFileConfirm !== null}
          onOpenChange={(o) => {
            if (!o) {
              setDeleteFileConfirm(null);
              setDeleteFileError(null);
            }
          }}
          heading="Delete file?"
          body={
            <>
              <div>
                <code className="px-1 rounded bg-black/30 font-mono">
                  {runbookName}/{deleteFileConfirm?.path ?? ""}
                </code>
              </div>
              <div className="mt-2">This can&apos;t be undone.</div>
            </>
          }
          primaryLabel="Delete"
          onConfirm={() => { void handleDeleteFile(); }}
          inFlight={deleteFileInFlight}
          error={deleteFileError}
          container={container ?? undefined}
        />

        {/* Delete-runbook confirmation (modal-in-modal) — mirrors SkillsEditorModal L665-692.
            Heading "Delete runbook?". Body shows runbook code block + D-05 exact blast-radius
            copy (same framing as delete-skill: folder + every file inside). */}
        <DeleteConfirmDialog
          open={deleteRunbookConfirm}
          onOpenChange={(o) => {
            if (!o) {
              setDeleteRunbookConfirm(false);
              setDeleteRunbookError(null);
            }
          }}
          heading="Delete runbook?"
          body={
            <>
              <div>
                <code className="px-1 rounded bg-black/30 font-mono">
                  {runbookName}
                </code>
              </div>
              <div className="mt-2">
                This removes the runbook folder and every file inside it. This can&apos;t be undone.
              </div>
            </>
          }
          primaryLabel="Delete runbook"
          onConfirm={() => { void handleDeleteRunbook(); }}
          inFlight={deleteRunbookInFlight}
          error={deleteRunbookError}
          container={container ?? undefined}
        />
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
