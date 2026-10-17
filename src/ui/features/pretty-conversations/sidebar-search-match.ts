// shape-sidebar-search-inline: pure helpers for the sidebar-search filter.
//
// The user types in the sidebar-search input row; typing live-filters the
// sidebar rows against the union of every candidate string that COULD
// render on either of the row's two visible lines — not just what's on
// screen. These helpers are module-scoped + side-effect-free so task-7's
// unit tests can exercise them without mounting the panel.

import { identityRoles, identityRolesLabel } from "@/lib/identity-roles";
import type { ConversationRow } from "@/state/conversation-store";
import type { Identity } from "@/api/identities-api";
import { roleDisplayName } from "@/lib/role-display-name";
import { sessionMatchKey } from "@/features/terminal/session-hue";

/**
 * All strings that COULD render on either of a row's two visible lines,
 * regardless of which one is currently shown.
 *
 * For an identity conversation row:
 *   - primary-line candidates: identity.displayName AND identity.task
 *     (task takes the primary line when set; displayName is the fallback —
 *     both remain match targets so typing an identity name still hits when
 *     its task is what's rendered, and vice versa).
 *   - secondary-line candidates: role display names (every role in
 *     identityRoles(identity)) AND host.name AND identity.title.
 *
 * For a relay-room row: row.label + row.roomTitle (either can occupy the
 * primary line depending on state) + host.name (secondary).
 *
 * For an RDP host row (no identity): host.name (primary) + host.username
 * (secondary).
 */
export function getRowCandidateStrings(
  row: ConversationRow,
  identity: Identity | null,
): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    if (s && s.length > 0) out.push(s);
  };
  // Row-carried candidates (present on every row shape)
  push(row.label);
  push(row.roomTitle);
  push(row.host?.name);
  push(row.host?.username);
  push(row.role);
  // /close code-review 2026-09-29: also push the DISPLAY form of the row's
  // raw role slug so a query typed as the human-readable role name (e.g.
  // "Box Maintainer") matches rows whose identity has NOT yet resolved
  // from the identities-store — otherwise there's a resolution-race window
  // in which the raw kebab slug is the only candidate for role match.
  if (row.role) push(roleDisplayName(row.role, undefined));
  // Identity-carried candidates (harness rows with a resolved identity)
  if (identity) {
    push(identity.displayName);
    push(identity.task);
    push(identity.title);
    push(identity.roleDefaults?.displayName);
    // Multi-role: every role the identity holds is a match target, slug and
    // display form alike.
    for (const r of identityRoles(identity)) push(r);
    push(identityRolesLabel(identity));
  }
  return out;
}

/**
 * True when `rawQuery` (case-insensitive substring) is present in any of the
 * row's candidate strings. An empty / whitespace-only query is treated as
 * "no filter active" and matches every row.
 */
export function rowMatchesSearchQuery(
  row: ConversationRow,
  identity: Identity | null,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (q.length === 0) return true;
  const candidates = getRowCandidateStrings(row, identity);
  for (const c of candidates) {
    if (c.toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * Resolve the Identity object for a row using the two maps the panel already
 * carries. Mirrors PrettyConversationRow's lookup preference: prefer the
 * host-scoped map (`${hostId}::${key}`) to disambiguate cross-host identity
 * name collisions, fall back to the unscoped map keyed by identity key.
 *
 * Returns null for relay-room rows (no identity backing), for rows without
 * a resolvable session key, or when neither map contains the identity.
 */
export function resolveIdentityForRow(
  row: ConversationRow,
  byHostKey: ReadonlyMap<string, Identity> | undefined,
  byKey: ReadonlyMap<string, Identity> | undefined,
): Identity | null {
  if (row.kind === "relay-room") return null;
  const key = sessionMatchKey(row.targetTmuxSession);
  if (!key) return null;
  const hostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;
  if (Number.isFinite(hostIdNum)) {
    const scoped = byHostKey?.get(`${hostIdNum}::${key}`);
    if (scoped) return scoped;
  }
  return byKey?.get(key) ?? null;
}

/**
 * True when an app tile's name matches the query. Same substring rule.
 */
export function appTileMatches(name: string, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (q.length === 0) return true;
  return name.toLowerCase().includes(q);
}

/** Same case-insensitive substring rule as rows and app tiles. */
export function projectNameMatches(name: string, rawQuery: string): boolean {
  return appTileMatches(name, rawQuery);
}

type SearchableProjectSection<R> = {
  slug: string;
  hostId?: string;
  displayName: string;
  rows: R[];
  parentKey?: string | null;
};

/**
 * Apply the sidebar search to the project tree (sections in tree order).
 *
 *   - A project whose name matches shows itself, every project beneath it,
 *     and all their conversations (rows unfiltered).
 *   - Elsewhere rows filter individually through `rowMatches`.
 *   - A project shows if it is in a name-matched subtree, has a matching
 *     row, or has a shown descendant — so every shown project's ancestors
 *     are shown too, as the path down to it.
 * Returns the shown sections in their original (tree) order. An empty query
 * returns the input untouched.
 */
export function searchProjectSections<
  R,
  S extends SearchableProjectSection<R>,
>(
  sections: readonly S[],
  rowMatches: (row: R) => boolean,
  rawQuery: string,
): S[] {
  if (rawQuery.trim().length === 0) return sections.slice();
  const keyOf = (s: S) => `${s.hostId ?? ""}::${s.slug}`;
  const byKey = new Map<string, S>();
  for (const s of sections) byKey.set(keyOf(s), s);
  const parentOf = (s: S): S | null => {
    const pk = s.parentKey ?? null;
    return pk !== null ? (byKey.get(pk) ?? null) : null;
  };

  // In a name-matched subtree: the project or any ancestor matches. Walks
  // are bounded by a seen-set (the store already resolves loops away).
  const inMatchedSubtree = (s: S): boolean => {
    const seen = new Set<string>();
    let cur: S | null = s;
    while (cur !== null && !seen.has(keyOf(cur))) {
      if (projectNameMatches(cur.displayName, rawQuery)) return true;
      seen.add(keyOf(cur));
      cur = parentOf(cur);
    }
    return false;
  };

  const filtered = new Map<string, S>();
  const shown = new Set<string>();
  for (const s of sections) {
    const whole = inMatchedSubtree(s);
    const rows = whole ? s.rows : s.rows.filter(rowMatches);
    filtered.set(keyOf(s), { ...s, rows });
    if (whole || rows.length > 0) {
      // Show it and its whole ancestor path.
      let cur: S | null = s;
      while (cur !== null && !shown.has(keyOf(cur))) {
        shown.add(keyOf(cur));
        cur = parentOf(cur);
      }
    }
  }
  return sections
    .filter((s) => shown.has(keyOf(s)))
    .map((s) => filtered.get(keyOf(s))!);
}
