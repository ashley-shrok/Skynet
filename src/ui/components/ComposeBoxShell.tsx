import { type ReactNode, useRef } from "react";
import { Textarea } from "@/components/textarea";
import { cn } from "@/lib/utils";

// Phase 90 Plan 02 Task 2 — ComposeBoxShell primitive.
//
// COPY-extracted (D-03) from ComposeBox.tsx's Row 2 block (L2683-3113):
// textarea + Send button. Row 1 (meter/reset/queue/stop/thumbs-up/recap) is
// NOT extracted — it's PrettyView-specific per D-04. Instead, the shell
// exposes `upperArea?: ReactNode` + `attachButton?: ReactNode` slot props so
// pretty view (future convergence slice) could fill Row 1 and the relay pane
// (Plan 06) passes null per D-04/D-05.
//
// This is a STANDALONE COPY — NOT a shared import that pretty view has been
// migrated onto. Pretty view's ComposeBox (3600+ lines) continues to consume
// its own private Row 2 verbatim. D-03: the strongest guarantee pretty view
// does not regress is not editing it.
//
// Security discipline (T-17-03-01 preserved): standard React controlled
// textarea; no innerHTML anywhere; the shell never interprets `value` as HTML.
//
// What is INCLUDED (copied verbatim from ComposeBox.tsx L2683-3113):
//   - Row 2 outer wrapper `<div className="flex items-end gap-2">` (items-end
//     so Send pins to the textarea bottom edge as the textarea grows).
//   - Textarea styling: `resize-none w-full h-full`, `min-h-8!` (shadcn
//     override — load-bearing per Phase 9 UAT fix), `bg-[rgba(10,12,20,0.5)]!`
//     and `text-[#f0ebe0]` (`!` load-bearing per patch #82).
//   - Enter-to-send keyboard handler (per Row-2 semantic).
//   - Send button visual matching Row 2 — plain <button type="button"> not
//     shadcn Button (sidesteps the wrapper-specificity trap that bit patches
//     #81 and #117 with the queue button's `!` load-bearing bg classes).
//
// What is EXCLUDED (Row 1 + orchestration-specific machinery per D-04):
//   - Reset button, context meter, queue button, stop button, thumbs-up, recap.
//   - Meter well + segment band rendering (SEG_COUNT, litCount, band-color).
//   - Paperclip attach button (relay pane passes `attachButton={null}` per
//     D-05: attach HIDDEN entirely for v1, not disabled-with-tooltip).
//   - MicButton / voice recording / RecordingControls.
//   - Vehicle C v2 primary-armed overlay (queued-send affordance).
//   - Aside-active X-morph, showTranscribingSend spinner branch,
//     showPrimaryArmButton overlay, `handlePaste` file-drop, chip strip
//     staged-attachment display.
//   - onBlur handler, primaryArmed disable, `handleTextChange` growth logic,
//     `useLayoutEffect` auto-grow (this primitive is the visual shell; the
//     pane orchestrator owns state, growth, and any advanced compose behavior).
//
// The pane orchestrator (Plan 06 for relay-room; a future convergence slice
// for pretty view) owns compose state, optimistic-send lifecycle, error
// display, and any advanced compose behavior — this primitive is the shell
// only.

export interface ComposeBoxShellProps {
  /**
   * Controlled textarea value. Pane orchestration owns state so the pane can
   * drive optimistic-send clear semantics from outside (Plan 06 needs to
   * clear on optimistic-send success/failure paths).
   */
  value: string;
  /**
   * Called on every controlled textarea change. The shell also calls
   * `onChange("")` after firing `onSend` to clear the textarea (matches
   * ComposeBox.tsx Row-2 behavior — clear-on-send).
   */
  onChange: (v: string) => void;
  /**
   * Called when the user hits Enter (without shift) OR clicks Send.
   * Receives the TRIMMED text — the shell trims leading/trailing whitespace
   * so the pane orchestrator never has to.
   */
  onSend: (text: string) => void;
  /**
   * Slot rendered ABOVE the textarea row. Pretty view (future convergence)
   * could fill this with Row 1 (meter/reset/queue/stop/thumbs-up/recap);
   * the relay pane passes `undefined` per D-04.
   */
  upperArea?: ReactNode;
  /**
   * Slot rendered adjacent to the textarea (LEFT edge, inside the wrapper).
   * Pretty view (future convergence) could fill this with a Paperclip attach
   * button; the relay pane passes `undefined` per D-05 (attach HIDDEN for v1).
   */
  attachButton?: ReactNode;
  /**
   * Textarea placeholder. Defaults to 'Type a message…' when unset.
   */
  placeholder?: string;
  /**
   * External disable gate for the Send button. When false, Send is disabled
   * regardless of typed text (pane orchestration may block on WS state or
   * per-agent readiness). The textarea itself remains editable so the user
   * can compose during a transient disable (matches ComposeBox.tsx L2816-2818
   * comment: "user can compose during a transient disconnect and send when
   * WS reconnects").
   */
  canSend?: boolean;
  /**
   * Outer container class merge via `cn()`.
   */
  className?: string;
}

export function ComposeBoxShell({
  value,
  onChange,
  onSend,
  upperArea,
  attachButton,
  placeholder = "Type a message…",
  canSend = true,
  className,
}: ComposeBoxShellProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const trimmed = value.trim();
  const sendDisabled = !canSend || trimmed.length === 0;

  const fireSend = () => {
    if (sendDisabled) return;
    onSend(trimmed);
    // Clear the textarea via the controlled channel (mirrors ComposeBox.tsx
    // Row-2 semantic — send clears the compose field). Pane orchestration
    // observes the empty value and can render its own optimistic bubble.
    onChange("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // VERBATIM from ComposeBox.tsx Row 2 Enter-to-send discipline:
    // Enter (without shift) fires onSend and clears; Shift+Enter falls
    // through so the browser inserts a newline (Textarea default).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      fireSend();
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* upperArea slot — pretty view (future) fills Row 1; relay pane
          passes undefined per D-04. Guarded so an undefined slot renders
          nothing (not even an empty wrapper). */}
      {upperArea !== undefined && upperArea !== null ? (
        <div data-testid="compose-shell-upper-area">{upperArea}</div>
      ) : null}

      {/* Row 2 — compose bar: textarea (flex-1, self-stretch) + Send button.
          items-end so Send pins to the textarea bottom edge as the textarea
          grows. VERBATIM from ComposeBox.tsx L2687. */}
      <div className="flex items-end gap-2">
        <div className="relative flex-1 self-stretch">
          {/* attachButton slot — pretty view (future) fills with a Paperclip;
              relay pane passes undefined per D-05 (attach HIDDEN, not disabled). */}
          {attachButton !== undefined && attachButton !== null ? (
            <div
              data-testid="compose-shell-attach-slot"
              className="absolute left-1 bottom-0.5"
            >
              {attachButton}
            </div>
          ) : null}
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            // Textarea styling — VERBATIM from ComposeBox.tsx L2753-2815.
            // See original comments for the load-bearing rationale on each
            // `!` suffix (shadcn Textarea's dark: variant specificity trap).
            className={cn(
              "resize-none w-full h-full",
              // Phase 9 UAT fix (Alice 2026-07-22): shadcn Textarea base
              // carries `min-h-[80px]` (see textarea.tsx L16) — that's ~2.5
              // button-heights and floods any rows={1} regardless. `min-h-8!`
              // (32px = one icon-sm button height) beats it via Tailwind v4
              // `!` important suffix. `!` load-bearing.
              "min-h-8!",
              // Patch #82 palette: cool-black well `rgba(10,12,20,0.5)`,
              // warm-cream text `#f0ebe0`. `!` load-bearing on bg per #81 fix
              // (shadcn's `dark:bg-input/30` at specificity 0-2-0 would win
              // a plain arbitrary bg-[...] at 0-1-0 without `!`).
              "bg-[rgba(10,12,20,0.5)]! text-[#f0ebe0]",
              "border border-[rgba(220,225,245,0.07)]",
              "rounded-[10px] px-4 py-3",
              // Reserve right padding so a future inside-textarea Send button
              // (if the primitive is ever inlined into the textarea) does not
              // occlude typed text. Not currently needed because Send lives
              // as a sibling to the right, but preserves the visual language.
              "pr-10",
              // Mirror the left `pl-11` from ComposeBox.tsx L2808 when the
              // attach slot is filled (attachButton is rendered inside the
              // wrapper at absolute left-1 bottom-0.5, so extra left padding
              // keeps typed text from underlapping it).
              attachButton !== undefined && attachButton !== null && "pl-11",
              "placeholder:text-[var(--color-pv-fg-dim)]",
              "shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),_0_1px_0_rgba(220,225,245,0.04)]",
              "transition-[box-shadow,border-color] duration-200",
              "focus:border-[rgba(220,225,245,0.28)]",
              "focus:shadow-[inset_0_3px_10px_rgba(0,0,0,0.55),_inset_0_1px_2px_rgba(0,0,0,0.35),_0_1px_0_rgba(220,225,245,0.07),_0_0_0_1px_rgba(220,225,245,0.2),_0_0_22px_rgba(220,225,245,0.12)]",
              "focus-visible:ring-0 focus-visible:outline-none",
            )}
          />
        </div>
        {/* Send button — bare <button type="button"> per ComposeBox.tsx
            L2967 pattern (NOT shadcn Button — sidesteps wrapper-specificity
            trap that bit patches #81 and #117). Rendered as a sibling to the
            right of the textarea rather than inside-absolute; the pane
            orchestration owns compose layout and this sibling arrangement
            keeps the shell layout-independent (relay-room pane may want a
            different Send positioning than pretty view's inside-textarea
            paper-plane). */}
        <button
          type="button"
          onClick={fireSend}
          disabled={sendDisabled}
          aria-label="Send"
          title="Send"
          className={cn(
            "h-10 px-3 rounded-[8px]",
            "text-sm font-medium",
            // Amber/warm treatment matching ComposeBox VISUAL-08 hard-lock
            // colour language (send is the sole saturated attention grab-
            // point). Not identical inline-SVG paper-plane markup (that
            // lives inside the textarea in pretty view); this is the
            // sibling-button flavor of the same visual language.
            "bg-[linear-gradient(180deg,hsla(38,80%,55%,0.85),hsla(38,80%,45%,0.85))]",
            "text-[#1a1408]",
            "border border-[hsla(38,80%,50%,0.6)]",
            "shadow-[0_2px_6px_rgba(0,0,0,0.35),_inset_0_1px_0_rgba(255,235,190,0.4)]",
            "hover:bg-[linear-gradient(180deg,hsla(38,85%,60%,0.9),hsla(38,85%,48%,0.9))]",
            "transition-[background,box-shadow,opacity] duration-120",
            "active:scale-[0.98]",
            "cursor-pointer",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          Send
        </button>
      </div>
    </div>
  );
}
