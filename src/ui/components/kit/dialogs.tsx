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
  /** Something to finish before the question can be answered. The dialog
   *  opens at once with `body`; until this settles the main button is greyed
   *  out (with a spinner after a short beat — READY_SPINNER_DELAY_MS — so a
   *  quick answer doesn't blink). A resolved `body` then replaces the body.
   *  A rejection just turns the button on. Cancel always works. */
  ready?: Promise<{ body?: React.ReactNode } | void>;
}

/** How long a not-yet-ready confirm waits before showing its spinner. */
export const READY_SPINNER_DELAY_MS = 300;

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
  /** Red main button — for prompts that gate a can't-undo action. */
  destructive?: boolean;
  /** Return a message to block submit and show it under the field. */
  validate?: (value: string) => string | null | undefined;
}

export interface KitAlertOptions {
  title: React.ReactNode;
  body?: React.ReactNode;
  okLabel?: string;
}

export interface KitConfirmIdentityOptions {
  /** Defaults to "Confirm it's you". */
  title?: React.ReactNode;
  /** Defaults to a line saying what to enter. */
  body?: React.ReactNode;
  /** Also ask for a two-step code (the account has two-step codes on). */
  needsCode: boolean;
  /** Check what was typed. Resolve null when it's accepted, or a message to
   *  show under the fields (wrong password, wrong code, too many tries). */
  submit: (password: string, code: string) => Promise<string | null>;
}

type Request = { key: string | null; promise: Promise<unknown> } & (
  | { kind: "confirm"; id: number; opts: KitConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; id: number; opts: KitPromptOptions; resolve: (v: string | null) => void }
  | { kind: "alert"; id: number; opts: KitAlertOptions; resolve: () => void }
  | { kind: "identity"; id: number; opts: KitConfirmIdentityOptions; resolve: (v: boolean) => void }
);

let queue: Request[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let hostEl: HTMLElement | null = null;
let hostRoot: ReturnType<typeof createRoot> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function ensureHost(): void {
  if (typeof document === "undefined") return;
  // Re-mount if something (a test cleanup) detached the host.
  if (hostEl && document.body.contains(hostEl)) return;
  // The old root's dialog portals into document.body, so it must go too.
  hostRoot?.unmount();
  const el = document.createElement("div");
  hostEl = el;
  el.setAttribute("data-kit-dialog-host", "");
  document.body.appendChild(el);
  hostRoot = createRoot(el);
  hostRoot.render(<KitDialogHost />);
}

/** Test-only auto-answer: when set, dialogs resolve immediately without
 *  rendering, and each request is recorded. See autoAnswerKitDialogs. */
interface AutoAnswer {
  confirm?: boolean | ((o: KitConfirmOptions) => boolean);
  prompt?: string | null | ((o: KitPromptOptions) => string | null);
  /** Password and code typed into "Confirm it's you"; null = Cancel. */
  identity?: { password: string; code: string } | null;
  calls: Array<{
    kind: Request["kind"];
    opts: KitConfirmOptions | KitPromptOptions | KitAlertOptions | KitConfirmIdentityOptions;
  }>;
}
let autoAnswer: AutoAnswer | null = null;

function push(req: Request): void {
  if (autoAnswer) {
    if (req.kind === "confirm" && req.opts.ready) {
      // Like the real dialog: no answer until it's ready; the recorded body
      // is the one the person would have answered.
      const a = autoAnswer;
      const opts = req.opts;
      void opts.ready!.then(
        (r) => ({ ...opts, ...(r && r.body !== undefined ? { body: r.body } : {}) }),
        () => opts,
      ).then((finalOpts) => {
        a.calls.push({ kind: "confirm", opts: finalOpts });
        const ans = a.confirm ?? true;
        req.resolve(typeof ans === "function" ? ans(finalOpts) : ans);
      });
      return;
    }
    autoAnswer.calls.push({ kind: req.kind, opts: req.opts });
    if (req.kind === "confirm") {
      const a = autoAnswer.confirm ?? true;
      req.resolve(typeof a === "function" ? a(req.opts) : a);
    } else if (req.kind === "prompt") {
      const a = autoAnswer.prompt ?? null;
      req.resolve(typeof a === "function" ? a(req.opts) : a);
    } else if (req.kind === "identity") {
      const a = autoAnswer.identity ?? null;
      if (!a) req.resolve(false);
      else void req.opts.submit(a.password, a.code).then((msg) => req.resolve(msg === null));
    } else req.resolve();
    return;
  }
  ensureHost();
  noteOpener();
  queue = [...queue, req];
  emit();
}

// Where focus was when the dialogs were asked for. The browser's pop-ups put
// focus back there on close; Radix can't (there's no trigger), so we do. Kept
// across a chain of questions (name → description), where the second is
// asked after the first has gone and focus sits nowhere.
let opener: HTMLElement | null = null;

function noteOpener(): void {
  if (typeof document === "undefined") return;
  const a = document.activeElement;
  if (a instanceof HTMLElement && a !== document.body && !a.closest("[data-kit-dialog-host]")) opener = a;
}

function settle(id: number): void {
  queue = queue.filter((r) => r.id !== id);
  emit();
  if (queue.length > 0) return;
  // After Radix's own close focus handling has run.
  setTimeout(() => {
    if (queue.length > 0) return;
    const el = opener;
    opener = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, 0);
}

/** Identical text-only requests share one dialog: unlike the browser's
 *  pop-ups these don't freeze the page, so a double-click would otherwise
 *  queue the same question twice and run the action twice. */
function dedupeKey(kind: Request["kind"], opts: { title: React.ReactNode; body?: React.ReactNode }): string | null {
  if (typeof opts.title !== "string") return null;
  if (opts.body != null && typeof opts.body !== "string") return null;
  return `${kind}\u0000${opts.title}\u0000${opts.body ?? ""}`;
}

function request<T>(
  kind: Request["kind"],
  opts: KitConfirmOptions | KitPromptOptions | KitAlertOptions | KitConfirmIdentityOptions,
): Promise<T> {
  const key = autoAnswer || (kind === "confirm" && (opts as KitConfirmOptions).ready)
    ? null
    : kind === "identity"
      ? "identity"
      : dedupeKey(kind, opts as KitConfirmOptions);
  const existing = key ? queue.find((r) => r.key === key) : undefined;
  if (existing && kind === "identity") {
    // Several actions waiting on the same confirmation share one box and
    // one answer.
    return existing.promise as Promise<T>;
  }
  if (existing) {
    // The first caller gets the real answer; the duplicate is told "no", so
    // an action guarded by the question can't run twice.
    return Promise.resolve((kind === "confirm" ? false : kind === "prompt" ? null : undefined) as T);
  }
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  push({ kind, id: nextId++, opts, resolve, key, promise } as Request);
  return promise;
}

/** Ask a yes/no question. Resolves true on confirm, false on cancel/dismiss. */
export function kitConfirm(opts: KitConfirmOptions): Promise<boolean> {
  return request<boolean>("confirm", opts);
}

/** Ask for a line of text. Resolves the value as typed, or null on cancel. */
export function kitPrompt(opts: KitPromptOptions): Promise<string | null> {
  return request<string | null>("prompt", opts);
}

/** Tell the user something. Resolves when dismissed. */
export function kitAlert(opts: KitAlertOptions): Promise<void> {
  return request<void>("alert", opts);
}

/** "Confirm it's you": ask for the password (and a two-step code) and keep
 *  asking until `submit` accepts it. Resolves true once accepted, false on
 *  Cancel. */
export function kitConfirmIdentity(opts: KitConfirmIdentityOptions): Promise<boolean> {
  return request<boolean>("identity", opts);
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
  if (top.kind === "identity") return <IdentityDialogView key={top.id} req={top} />;
  return <DialogView key={top.id} req={top} />;
}

function IdentityDialogView({
  req,
}: {
  req: Extract<Request, { kind: "identity" }>;
}): React.JSX.Element {
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const done = React.useRef(false);
  const { needsCode, title, body } = req.opts;

  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    req.resolve(ok);
    settle(req.id);
  };

  const submit = async () => {
    if (busy) return;
    if (!password) {
      setError("Enter your password.");
      return;
    }
    if (needsCode && !code.trim()) {
      setError("Enter the code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    let msg: string | null;
    try {
      msg = await req.opts.submit(password, code.trim());
    } catch {
      msg = "Couldn't confirm. Try again.";
    }
    if (done.current) return;
    setBusy(false);
    if (msg === null) finish(true);
    else setError(msg);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) finish(false);
      }}
      size="sm"
      data-testid="kit-identity-dialog"
    >
      <form
        className="k-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <DialogPrimitive.Title className="k-dialog-title">{title ?? "Confirm it's you"}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="k-dialog-text">
          {body ??
            (needsCode
              ? "This changes who can get into your account. Enter your password and the code from your authenticator app."
              : "This changes who can get into your account. Enter your password.")}
        </DialogPrimitive.Description>
        <KitField className="k-dialog-field" label="Password" error={needsCode ? undefined : error}>
          <KitInput
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            disabled={busy}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            data-testid="kit-identity-password"
          />
        </KitField>
        {needsCode ? (
          <KitField className="k-dialog-field" label="Two-step code" error={error}>
            <KitInput
              inputMode="numeric"
              autoComplete="one-time-code"
              mono
              value={code}
              disabled={busy}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
              }}
              data-testid="kit-identity-code"
            />
          </KitField>
        ) : null}
        <div className="k-dialog-acts">
          <KitButton onClick={() => finish(false)} data-testid="kit-dialog-cancel">
            Cancel
          </KitButton>
          <KitButton
            type="submit"
            variant="primary"
            disabled={busy}
            data-testid="kit-dialog-confirm"
          >
            {busy ? "Checking…" : "Confirm"}
          </KitButton>
        </div>
      </form>
    </Modal>
  );
}

function DialogView({ req }: { req: Exclude<Request, { kind: "identity" }> }): React.JSX.Element {
  const [value, setValue] = React.useState(
    req.kind === "prompt" ? req.opts.defaultValue ?? "" : "",
  );
  const [error, setError] = React.useState<string | null>(null);
  const done = React.useRef(false);
  // A confirm with `ready`: greyed out until it settles; spinner after a beat.
  const readyPromise = req.kind === "confirm" ? req.opts.ready : undefined;
  const [notReady, setNotReady] = React.useState(!!readyPromise);
  const [showSpinner, setShowSpinner] = React.useState(false);
  const [readyBody, setReadyBody] = React.useState<React.ReactNode | undefined>(undefined);
  React.useEffect(() => {
    if (!readyPromise) return;
    let live = true;
    const t = setTimeout(() => live && setShowSpinner(true), READY_SPINNER_DELAY_MS);
    const settleReady = (r: { body?: React.ReactNode } | void) => {
      if (!live) return;
      clearTimeout(t);
      if (r && r.body !== undefined) setReadyBody(r.body);
      setNotReady(false);
      setShowSpinner(false);
    };
    readyPromise.then(settleReady, () => settleReady());
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [readyPromise]);
  // Like the browser's prompt: the starting text is selected, so typing
  // replaces it (a rename starts from the old name).
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    // After the dialog's own open focus handling, which puts the caret last.
    const t = setTimeout(() => inputRef.current?.select(), 0);
    return () => clearTimeout(t);
  }, []);

  const finish = (result: "ok" | "cancel") => {
    if (done.current) return;
    done.current = true;
    if (req.kind === "confirm") req.resolve(result === "ok");
    else if (req.kind === "prompt") req.resolve(result === "ok" ? value : null);
    else req.resolve();
    settle(req.id);
  };

  const submit = () => {
    if (notReady) return; // Enter while greyed out does nothing
    if (req.kind === "prompt") {
      const msg = req.opts.validate?.(value);
      if (msg) {
        setError(msg);
        return;
      }
    }
    finish("ok");
  };

  const { title } = req.opts;
  const body = readyBody !== undefined ? readyBody : req.opts.body;
  const okLabel =
    req.kind === "alert"
      ? req.opts.okLabel ?? "OK"
      : req.opts.confirmLabel ?? (req.kind === "prompt" ? "OK" : "Confirm");
  const cancelLabel = req.kind === "alert" ? null : req.opts.cancelLabel ?? "Cancel";
  const destructive = req.kind !== "alert" && !!req.opts.destructive;

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
              ref={inputRef}
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
            <KitButton
              onClick={() => finish("cancel")}
              // A destructive question starts on Cancel, so Enter can't delete.
              autoFocus={destructive && req.kind !== "prompt"}
              data-testid="kit-dialog-cancel"
            >
              {cancelLabel}
            </KitButton>
          ) : null}
          <KitButton
            type="submit"
            variant={destructive ? "danger" : "primary"}
            autoFocus={req.kind !== "prompt" && !destructive}
            disabled={notReady}
            busy={showSpinner}
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
    if (r.kind === "confirm" || r.kind === "identity") r.resolve(false);
    else if (r.kind === "prompt") r.resolve(null);
    else r.resolve();
  }
  queue = [];
  emit();
}
