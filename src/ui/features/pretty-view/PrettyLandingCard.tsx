// ─── PrettyLandingCard ────────────────────────────────────────────────────────
// Phase 11 landing-surface swap (PURGE-01): warm-glass empty-landing card
// rendered in the main pane by `renderTabContent` (src/ui/shell/tabUtils.tsx)
// when the initial fallback tab is active. Replaces the retired legacy
// render tree for the desktop fresh-load landing surface and the
// doCloseTab synthetic-fallback tab. The fallback TabType identifier is
// PRESERVED as a load-bearing fallback in AppShell's
// effectiveSelectedTabId / doCloseTab / URL-restore logic (see
// 11-01-STRIP-LIST.md Section A rationale); only the RENDER path swaps.
//
// Visual language mirrors Phase 10's PrettyConversationsPanel empty-state
// idle glass card (src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
// around lines 282-308) — flat warm-neutral rgba background, subtle border,
// backdrop-blur, warm-cream text. NO animation, NO spinner, NO shadcn
// primitives (Phase 10 patch #133 precedent — the pretty surfaces are
// shadcn-free), NO useEffect / useState (motion + data-fetch guardrails per
// Ashley's motion-quiet lock and threat-model T-11-02-03).
//
// Palette tokens live on the inline `style={{...}}` prop of the outer
// container, NOT in a Tailwind arbitrary-value class. Reason (per plan
// Test 3 assertion contract): JSDOM does NOT resolve computed CSS variables
// or Tailwind classes at test time — only inline styles are queryable via
// `element.getAttribute("style")` or `element.style.<prop>`. Inline-style
// declaration is also the most legible traceability path to the
// `--color-pv-*` palette-authority rule from 11-CONTEXT.md § Palette
// authority.

import { MessagesSquare } from "lucide-react";

/**
 * PrettyLandingCard — Phase 11 desktop landing empty-state.
 *
 * Rendered by tabUtils.tsx in place of the retired legacy landing component.
 * Takes no props — this is the idle card shown when no conversation has
 * been selected yet.
 */
export function PrettyLandingCard(): JSX.Element {
  return (
    <div
      data-pv-landing-card="true"
      className="flex flex-col flex-1 items-center justify-center px-6 py-10"
    >
      <div
        role="status"
        aria-label="Select an agent"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.75rem 1rem",
          borderRadius: "14px",
          background:
            "linear-gradient(160deg, rgba(45,55,80,0.55), rgba(28,35,55,0.6))",
          border: "1px solid rgba(120,140,180,0.32)",
          color: "rgba(240,235,224,0.9)",
          fontSize: "0.875rem",
          backdropFilter: "blur(20px) saturate(1.6)",
          WebkitBackdropFilter: "blur(20px) saturate(1.6)",
          boxShadow:
            "0 8px 24px rgba(0,0,0,0.5), 0 1px 0 rgba(255,220,170,0.10) inset, 0 0 0 0.5px rgba(120,140,180,0.16) inset, 0 0 24px rgba(120,140,180,0.08)",
        }}
      >
        <MessagesSquare
          className="size-4 shrink-0"
          style={{ color: "rgba(240,235,224,0.75)" }}
          aria-hidden="true"
        />
        <span>Select an agent</span>
      </div>
    </div>
  );
}
