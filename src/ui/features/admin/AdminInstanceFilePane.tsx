/**
 * Admin → Instance file: the CLAUDE.md every host gets at
 * /etc/claude-code/CLAUDE.md, so it loads into every agent session across the
 * instance. Shown formatted for reading; Edit opens the editor with Cancel /
 * Save. Saving pushes it to every host right away; new sessions pick it
 * up, running ones don't. Saving it empty removes the file everywhere.
 *
 * Leaving the editor with unsaved edits asks first — Cancel, Esc, another
 * section, the X (through the window's leave guard).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Pencil } from "lucide-react";
import { ModalBody, ModalFoot, escBelongsElsewhere } from "@/components/modal";
import { getInstanceFile, saveInstanceFile } from "@/api/instance-file-api";
import { MarkdownEditor } from "@/features/pretty-view/MarkdownEditor";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitLoading,
  kitConfirm,
} from "@/components/kit";
import { adminErrorMessage } from "./admin-ui";
import type { AdminLeaveGuard } from "./AdminModal";

const PROSE = [
  "prose prose-sm max-w-none dark:prose-invert",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-code:rounded prose-code:px-1 prose-code:py-0.5",
  "prose-code:bg-white/[0.08] prose-code:border prose-code:border-white/[0.06]",
].join(" ");

export function AdminInstanceFilePane({
  hero,
  registerLeaveGuard,
  onEditingChange,
}: {
  /** The section's header, shown above the file while reading. */
  hero: React.ReactNode;
  registerLeaveGuard: (guard: AdminLeaveGuard | null) => void;
  /** The window grows to its editor size while the file is being edited. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getInstanceFile()
      .then((f) => {
        if (!cancelled) setSaved(f.content);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(
            adminErrorMessage(err, "Couldn't load the instance file."),
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The rich editor can re-serialise the file once more after it loads.
  // Until the user types, clicks or pastes in it, a change is the editor
  // settling, not an edit: it becomes the baseline instead of marking dirty.
  const [baseline, setBaseline] = useState("");
  const interacted = useRef(false);
  const onEditorChange = useCallback((md: string) => {
    if (!interacted.current) setBaseline(md);
    setDraft(md);
  }, []);
  const dirty = editing && draft !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = useRef(saving);
  savingRef.current = saving;

  const startEditing = () => {
    setDraft(saved ?? "");
    setBaseline(saved ?? "");
    interacted.current = false;
    setSaveError(null);
    setJustSaved(false);
    setEditing(true);
  };

  /** Stop editing, asking first when there are unsaved edits. */
  const leaveEditing = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    if (dirtyRef.current) {
      const ok = await kitConfirm({
        title: "Discard your changes?",
        body: "Your edits to the instance file haven't been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (!ok) return false;
    }
    dirtyRef.current = false;
    setEditing(false);
    setSaveError(null);
    return true;
  }, []);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);

  useEffect(() => {
    registerLeaveGuard(leaveEditing);
    return () => registerLeaveGuard(null);
  }, [registerLeaveGuard, leaveEditing]);

  // Esc while editing leaves the editor (asking first); while reading it
  // falls through to the window, which closes.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented || !editingRef.current)
        return;
      if (escBelongsElsewhere(e)) return;
      e.preventDefault();
      e.stopPropagation();
      void leaveEditing();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leaveEditing]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const f = await saveInstanceFile(draft);
      setSaved(f.content);
      dirtyRef.current = false;
      setEditing(false);
      setJustSaved(true);
      console.info({
        operation: "instance_file_saved",
        bytes: f.content.length,
      });
    } catch (err) {
      setSaveError(adminErrorMessage(err, "Save failed — please try again."));
    } finally {
      setSaving(false);
    }
  };

  const written = (saved ?? "").trim().length > 0;

  return (
    <>
      <ModalBody
        data-testid="admin-instance-file-pane"
        className="pt-1 pb-7 flex flex-col"
      >
        <div
          className={
            editing
              ? "flex flex-col flex-1 min-h-0"
              : "max-w-[600px] w-full mx-auto"
          }
        >
          {!editing && hero}
          {loadError ? (
            <KitBanner tone="danger">{loadError}</KitBanner>
          ) : saved === null ? (
            <KitLoading label="Loading…" />
          ) : editing ? (
            <>
              <p className="m-0 mb-2 text-[13px] text-[var(--k-t2)] shrink-0">
                Saving sends it to every host right away; agents pick it up the
                next time they start. Save it empty to remove it everywhere.
              </p>
              <div
                className="flex flex-col flex-1 min-h-0"
                onKeyDownCapture={() => (interacted.current = true)}
                onPointerDownCapture={() => (interacted.current = true)}
                onPasteCapture={() => (interacted.current = true)}
                onDropCapture={() => (interacted.current = true)}
                onBeforeInputCapture={() => (interacted.current = true)}
              >
                <MarkdownEditor
                  filename="CLAUDE.md"
                  content={draft}
                  onChange={onEditorChange}
                  disabled={saving}
                />
              </div>
              {saveError && (
                <KitBanner
                  tone="danger"
                  className="mt-2"
                  data-testid="admin-instance-file-error"
                >
                  {saveError}
                </KitBanner>
              )}
            </>
          ) : !written ? (
            <>
              {justSaved && (
                <KitBanner
                  tone="ok"
                  className="mb-4"
                  data-testid="admin-instance-file-saved"
                >
                  Saved — removing it from every host.
                </KitBanner>
              )}
              <KitEmpty
                className="py-10"
                icon={<FileText aria-hidden="true" />}
                title="Nothing written yet"
                body="Anything written here goes into every agent session on every host."
                action={
                  <KitButton
                    variant="primary"
                    size="sm"
                    onClick={startEditing}
                    data-testid="admin-instance-file-write"
                  >
                    <Pencil /> Write it
                  </KitButton>
                }
                data-testid="admin-instance-file-empty"
              />
            </>
          ) : (
            <>
              {justSaved && (
                <KitBanner
                  tone="ok"
                  className="mb-4"
                  data-testid="admin-instance-file-saved"
                >
                  Saved — sending it to every host.
                </KitBanner>
              )}
              <div className="k-group px-4 py-3.5">
                <div className={PROSE} data-testid="admin-instance-file-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {saved}
                  </ReactMarkdown>
                </div>
              </div>
            </>
          )}
        </div>
      </ModalBody>
      {saved !== null && !loadError && (editing || written) && (
        <ModalFoot>
          {editing ? (
            <>
              <KitButton
                disabled={saving}
                onClick={() => void leaveEditing()}
                data-testid="admin-instance-file-cancel"
              >
                Cancel
              </KitButton>
              <KitButton
                variant="primary"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                busy={saving}
                data-testid="admin-instance-file-save"
              >
                {saving ? "Saving…" : "Save"}
              </KitButton>
            </>
          ) : (
            <KitButton
              onClick={startEditing}
              data-testid="admin-instance-file-edit"
            >
              <Pencil /> Edit
            </KitButton>
          )}
        </ModalFoot>
      )}
    </>
  );
}
