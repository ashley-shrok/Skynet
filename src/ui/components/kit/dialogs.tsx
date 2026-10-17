import * as React from "react";
import { createRoot } from "react-dom/client";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Modal } from "@/components/modal";
import { KitButton } from "./buttons";
import { KitField, KitInput } from "./fields";

// Skynet's own confirm / "name it" / notice dialogs — the replacement for the
// browser's window.confirm / prompt / alert. Promise-based so a handler that
// used to read `if (!window.confirm(...)) return;` becomes
// `if (!(await kitConfirm({...}))) return;`.
//
// The host renders itself on first use into its own root on document.body,
// so nothing has to be wired into the app tree and tests get it for free.
// Each dialog is a size="sm" Modal: a centred card on desktop, a bottom
// sheet on a phone.

export interface KitConfirmOptions {
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red main button — for deletes and other can't-undo actions. */
  destructive?: boolean;
}

export interface KitPromptOptions {
  title: React.ReactNode;
  body?: React.ReactNode;
  /** Label above the field (visually hidden when omitted; aria uses title). */
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  mono?: boolean;
  /** Return a message to block submit and show it under the field. */
  validate?: (value: string) => string | null | undefined;
}

export interface KitAlertOptions {
  title: React.ReactNode;
  body?: React.ReactNode;
  okLabel?: string;
}

type Request =
  | { kind: "confirm"; id: number; opts: KitConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; id: number; opts: KitPromptOptions; resolve: (v: string | null) => void }
  | { kind: "alert"; id: number; opts: KitAlertOptions; resolve: () => void };

let queue: Request[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let mounted = false;

function emit(): void {
  for (const l of listeners) l();
}

function ensureHost(): void {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  const el = document.createElement("div");
  el.setAttribute("data-kit-dialog-host", "");
  document.body.appendChild(el);
  createRoot(el).render(<KitDialogHost />);
}

/** Test-only auto-answer: when set, dialogs resolve immediately without
 *  rendering, and each request is recorded. See autoAnswerKitDialogs. */
interface AutoAnswer {
  confirm?: boolean | ((o: KitConfirmOptions) => boolean);
  prompt?: string | null | ((o: KitPromptOptions) => string | null);
  calls: Array<{ kind: Request["kind"]; opts: KitConfirmOptions | KitPromptOptions | KitAlertOptions }>;
}
let autoAnswer: AutoAnswer | null = null;

function push(req: Request): void {
  if (autoAnswer) {
    autoAnswer.calls.push({ kind: req.kind, opts: req.opts });
    if (req.kind === "confirm") {
      const a = autoAnswer.confirm ?? true;
      req.resolve(typeof a === "function" ? a(req.opts) : a);
    } else if (req.kind === "prompt") {
      const a = autoAnswer.prompt ?? null;
      req.resolve(typeof a === "function" ? a(req.opts) : a);
    } else req.resolve();
    return;
  }
  ensureHost();
  queue = [...queue, req];
  emit();
}

function settle(id: number): void {
  queue = queue.filter((r) => r.id !== id);
  emit();
}

/** Ask a yes/no question. Resolves true on confirm, false on cancel/dismiss. */
export function kitConfirm(opts: KitConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => push({ kind: "confirm", id: nextId++, opts, resolve }));
}

/** Ask for a line of text. Resolves the trimmed-as-typed value, or null on cancel. */
export function kitPrompt(opts: KitPromptOptions): Promise<string | null> {
  return new Promise((resolve) => push({ kind: "prompt", id: nextId++, opts, resolve }));
}

/** Tell the user something. Resolves when dismissed. */
export function kitAlert(opts: KitAlertOptions): Promise<void> {
  return new Promise((resolve) => push({ kind: "alert", id: nextId++, opts, resolve }));
}

function useQueue(): Request[] {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => queue,
    () => queue,
  );
}

function KitDialogHost(): JSX.Element | null {
  const q = useQueue();
  const top = q[0];
  if (!top) return null;
  return <DialogView key={top.id} req={top} />;
}

function DialogView({ req }: { req: Request }): JSX.Element {
  const [value, setValue] = React.useState(
    req.kind === "prompt" ? req.opts.defaultValue ?? "" : "",
  );
  const [error, setError] = React.useState<string | null>(null);
  const done = React.useRef(false);

  const finish = (result: "ok" | "cancel") => {
    if (done.current) return;
    done.current = true;
    if (req.kind === "confirm") req.resolve(result === "ok");
    else if (req.kind === "prompt") req.resolve(result === "ok" ? value : null);
    else req.resolve();
    settle(req.id);
  };

  const submit = () => {
    if (req.kind === "prompt") {
      const msg = req.opts.validate?.(value);
      if (msg) {
        setError(msg);
        return;
      }
    }
    finish("ok");
  };

  const { title, body } = req.opts;
  const okLabel =
    req.kind === "alert"
      ? req.opts.okLabel ?? "OK"
      : req.opts.confirmLabel ?? (req.kind === "prompt" ? "OK" : "Confirm");
  const cancelLabel = req.kind === "alert" ? null : req.opts.cancelLabel ?? "Cancel";
  const destructive = req.kind === "confirm" && req.opts.destructive;

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) finish("cancel");
      }}
      size="sm"
      data-testid={`kit-${req.kind}-dialog`}
    >
      <form
        className="k-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <DialogPrimitive.Title className="k-dialog-title">{title}</DialogPrimitive.Title>
        {body ? (
          <DialogPrimitive.Description className="k-dialog-text">{body}</DialogPrimitive.Description>
        ) : (
          // Radix wants a description; an empty one keeps screen readers
          // from hearing the title twice.
          <DialogPrimitive.Description className="sr-only" />
        )}
        {req.kind === "prompt" ? (
          <KitField
            className="k-dialog-field"
            label={req.opts.label}
            error={error}
          >
            <KitInput
              autoFocus
              value={value}
              mono={req.opts.mono}
              placeholder={req.opts.placeholder}
              aria-label={req.opts.label ? undefined : typeof title === "string" ? title : "Value"}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              data-testid="kit-prompt-input"
            />
          </KitField>
        ) : null}
        <div className="k-dialog-acts">
          {cancelLabel ? (
            <KitButton onClick={() => finish("cancel")} data-testid="kit-dialog-cancel">
              {cancelLabel}
            </KitButton>
          ) : null}
          <KitButton
            type="submit"
            variant={destructive ? "danger" : "primary"}
            autoFocus={req.kind !== "prompt"}
            data-testid="kit-dialog-confirm"
          >
            {okLabel}
          </KitButton>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Test-only: answer every kit dialog immediately (no rendering) and record
 * the requests — the replacement for `vi.spyOn(window, "confirm")`.
 *   const dialogs = autoAnswerKitDialogs({ confirm: true });
 *   …; expect(dialogs.calls[0].opts.title).toMatch(/Archive/);
 * Cleared by __resetKitDialogsForTests().
 */
export function autoAnswerKitDialogs(answers: Omit<AutoAnswer, "calls"> = {}): AutoAnswer {
  autoAnswer = { ...answers, calls: [] };
  return autoAnswer;
}

/** Test-only: drop any open dialogs (resolving them as cancelled) and any auto-answer. */
export function __resetKitDialogsForTests(): void {
  autoAnswer = null;
  for (const r of queue) {
    if (r.kind === "confirm") r.resolve(false);
    else if (r.kind === "prompt") r.resolve(null);
    else r.resolve();
  }
  queue = [];
  emit();
}
