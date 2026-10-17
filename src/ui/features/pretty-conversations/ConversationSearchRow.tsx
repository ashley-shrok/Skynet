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
 * Anatomy (apple-ux: the kit's KitListRow, passages in its subtitle):
 *   Avatar (avatarUrl → initial-letter fallback, hue = result.colorHue,
 *   gold sheen for multi-role via .pv-multi-role's --pv-mr-sheen) + title
 *   (task ?? displayName ?? identityKey); trailing = relative time +
 *   archived chip + three-dot menu; subtitle = "Name · Role[, Role]" then
 *   the passages.
 *   Body: up to 3 passages, each labelled with its speaker ("You", the
 *   agent's name, "Skill text", "Command", "Event"); boilerplate passages
 *   (skill / command) paint muted. Every case-insensitive occurrence of the
 *   query is wrapped in a <span data-part="hit"> — React text
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
 * The row is focusable (role=button via KitListRow) so keyboard focus +
 * Enter/Space activate it. Parent (ConversationSearchModal) provides the
 * onClick. Parts carry data-part hooks (name, identity, role, avatar,
 * passage, speaker, hit, more) for tests.
 */

import type { CSSProperties } from "react";
import type {
  ConversationSearchPassage,
  ConversationSearchResult,
} from "@/api/conversation-search-api";
import { roleDisplayName } from "@/lib/role-display-name";
import { NEUTRAL_HUE } from "@/lib/identity-roles";
import { AvatarImage } from "@/components/avatar-image";
import { cn } from "@/lib/utils";
import { KitChip, KitListRow } from "@/components/kit";
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
  /** True while an un-archive of this row is in flight: spinner, no menu. */
  unarchiving?: boolean;
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

const HIT_CLASS =
  "rounded-[3px] px-0.5 font-semibold text-[var(--k-t1)] bg-[var(--k-acc-soft)]";

/** Split `text` into React children with every case-insensitive
 *  occurrence of `query` wrapped in a highlight span. */
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
      <span key={j} data-part="hit" className={HIT_CLASS}>
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
  unarchiving = false,
  now,
}: ConversationSearchRowProps): JSX.Element {
  const name = result.displayName ?? result.identityKey;
  const title = result.aiTitle ?? result.task ?? name;
  const roles = result.roles ?? [];
  // No roles and no colorHue: the neutral grey every surface uses for it.
  const neutralLook = result.colorHue == null && roles.length === 0;
  const hue = result.colorHue ?? (neutralLook ? NEUTRAL_HUE : FALLBACK_HUE);
  const when = formatRelativeTime(result.transcriptMtime, now ?? Date.now());
  const rolesLabel = roles
    .map((r) => roleDisplayName(r.slug, r.displayName))
    .join(", ");
  const isMultiRole = roles.length > 1;

  const SNIPPET_CLASS =
    "block text-[12.5px] leading-[1.5] text-[var(--k-t2)] [overflow-wrap:anywhere] line-clamp-3";

  const passages = result.passages ?? [];
  let body: JSX.Element;
  if (passages.length > 0) {
    const more = (result.matchCount ?? passages.length) - passages.length;
    body = (
      <span className="flex flex-col gap-1.5 mt-1.5" data-part="passages">
        {passages.map((p, i) => (
          <span
            key={i}
            data-part="passage"
            data-boilerplate={p.boilerplate ? "true" : undefined}
            data-speaker={p.speaker}
            className={cn(
              "flex flex-col gap-0.5 pl-2 border-l-2 border-[var(--k-hair2)]",
              p.boilerplate && "opacity-55 border-dashed",
            )}
          >
            <span
              data-part="speaker"
              className="text-[11.5px] font-semibold text-[var(--k-t3)]"
            >
              {speakerLabel(p.speaker, name)}
            </span>
            <span className={SNIPPET_CLASS}>{highlightAll(p.text, query)}</span>
          </span>
        ))}
        {/* matchCountCapped = the scan stopped before the end of the
            transcript, so there may be more even when `more` is 0 (the
            capped lines were tool output, not text). */}
        {(more > 0 || result.matchCountCapped) && (
          <span data-part="more" className="block pl-2.5 text-[12px] text-[var(--k-t3)]">
            {result.matchCountCapped
              ? more > 0
                ? `${more}+ more matches in this conversation`
                : "More matches in this conversation"
              : `+${more} more ${more === 1 ? "match" : "matches"} in this conversation`}
          </span>
        )}
      </span>
    );
  } else if (result.hitStart >= 0 && result.hitLength > 0) {
    const before = result.snippet.slice(0, result.hitStart);
    const hit = result.snippet.slice(
      result.hitStart,
      result.hitStart + result.hitLength,
    );
    const after = result.snippet.slice(result.hitStart + result.hitLength);
    body = (
      <span className={cn(SNIPPET_CLASS, "mt-1.5")}>
        {before}
        <span data-part="hit" className={HIT_CLASS}>{hit}</span>
        {after}
      </span>
    );
  } else {
    body = <span className={cn(SNIPPET_CLASS, "mt-1.5")}>{result.snippet}</span>;
  }

  // Phase 143 D-11 / D-12 / D-13 / D-14: render the kebab only on archived
  // rows when the onUnarchive callback is provided. The kebab replaces the
  // chevron slot for archived rows; non-archived rows are unaffected.
  const showKebab = result.isArchived && onUnarchive != null && !unarchiving;
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
    <KitListRow
      onActivate={onClick}
      onContextMenu={kebabContextMenu.onContextMenu}
      data-testid={`conversation-search-row-${result.transcriptPath}`}
      data-archived={result.isArchived ? "true" : "false"}
      data-hue={hue}
      dim={result.isArchived}
      className={cn("!items-start", isMultiRole && "pv-multi-role", neutralLook && "pv-neutral")}
      style={isMultiRole ? ({ "--pv-mr-h": String(hue) } as CSSProperties) : undefined}
      avatarColor={
        isMultiRole
          ? `var(--pv-mr-sheen), hsl(${hue}, 42%, 40%)`
          : `hsl(${hue}, 42%, 40%)`
      }
      avatar={
        <span data-part="avatar" className="contents">
          <AvatarImage src={result.avatarUrl} name={name} />
        </span>
      }
      title={<span data-part="name">{title}</span>}
      wrapSubtitle
      subtitle={
        <>
          <span className="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap">
            <span data-part="identity" className="truncate">{name}</span>
            {rolesLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span data-part="role" className="truncate font-semibold text-[var(--k-t2)]">
                  {rolesLabel}
                </span>
              </>
            )}
          </span>
          {body}
        </>
      }
      trailing={
        <>
          <span className="text-[12px] text-[var(--k-t3)] whitespace-nowrap">{when}</span>
          {result.isArchived && <KitChip>archived</KitChip>}
          {kebabContextMenu.menu}
        </>
      }
      menu={
        showKebab ? (
          <RowKebabMenu
            testId={`conversation-search-archived-row-kebab-${result.identityKey}-${result.hostId}`}
            ariaLabel={`Row menu for ${result.identityKey}`}
            items={kebabItems}
          />
        ) : undefined
      }
    />
  );
}
