// Phase 3: session-changeover holding banner for the pretty view.
//
// Mounted by PrettyView.tsx at the top of the scroll region when the
// claude-session WebSocket reports {type:"session_holding"} (Plan 03-01
// backend, Layer 1 raw-line /exit scan or Layer 2 discovery-repoll's
// SIGTERM-fallback branch). Unmounted when either:
//   - {type:"session_changed"} arrives (recycle completed) → banner
//     dismissed as the new conversation rehydrates.
//   - {type:"inactive", reason:"holding_timeout"} arrives (recycle
//     failed to relaunch) → banner dismissed as PrettyView flips
//     to the existing FALLBACK-01 inactive render.
//
// Visual design decisions (locked in CONTEXT.md § Holding-band UI):
//   * Muted, non-alarming — NOT the loud red "connection lost" toast
//     pair (patch #27); this is an expected in-app state, not an error.
//   * Static glyph (RefreshCcw) — the motion channel is owned by
//     WipBubble (patch #51). Mirrors patch #53's static ArrowRight
//     choice for in-progress harness tasks: motion is reserved for
//     "Claude is working," static glyphs are for structural state.
//     A spinner here would be semantically wrong.
//   * Sticky positioning is applied by PrettyView.tsx via its wrapper
//     className at the mount site — this component only defines the
//     visual pill; positioning is the container's job so the banner
//     can also be used in other contexts if needed later.
//   * role="status" + aria-label for assistive technology.
//   * Single line copy: "Session recycling — reconnecting…"

import { RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export function SessionHoldingBanner() {
  return (
    <div
      role="status"
      aria-label="Session recycling — reconnecting"
      className={cn(
        "flex items-center gap-2",
        "rounded-md px-3 py-1.5",
        "bg-muted/60 text-muted-foreground",
        "border border-border",
        "text-xs",
      )}
    >
      <RefreshCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Session recycling — reconnecting…</span>
    </div>
  );
}
