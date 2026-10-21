/**
 * Preferences → About you: the file every agent on a machine reads first
 * (the user's ~/.claude/CLAUDE.md, plus any other global files the server
 * lists for that machine).
 *
 *   - Machine row only when more than one machine can run agents; it's set to
 *     the machine the window was opened for, else the first — never empty.
 *   - Several files on a machine: a switcher between them.
 *   - The file reads formatted; Edit opens the editor, Cancel / Save close it.
 *     An empty file shows "Nothing written yet" with Write it.
 *   - Unsaved writing asks "Discard your changes?" before any way out —
 *     Cancel, Esc, switching machine or file, and (through the leave guard it
 *     registers with the window) switching section or closing.
 *   - Saves are mtime-checked: a file changed on disk since editing began
 *     asks to reload, or keeps the draft with an inline note.
 *
 * Lays out its own body and foot (the editor fills the height).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Pencil, Sparkles } from "lucide-react";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listGlobalFiles,
  readGlobalFile,
  writeGlobalFile,
  GlobalFileMtimeConflictError,
  type GlobalFileEntry,
} from "@/api/global-files-api";
import { ModalBody, ModalFoot, escBelongsElsewhere } from "@/components/modal";
import type { TabState } from "./IdentityFileTab";
import type { FileViewData } from "./file-viewers/FileView";
import { MarkdownEditor } from "./MarkdownEditor";
import type { LeaveGuard } from "./PreferencesModal";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitLoading,
  KitSectionHero,
  KitSegmented,
  KitSelect,
  KitSettingsGroup,
  KitSettingsRow,
  kitConfirm,
} from "@/components/kit";

// The path the backend always lists for a machine; its tab reads "About you".
const IMPLICIT_ABOUT_YOU_PATH = "~/.claude/CLAUDE.md";

const PROSE = [
  "prose prose-sm max-w-none dark:prose-invert",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
  "prose-code:bg-white/[0.08] prose-code:border prose-code:border-white/[0.06]",
].join(" ");

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

function fileLabel(file: GlobalFileEntry, isFirst: boolean): string {
  if (isFirst && file.path === IMPLICIT_ABOUT_YOU_PATH) return "About you";
  return file.label ?? file.path.split("/").pop() ?? file.path;
}

export interface PreferencesAboutYouPaneProps {
  hostTree: HostFolder | null;
  /** The machine the window was opened for, if any. */
  defaultHostId: number | null;
  /** Tells the window to ask before leaving while there's unsaved writing. */
  registerLeaveGuard?: (guard: LeaveGuard | null) => void;
}

export function PreferencesAboutYouPane({
  hostTree,
  defaultHostId,
  registerLeaveGuard,
}: PreferencesAboutYouPaneProps): JSX.Element {
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [files, setFiles] = useState<TabState<GlobalFileEntry[]>>({ status: "loading" });
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileData, setFileData] = useState<Map<string, TabState<FileViewData>>>(new Map());

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // What the editor shows before the user touches it — the rich editor
  // re-serialises the file on load, so that (not the raw file) is "unchanged".
  const [baseline, setBaseline] = useState("");
  const interacted = useRef(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const agentHosts = useMemo(
    () =>
      collectAllHosts(hostTree?.children ?? []).filter((h) => h.runsFleetSubstrate === true),
    [hostTree],
  );

  // Always land on a machine: the one asked for, else the first.
  useEffect(() => {
    if (agentHosts.length === 0) {
      setSelectedHostId(null);
      return;
    }
    setSelectedHostId((cur) => {
      if (cur != null && agentHosts.some((h) => Number(h.id) === cur)) return cur;
      if (defaultHostId != null && agentHosts.some((h) => Number(h.id) === defaultHostId)) {
        return defaultHostId;
      }
      return Number(agentHosts[0].id);
    });
  }, [defaultHostId, agentHosts]);

  // Files for the machine.
  useEffect(() => {
    if (selectedHostId == null) return;
    let cancelled = false;
    // A machine change the user didn't ask for (the list refreshed) must not
    // carry the editor — and its draft — over to another machine's file.
    dirtyRef.current = false;
    setEditing(false);
    setSaveError(null);
    setFiles({ status: "loading" });
    setFileData(new Map());
    setActiveFile(null);
    listGlobalFiles(selectedHostId)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        if (entries.length > 0) setActiveFile(entries[0].path);
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

  // The open file's contents, loaded once per file.
  useEffect(() => {
    if (selectedHostId == null || !activeFile) return;
    if (fileData.has(activeFile)) return;
    let cancelled = false;
    setFileData((prev) => new Map(prev).set(activeFile, { status: "loading" }));
    readGlobalFile(selectedHostId, activeFile)
      .then((result) => {
        if (cancelled) return;
        setFileData((prev) =>
          new Map(prev).set(activeFile, {
            status: "ready",
            data: { content: result.content, mtime: result.mtime },
          }),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFileData((prev) =>
          new Map(prev).set(activeFile, {
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load",
          }),
        );
      });
    return () => {
      cancelled = true;
    };
    // `fileData` is read, not watched: re-running on its own loading write
    // would cancel the read in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHostId, activeFile]);

  const activeState = activeFile ? fileData.get(activeFile) : undefined;
  const content = activeState?.status === "ready" ? activeState.data.content : "";
  const dirty = editing && draft !== baseline;
  dirtyRef.current = dirty;

  const startEditing = useCallback(() => {
    setDraft(content);
    setBaseline(content);
    interacted.current = false;
    setSaveError(null);
    setEditing(true);
  }, [content]);

  const onEditorChange = useCallback((md: string) => {
    if (!interacted.current) setBaseline(md);
    setDraft(md);
  }, []);

  /** Stop editing, asking first when there's unsaved writing. */
  const leaveEditing = useCallback(async (): Promise<boolean> => {
    if (dirtyRef.current) {
      const confirmed = await kitConfirm({
        title: "Discard your changes?",
        body: "What you've written here hasn't been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (!confirmed) return false;
    }
    dirtyRef.current = false;
    setEditing(false);
    setSaveError(null);
    return true;
  }, []);

  // The window asks this before switching section or closing.
  const savingRef = useRef(saving);
  savingRef.current = saving;
  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard(async () => (savingRef.current ? false : leaveEditing()));
    return () => registerLeaveGuard(null);
  }, [registerLeaveGuard, leaveEditing]);

  // Esc while editing leaves the editor (asking first); while reading it
  // falls through to the window, which closes.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!editingRef.current || escBelongsElsewhere(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!savingRef.current) void leaveEditing();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leaveEditing]);

  const switchHost = useCallback(
    async (next: number) => {
      if (next === selectedHostId) return;
      if (!(await leaveEditing())) return;
      setSelectedHostId(next);
    },
    [selectedHostId, leaveEditing],
  );

  const switchFile = useCallback(
    async (next: string) => {
      if (next === activeFile) return;
      if (!(await leaveEditing())) return;
      setActiveFile(next);
    },
    [activeFile, leaveEditing],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || !activeFile || saving) return;
    const state = fileData.get(activeFile);
    if (state?.status !== "ready") return;

    setSaving(true);
    setSaveError(null);
    try {
      const result = await writeGlobalFile({
        hostId: selectedHostId,
        path: activeFile,
        content: draft,
        expectedMtime: state.data.mtime,
      });
      setFileData((prev) =>
        new Map(prev).set(activeFile, {
          status: "ready",
          data: { content: draft, mtime: result.mtime },
        }),
      );
      dirtyRef.current = false;
      setEditing(false);
      console.info({ operation: "about_you_saved", hostId: selectedHostId, path: activeFile });
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
          setFileData((prev) =>
            new Map(prev).set(activeFile, {
              status: "ready",
              data: { content: err.currentContent, mtime: err.currentMtime },
            }),
          );
          setDraft(err.currentContent);
          setBaseline(err.currentContent);
          interacted.current = false;
          return;
        }
        // Keep the draft, but take the newer file as what a save replaces, so
        // Save again really overwrites it (and Cancel shows the newer one).
        setFileData((prev) =>
          new Map(prev).set(activeFile, {
            status: "ready",
            data: { content: err.currentContent, mtime: err.currentMtime },
          }),
        );
        setSaveError(
          "Not saved — the file changed since you started editing. Save again to overwrite it, or Cancel to see the newer version.",
        );
        return;
      }
      setSaveError("Save failed — please try again.");
      console.warn({
        operation: "about_you_save_failed",
        hostId: selectedHostId,
        path: activeFile,
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }, [selectedHostId, activeFile, fileData, draft, saving]);

  // ── Render ────────────────────────────────────────────────────────────────
  const filesReady = files.status === "ready";
  const fileList = filesReady ? files.data : [];
  const written = content.trim() !== "";
  const ready = activeState?.status === "ready";

  const hero = (
    <KitSectionHero
      icon={<Sparkles />}
      title="About you"
      description="Every agent you start on this machine reads this first — how you work, what you like, anything."
      className="mb-5"
      data-testid="preferences-section-hero"
    />
  );

  const machineRow =
    agentHosts.length > 1 ? (
      <KitSettingsGroup className="mb-5" data-testid="preferences-about-you-host-picker">
        <KitSettingsRow
          label="Machine"
          description="Each machine keeps its own copy."
          control={
            <KitSelect
              aria-label="Machine"
              value={selectedHostId ?? ""}
              disabled={saving}
              onChange={(e) => void switchHost(Number(e.target.value))}
              className="w-[190px] max-sm:w-[150px]"
            >
              {agentHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </KitSelect>
          }
        />
      </KitSettingsGroup>
    ) : null;

  const fileSwitcher =
    fileList.length > 1 ? (
      <KitSegmented
        className="mb-4 self-start max-w-full overflow-x-auto"
        aria-label="Files"
        value={activeFile ?? ""}
        onValueChange={(next) => void switchFile(next)}
        options={fileList.map((file, index) => ({
          value: file.path,
          label: <span className="truncate">{fileLabel(file, index === 0)}</span>,
          Icon: FileText,
          testId: `preferences-about-you-tab-${file.path}`,
        }))}
      />
    ) : null;

  let main: React.ReactNode;
  if (agentHosts.length === 0) {
    main = (
      <KitEmpty
        className="py-10"
        title="No machines can run agents yet"
        body="Once one can, what you write here is what its agents read first."
      />
    );
  } else if (files.status === "loading" || selectedHostId == null) {
    main = <KitLoading />;
  } else if (files.status === "error") {
    main = <KitBanner tone="danger">{files.error}</KitBanner>;
  } else if (fileList.length === 0) {
    main = (
      <KitEmpty
        className="py-10"
        title="No global files configured for this host."
        body={
          <>
            Edit <code>/app/data/global-files.json</code> on the server to add entries.
          </>
        }
      />
    );
  } else if (!activeState || activeState.status === "loading") {
    main = <KitLoading />;
  } else if (activeState.status === "error") {
    main = <KitBanner tone="danger">{activeState.error}</KitBanner>;
  } else if (editing) {
    main = (
      <div
        className="flex flex-col flex-1 min-h-[320px]"
        onKeyDownCapture={() => (interacted.current = true)}
        onPointerDownCapture={() => (interacted.current = true)}
        onPasteCapture={() => (interacted.current = true)}
        onDropCapture={() => (interacted.current = true)}
        onBeforeInputCapture={() => (interacted.current = true)}
      >
        <MarkdownEditor
          filename={activeFile ?? "about-you.md"}
          content={draft}
          onChange={onEditorChange}
          disabled={saving}
        />
      </div>
    );
  } else if (!written) {
    main = (
      <KitEmpty
        className="py-10"
        icon={<FileText aria-hidden="true" />}
        title="Nothing written yet"
        body="Tell your agents how you work, what you like, and anything they should know before they start."
        action={
          <KitButton
            variant="primary"
            size="sm"
            onClick={startEditing}
            data-testid="preferences-about-you-write"
          >
            <Pencil /> Write it
          </KitButton>
        }
        data-testid="preferences-about-you-empty"
      />
    );
  } else {
    main = (
      <div
        className={`${PROSE} rounded-[14px] border border-[var(--k-hair)] bg-[var(--k-s1)] px-5 py-4`}
        data-testid="preferences-about-you-file"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  const showFoot = ready && (editing || written);

  return (
    <>
      <ModalBody
        data-testid="preferences-modal-pane"
        className="pt-1 pb-6 flex flex-col"
      >
        <div className="w-full max-w-[720px] mx-auto flex flex-col flex-1 min-h-0">
          {hero}
          {machineRow}
          {fileSwitcher}
          {main}
          {saveError !== null && (
            <p className="m-0 mt-2 k-err" role="alert" data-testid="preferences-about-you-save-error">
              {saveError}
            </p>
          )}
        </div>
      </ModalBody>
      {showFoot && (
        <ModalFoot>
          {editing ? (
            <>
              <KitButton
                disabled={saving}
                onClick={() => void leaveEditing()}
                data-testid="preferences-about-you-cancel"
              >
                Cancel
              </KitButton>
              <KitButton
                variant="primary"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                busy={saving}
                data-testid="preferences-about-you-save"
              >
                {saving ? "Saving…" : "Save"}
              </KitButton>
            </>
          ) : (
            <KitButton onClick={startEditing} data-testid="preferences-about-you-edit">
              <Pencil /> Edit
            </KitButton>
          )}
        </ModalFoot>
      )}
    </>
  );
}
