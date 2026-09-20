/**
 * Phase 122 Plan 122-03 Task 2 — Single result row for the conversation
 * search modal.
 *
 * Renders three lines:
 *   1. Title:    aiTitle || identityKey  (Wave-1 aiTitle is always null so
 *                identityKey is what shows today; when the aiTitle backend
 *                piggyback lands it will Just Work)
 *   2. Subtext:  identityKey · hostName
 *   3. Snippet:  plain text with the matched substring wrapped in a
 *                <span className="pv-search-hit"> — split cleanly via
 *                slice() around hitStart/hitLength, using React text
 *                children only (D-11 / T-122-FE-01, XSS-safe).
 *
 * Fallback: if hitStart is -1 (backend couldn't locate the match inside
 * the extracted text — see session-search-snippet.ts fallback branches),
 * render the raw snippet unhighlighted. The snippet is still displayed
 * (better than nothing) but no <span> wraps.
 *
 * The row is a semantic `<button>` so keyboard focus + Enter/Space activate
 * it naturally. The parent (ConversationSearchModal) provides the
 * onClick handler which routes active → open-conversation flow and
 * archived → window.alert (D-14, D-15).
 */

import type { ConversationSearchResult } from "@/api/conversation-search-api";

export interface ConversationSearchRowProps {
  result: ConversationSearchResult;
  onClick: () => void;
}

export function ConversationSearchRow({
  result,
  onClick,
}: ConversationSearchRowProps): JSX.Element {
  const title = result.aiTitle || result.identityKey;

  // Snippet: three-part split around the hit. If hitStart < 0 or
  // hitLength <= 0 → render raw snippet unhighlighted (fallback path
  // from the backend snippetForHit function).
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
    >
      <div className="pv-search-row-title">
        {title}
        {result.isArchived && (
          <span className="pv-search-archived-pill">archived</span>
        )}
      </div>
      <div className="pv-search-row-subtext">
        {result.identityKey} · {result.hostName}
      </div>
      {snippetNode}
    </button>
  );
}
