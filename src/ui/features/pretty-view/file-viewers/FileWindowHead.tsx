import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";
import { ModalHead } from "@/components/modal";
import { KitButton, kitConfirm } from "@/components/kit";
import { RowKebabMenu, type RowKebabMenuItem } from "@/features/pretty-conversations/RowKebabMenu";
import { FileViewModeSwitcher } from "./FileView";
import { FileSpeakControlButton, fileSpeakMenuLabel, useFileSpeakControl } from "./FileSpeakButton";
import { useIsMobile } from "@/hooks/use-mobile";
import { fileOpenKind, resolveFileViewer, type FileOpenKind } from "./registry";
import { MarkdownModeSwitch, type MarkdownSwitchHost } from "../markdown-mode-switch";

/**
 * The file window's head, shared by every window a file opens in (a file
 * shared in a chat, a file in an agent's / role's / project's Files tab).
 *
 *   [type tile] name                [read aloud] [view switch] [Edit|Save] [⋯] [×]
 *               machine · folder
 *
 * How a file opens follows its type (see fileOpenKind): things you look at
 * get no Edit at all; documents open for reading with Edit; things you work
 * on open ready to type with Save. Less-used actions (Download, Copy path)
 * live in the ⋯ menu.
 *
 * Phone: the top row keeps the name, ⋯ and close; the view switch and the
 * main buttons share a row under it, and read aloud moves into ⋯.
 */

/** Markdown gets the Formatted / Plain text switch; other types their views. */
export function FileViewSwitch({
  filename,
  mode,
  onModeChange,
  formattedUnavailable,
}: {
  filename: string;
  mode: string | null;
  onModeChange: (mode: string) => void;
  formattedUnavailable: boolean;
}): JSX.Element | null {
  if (/\.md$/i.test(filename)) return <MarkdownModeSwitch formattedUnavailable={formattedUnavailable} />;
  return <FileViewModeSwitcher filename={filename} mode={mode} onModeChange={onModeChange} />;
}

/**
 * The markdown switch's host state: put the returned `host` in
 * MarkdownSwitchHostContext around the viewer, and pass `formattedUnavailable`
 * to FileViewSwitch.
 */
export function useMarkdownSwitchHost(): { host: MarkdownSwitchHost; formattedUnavailable: boolean } {
  const [formattedUnavailable, setFormattedUnavailable] = useState(false);
  const valueRef = useRef(false);
  const hostRef = useRef<MarkdownSwitchHost>({
    onFormattedUnavailable: (unavailable) => {
      valueRef.current = unavailable;
      setFormattedUnavailable(unavailable);
    },
    // An editor rebuilt for Edit / Cancel starts from this, so it doesn't
    // retry the formatted view on a file already known not to fit.
    formattedUnavailable: () => valueRef.current,
  });
  return { host: hostRef.current, formattedUnavailable };
}

/**
 * Keeps a scrolling area's position when its content is rebuilt (switching
 * between reading and editing remounts the viewer). Attach the ref to the
 * area that scrolls; `trigger` changes on each rebuild.
 */
export function useKeepScroll(trigger: unknown): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = (): void => {
      last.current = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    const top = last.current;
    if (!el || top === 0) return;
    // The rebuilt viewer loads in steps; put the position back once there's
    // room for it, then stop.
    let done = false;
    const timers = [0, 120, 400, 900].map((ms) =>
      setTimeout(() => {
        if (done || el.scrollHeight - el.clientHeight < top) return;
        el.scrollTop = top;
        done = true;
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [trigger]);
  return ref;
}

/**
 * Reading vs editing for one open file. A "read" file opens locked; Edit
 * unlocks it and Cancel locks it again (asking first when there are unsaved
 * changes). "view" and "work" files are never locked by this — whether they
 * can be changed at all is up to the view.
 */
export function useFileEditing({
  filename,
  dirty,
}: {
  filename: string;
  dirty: boolean;
}): {
  kind: FileOpenKind;
  editing: boolean;
  /** Pass to the viewer: true while a "read" file is being read. */
  locked: boolean;
  /** Bumped on Cancel — key the viewer on it so the draft starts over. */
  draftKey: number;
  startEditing: () => void;
  /** False when the user chose to keep editing. */
  cancelEditing: () => Promise<boolean>;
  /** After a successful save, a "read" file goes back to reading. */
  doneEditing: () => void;
} {
  const kind = fileOpenKind(filename);
  // Per file: a different file starts in its own type's state at once,
  // never with the previous file's for a render.
  const [state, setState] = useState({ filename, editing: kind !== "read" });
  if (state.filename !== filename) setState({ filename, editing: kind !== "read" });
  const editing = state.filename === filename ? state.editing : kind !== "read";
  const setEditing = useCallback((next: boolean) => setState({ filename, editing: next }), [filename]);
  const [draftKey, setDraftKey] = useState(0);

  const confirmingRef = useRef(false);
  const cancelEditing = useCallback(async (): Promise<boolean> => {
    if (dirty) {
      if (confirmingRef.current) return false;
      confirmingRef.current = true;
      try {
        const ok = await kitConfirm({
          title: "Discard your changes?",
          body: `Your edits to ${filename} haven't been saved.`,
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
          destructive: true,
        });
        if (!ok) return false;
      } finally {
        confirmingRef.current = false;
      }
    }
    setEditing(false);
    setDraftKey((k) => k + 1);
    return true;
  }, [dirty, filename, setEditing]);

  return {
    kind,
    editing,
    locked: kind === "read" && !editing,
    draftKey,
    startEditing: useCallback(() => setEditing(true), [setEditing]),
    cancelEditing,
    doneEditing: useCallback(() => {
      if (kind === "read") setEditing(false);
    }, [kind, setEditing]),
  };
}

/** Edit, or Cancel + Save, or just Save — per how the file opened. */
export function FileWindowActions({
  kind,
  editing,
  editable,
  dirty,
  saving,
  onEdit,
  onCancel,
  onSave,
}: {
  kind: FileOpenKind;
  editing: boolean;
  /** The file can be changed here (writable, and the view edits). */
  editable: boolean;
  dirty: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element | null {
  if (!editable) return null;
  if (kind === "read" && !editing) {
    return (
      <KitButton size="sm" onClick={onEdit} data-testid="file-window-edit">
        Edit
      </KitButton>
    );
  }
  return (
    <>
      {kind === "read" ? (
        <KitButton size="sm" variant="plain" onClick={onCancel} disabled={saving} data-testid="file-window-cancel">
          Cancel
        </KitButton>
      ) : null}
      <KitButton
        size="sm"
        variant="primary"
        onClick={onSave}
        disabled={!dirty}
        busy={saving}
        data-testid="file-window-save"
      >
        {saving ? "Saving…" : "Save"}
      </KitButton>
    </>
  );
}

export function FileWindowHead({
  filename,
  switcher,
  speakText,
  actions,
  menuItems,
  closeTestId,
}: {
  filename: string;
  /** The view switch (FileViewSwitch). */
  switcher?: ReactNode;
  /** The text to read aloud, for prose files; null = no read-aloud button. */
  speakText: string | null;
  actions?: ReactNode;
  menuItems: RowKebabMenuItem[];
  closeTestId?: string;
}): JSX.Element {
  const entry = resolveFileViewer(filename);
  const Icon = entry.icon;
  const hasSwitch = !!switcher && (/\.md$/i.test(filename) || entry.modes.length > 1);
  const isMobile = useIsMobile();
  // One player for both places read aloud can show.
  const speak = useFileSpeakControl(filename, speakText);
  const items =
    isMobile && speak.available
      ? [{ label: fileSpeakMenuLabel(speak), onClick: () => speak.onSpeakClick(), testId: "file-window-speak-item" }, ...menuItems]
      : menuItems;
  const head = (
    <ModalHead
      title={<span className="block truncate text-[17px]">{filename}</span>}
      closeTestId={closeTestId}
      className="items-center"
      leading={
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-[10px] bg-[var(--k-s2)] text-[var(--k-t2)]"
          data-testid="file-window-icon"
        >
          <Icon width={18} height={18} />
        </span>
      }
      actions={
        <div className="flex items-center gap-1.5">
          {!isMobile && speak.available ? <FileSpeakControlButton control={speak} /> : null}
          {isMobile || !hasSwitch ? null : switcher}
          {isMobile ? null : actions}
          {items.length > 0 ? (
            <RowKebabMenu items={items} ariaLabel="File options" testId="file-window-menu" />
          ) : null}
        </div>
      }
    />
  );
  if (!isMobile) return head;
  // Phone: the name keeps the top row (with ⋯ and close); the view switch
  // and the main buttons share a row under it, so Cancel + Save never
  // squeeze the name out. On the narrowest screens the buttons wrap under
  // the switch rather than cut it off.
  const hasActions = actions !== null && actions !== undefined && actions !== false;
  return (
    <>
      {head}
      {hasSwitch || hasActions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-5 pb-2.5" data-testid="file-window-switch-row">
          {hasSwitch ? <div className="min-w-0">{switcher}</div> : null}
          {/* Wraps under the switch only when both can't share the row. */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
        </div>
      ) : null}
    </>
  );
}

/** Menu items every file window offers. */
export function fileMenuItems({
  downloadUrl,
  filename,
  path,
}: {
  downloadUrl: string | null;
  filename: string;
  /** Full path on its machine, when known. */
  path?: string | null;
}): RowKebabMenuItem[] {
  const items: RowKebabMenuItem[] = [];
  if (downloadUrl) {
    items.push({
      label: "Download",
      testId: "file-window-download",
      onClick: () => {
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = filename;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
      },
    });
  }
  if (path) {
    items.push({
      label: "Copy path",
      testId: "file-window-copy-path",
      onClick: () => {
        if (!navigator.clipboard) {
          toast.error("Couldn't copy the path");
          return;
        }
        navigator.clipboard.writeText(path).then(
          () => toast.success("Path copied"),
          (err: unknown) => {
            console.warn(`[file-window] copy path failed: ${(err as Error)?.message}`);
            toast.error("Couldn't copy the path");
          },
        );
      },
    });
  }
  return items;
}
