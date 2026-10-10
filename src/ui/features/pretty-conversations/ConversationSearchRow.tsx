/**
 * Single result row for the conversation search modal.
 *
 * Phase 143 D-11 / D-12 / D-13 / D-14: Archived-identity rows now carry an
 * always-visible RowKebabMenu (three-dots ⋮) in the right-side slot, replacing
 * the chevron for archived rows. The menu contains a single "Un-archive" item.
 * Kebab click stops propagation so the row's default onClick does NOT fire
 * (D-14). Only render the kebab when `result.isArchived === true` AND
 * `onUnarchive` is provided — non-archived rows are unaffected.
 * See .planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md
 *
 * Anatomy (2026-10-10 search-row look — sidebar parity + passages):
 *   Head: avatar disc (avatarUrl → initial-letter fallback, hue =
 *   result.colorHue, gold sheen for multi-role via .pv-multi-role) + two
 *   lines — (1) task ?? displayName ?? identityKey, right-aligned relative
 *   time; (2) "Name · Role[, Role]" + archived pill.
 *   Body: up to 3 passages, each labelled with its speaker ("You", the
 *   agent's name, "Skill text", "Command", "Event"); boilerplate passages
 *   (skill / command) paint muted. Every case-insensitive occurrence of the
 *   query is wrapped in <span className="pv-search-hit"> — React text
 *   children only, never raw HTML (T-122-FE-01). "+N more matches" when the
 *   backend saw more than it sent.
 *
 * Fallback: rows the backend's passage pass didn't cover (passages empty)
 * render the single legacy snippet, split around hitStart/hitLength; when
 * hitStart is -1 the snippet renders unhighlighted.
 *
 * hostName is intentionally NOT rendered. Tasting dropped it; per user
 * 2026-09-29: "if tasting dropped something then we are not re-adding it".
 *
 * Archived pill retained — real behavior signal (parent routes archived
 * clicks to kebab-menu Un-archive path per D-11/D-12/D-13/D-14).
 *
 * The row is a semantic <button> so keyboard focus + Enter/Space activate
 * it naturally. Parent (ConversationSearchModal) provides the onClick.
 */

import { useState } from "react";
import type {
  ConversationSearchPassage,
  ConversationSearchResult,
} from "@/api/conversation-search-api";
import { roleDisplayName } from "@/lib/role-display-name";
import { cn } from "@/lib/utils";
import {
  RowKebabMenu,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
} from "./RowKebabMenu";

const FALLBACK_HUE = 190;

export interface ConversationSearchRowProps {
  result: ConversationSearchResult;
  onClick: () => void;
  /** The fired query — every occurrence is highlighted in the passages. */
  query?: string;
  /**
   * Phase 143 D-11 / D-12 / D-13 / D-14 — when provided and
   * result.isArchived === true, the row renders an always-visible RowKebabMenu
   * with a single "Un-archive" item. Kebab click stops propagation (handled
   * inside RowKebabMenu) so the row onClick does NOT fire (D-14). Non-archived
   * rows are unaffected.
   */
  onUnarchive?: (result: ConversationSearchResult) => void;
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

/** Split `text` into React children with every case-insensitive
 *  occurrence of `query` wrapped in a .pv-search-hit span. */
function highlightAll(text: string, query: string): Array<string | JSX.Element> {
  const q = query.trim();
  if (q.length === 0) return [text];
  // Case-insensitive regex over the ORIGINAL text — indices from a
  // toLowerCase() copy drift on characters whose lowercase differs in
  // length (e.g. "İ").
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const out: Array<string | JSX.Element> = [];
  let i = 0;
  for (const m of text.matchAll(re)) {
    const j = m.index ?? 0;
    if (m[0].length === 0) break;
    if (j > i) out.push(text.slice(i, j));
    out.push(
      <span key={j} className="pv-search-hit">
        {m[0]}
      </span>,
    );
    i = j + m[0].length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

function speakerLabel(
  speaker: ConversationSearchPassage["speaker"],
  agentName: string,
): string {
  switch (speaker) {
    case "user":
      return "You";
    case "agent":
      return agentName;
    case "skill":
      return "Skill text";
    case "command":
      return "Command";
    case "event":
      return "Event";
  }
}

export function ConversationSearchRow({
  result,
  onClick,
  query = "",
  onUnarchive,
  now,
}: ConversationSearchRowProps): JSX.Element {
  const name = result.displayName ?? result.identityKey;
  const title = result.aiTitle ?? result.task ?? name;
  const hue = result.colorHue ?? FALLBACK_HUE;
  const when = formatRelativeTime(result.transcriptMtime, now ?? Date.now());
  const roles = result.roles ?? [];
  const rolesLabel = roles
    .map((r) => roleDisplayName(r.slug, r.displayName))
    .join(", ");
  const isMultiRole = roles.length > 1;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatarImg = result.avatarUrl != null && !avatarFailed;

  const passages = result.passages ?? [];
  let body: JSX.Element;
  if (passages.length > 0) {
    const more = (result.matchCount ?? passages.length) - passages.length;
    body = (
      <div className="pv-search-row-passages">
        {passages.map((p, i) => (
          <div
            key={i}
            className={cn(
              "pv-search-row-passage",
              p.boilerplate && "pv-search-row-passage--boilerplate",
            )}
            data-speaker={p.speaker}
          >
            <span className="pv-search-row-speaker">
              {speakerLabel(p.speaker, name)}
            </span>
            <div className="pv-search-row-snippet">
              {highlightAll(p.text, query)}
            </div>
          </div>
        ))}
        {/* matchCountCapped = the scan stopped before the end of the
            transcript, so there may be more even when `more` is 0 (the
            capped lines were tool output, not text). */}
        {(more > 0 || result.matchCountCapped) && (
          <div className="pv-search-row-more">
            {result.matchCountCapped
              ? more > 0
                ? `${more}+ more matches in this conversation`
                : "More matches in this conversation"
              : `+${more} more ${more === 1 ? "match" : "matches"} in this conversation`}
          </div>
        )}
      </div>
    );
  } else if (result.hitStart >= 0 && result.hitLength > 0) {
    const before = result.snippet.slice(0, result.hitStart);
    const hit = result.snippet.slice(
      result.hitStart,
      result.hitStart + result.hitLength,
    );
    const after = result.snippet.slice(result.hitStart + result.hitLength);
    body = (
      <div className="pv-search-row-snippet">
        {before}
        <span className="pv-search-hit">{hit}</span>
        {after}
      </div>
    );
  } else {
    body = <div className="pv-search-row-snippet">{result.snippet}</div>;
  }

  // Phase 143 D-11 / D-12 / D-13 / D-14: render the kebab only on archived
  // rows when the onUnarchive callback is provided. The kebab replaces the
  // chevron slot for archived rows; non-archived rows are unaffected.
  const showKebab = result.isArchived && onUnarchive != null;
  const kebabItems: RowKebabMenuItem[] = showKebab
    ? [
        {
          label: "Un-archive",
          onClick: () => onUnarchive!(result),
        },
      ]
    : [];
  // Right-click the row → same kebab menu at the cursor (no-op when the row
  // has no kebab: empty items leave the native context menu alone).
  const kebabContextMenu = useRowKebabContextMenu(kebabItems);

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={kebabContextMenu.onContextMenu}
      data-testid={`conversation-search-row-${result.transcriptPath}`}
      data-archived={result.isArchived ? "true" : "false"}
      className={cn("pv-search-row", isMultiRole && "pv-multi-role")}
      style={{ ["--pv-search-row-hue" as string]: String(hue) }}
    >
      <div className="pv-search-row-header">
        <span className="pv-search-row-avatar" aria-hidden="true">
          {showAvatarImg ? (
            <img
              src={result.avatarUrl!}
              alt=""
              className="pv-search-row-avatar-img"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </span>
        <span className="pv-search-row-lines">
          <span className="pv-search-row-line1">
            <span className="pv-search-row-name">{title}</span>
            <span className="pv-search-row-when">{when}</span>
          </span>
          <span className="pv-search-row-line2">
            <span className="pv-search-row-identity">{name}</span>
            {rolesLabel && (
              <>
                <span className="pv-search-row-sep" aria-hidden="true">
                  ·
                </span>
                <span className="pv-search-row-role">{rolesLabel}</span>
              </>
            )}
            {result.isArchived && (
              <span className="pv-search-archived-pill">archived</span>
            )}
          </span>
        </span>
        {showKebab && (
          <RowKebabMenu
            testId={`conversation-search-archived-row-kebab-${result.identityKey}-${result.hostId}`}
            ariaLabel={`Row menu for ${result.identityKey}`}
            items={kebabItems}
          />
        )}
        {kebabContextMenu.menu}
      </div>
      {body}
    </button>
  );
}
