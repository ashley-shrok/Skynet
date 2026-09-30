/**
 * Single result row for the conversation search modal.
 *
 * Tasting anatomy (modal-tasting.html § conversation search):
 *   Line 1 (.pv-search-row-header): sender-dot (hue = result.colorHue,
 *   fallback 190) + display name + right-aligned relative time.
 *   Line 2 (.pv-search-row-snippet): plain-text snippet with the matched
 *   substring wrapped in a <span className="pv-search-hit"> — split via
 *   slice() around hitStart/hitLength, React text children only (D-11 /
 *   T-122-FE-01, XSS-safe).
 *
 * Row title: aiTitle ?? displayName ?? identityKey. aiTitle is deferred
 * (always null in the current wave); displayName is the visible tasting
 * choice ("Gambit" over "gambit-box-maintainer-2"). Falls back to raw
 * identityKey only when both are absent (fail-visible rather than blank).
 *
 * hostName is intentionally NOT rendered. Tasting dropped it; per user
 * 2026-09-29: "if tasting dropped something then we are not re-adding it".
 *
 * Fallback: if hitStart is -1 (backend couldn't locate the match inside
 * the extracted text — see session-search-snippet.ts fallback branches),
 * render the raw snippet unhighlighted. Still displayed (better than
 * nothing) but no <span> wraps.
 *
 * Archived pill retained — real behavior signal (parent routes archived
 * clicks to window.alert vs opening the tab, per D-14/D-15).
 *
 * The row is a semantic <button> so keyboard focus + Enter/Space activate
 * it naturally. Parent (ConversationSearchModal) provides the onClick.
 */

import type { ConversationSearchResult } from "@/api/conversation-search-api";

const FALLBACK_HUE = 190;

export interface ConversationSearchRowProps {
  result: ConversationSearchResult;
  onClick: () => void;
  /** Injected in tests; falls back to Date.now() so relative-time rendering
   *  is deterministic under vitest. */
  now?: number;
}

/**
 * Buckets: <60s → "just now"; <60m → "N min ago"; <24h → "N hr ago";
 * <7d → "N d ago"; else absolute short date. Same rounding style as
 * chat "when" chips elsewhere in the app.
 */
function formatRelativeTime(mtimeMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.round((nowMs - mtimeMs) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} d ago`;
  return new Date(mtimeMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ConversationSearchRow({
  result,
  onClick,
  now,
}: ConversationSearchRowProps): JSX.Element {
  const title = result.aiTitle ?? result.displayName ?? result.identityKey;
  const hue = result.colorHue ?? FALLBACK_HUE;
  const when = formatRelativeTime(result.transcriptMtime, now ?? Date.now());

  const hasHit = result.hitStart >= 0 && result.hitLength > 0;
  let snippetNode: JSX.Element;
  if (hasHit) {
    const before = result.snippet.slice(0, result.hitStart);
    const hit = result.snippet.slice(
      result.hitStart,
      result.hitStart + result.hitLength,
    );
    const after = result.snippet.slice(result.hitStart + result.hitLength);
    snippetNode = (
      <div className="pv-search-row-snippet">
        {before}
        <span className="pv-search-hit">{hit}</span>
        {after}
      </div>
    );
  } else {
    snippetNode = <div className="pv-search-row-snippet">{result.snippet}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`conversation-search-row-${result.transcriptPath}`}
      data-archived={result.isArchived ? "true" : "false"}
      className="pv-search-row"
      style={{ ["--pv-search-row-hue" as string]: String(hue) }}
    >
      <div className="pv-search-row-header">
        <span className="pv-search-row-dot" aria-hidden="true" />
        <span className="pv-search-row-name">{title}</span>
        {result.isArchived && (
          <span className="pv-search-archived-pill">archived</span>
        )}
        <span className="pv-search-row-when">{when}</span>
      </div>
      {snippetNode}
    </button>
  );
}
