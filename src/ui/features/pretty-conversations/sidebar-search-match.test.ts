// shape-sidebar-search-inline: pure-function coverage for the sidebar-search
// helpers. These tests intentionally avoid mounting the panel — they exercise
// the string-extraction + substring-match logic in isolation so any future
// candidate-set change breaks here first (fast signal) before propagating to
// the integration tests in PrettyConversationsPanel.test.tsx.

import { describe, it, expect } from "vitest";
import {
  getRowCandidateStrings,
  rowMatchesSearchQuery,
  appTileMatches,
  resolveIdentityForRow,
} from "./sidebar-search-match";
import type { ConversationRow } from "@/state/conversation-store";
import type { Identity } from "@/api/identities-api";
import type { Host } from "@/types/ui-types";

// Minimal fixtures — only fields the helpers touch.
function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    id: "1",
    name: "t1000",
    username: "ubuntu",
    ip: "100.99.149.8",
    port: 22,
    folder: "/home/ubuntu",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "key",
    enableTerminal: true,
    ...overrides,
  } as Host;
}

function makeRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "row-1",
    type: "harness",
    label: "samwise",
    host: makeHost(),
    targetTmuxSession: "samwise",
    role: "box-maintainer",
    ...overrides,
  } as ConversationRow;
}

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    identityKey: "samwise",
    displayName: "Samwise",
    title: null,
    colorHue: 324,
    voice: null,
    role: "box-maintainer",
    avatarMime: "image/webp",
    avatarUrl: "/x",
    avatarEtag: "e",
    coordinator: false,
    task: null,
    project: null,
    ...overrides,
  } as Identity;
}

describe("getRowCandidateStrings", () => {
  it("includes row.label, host.name, host.username, and role", () => {
    const row = makeRow({
      label: "samwise",
      host: makeHost({ name: "t1000", username: "ubuntu" }),
      role: "box-maintainer",
    });
    const out = getRowCandidateStrings(row, null);
    expect(out).toContain("samwise");
    expect(out).toContain("t1000");
    expect(out).toContain("ubuntu");
    expect(out).toContain("box-maintainer");
  });

  it("includes identity.displayName AND identity.task even when task would be primary-line", () => {
    const row = makeRow({ label: "samwise" });
    const identity = makeIdentity({
      displayName: "Samwise",
      task: "Sidebar search redesign — variant E",
    });
    const out = getRowCandidateStrings(row, identity);
    // Both must be candidates — typing the identity name still matches when
    // the task is what's currently on the primary line (and vice versa).
    expect(out).toContain("Samwise");
    expect(out).toContain("Sidebar search redesign — variant E");
  });

  it("includes identity.title and roleDefaults.displayName", () => {
    const row = makeRow();
    const identity = makeIdentity({
      title: "Skynet",
      role: "box-maintainer",
      roleDefaults: { displayName: "Box Maintainer" },
    });
    const out = getRowCandidateStrings(row, identity);
    expect(out).toContain("Skynet");
    expect(out).toContain("Box Maintainer");
  });

  it("includes row.roomTitle for relay-room rows", () => {
    const row = makeRow({ kind: "relay-room", roomTitle: "planning discussion" });
    const out = getRowCandidateStrings(row, null);
    expect(out).toContain("planning discussion");
  });

  it("includes the DISPLAY form of row.role (title-cased) even when identity is null — /close code-review", () => {
    // Rows whose identity hasn't yet resolved from the store carry the raw
    // role slug on row.role but no Identity. A user typing the human-readable
    // role name ("Box Maintainer") must still hit — the display form is a
    // candidate too, not just the raw slug.
    const row = makeRow({ role: "box-maintainer" });
    const out = getRowCandidateStrings(row, null);
    expect(out).toContain("box-maintainer");
    expect(out).toContain("Box Maintainer");
  });

  it("skips null / undefined / empty-string fields silently", () => {
    const row = makeRow({ label: "samwise", role: null });
    const identity = makeIdentity({ task: null, title: null });
    const out = getRowCandidateStrings(row, identity);
    // Nothing empty should slip in — every string is non-empty.
    for (const s of out) {
      expect(s.length).toBeGreaterThan(0);
    }
  });
});

describe("rowMatchesSearchQuery", () => {
  const row = makeRow({
    label: "samwise",
    host: makeHost({ name: "t1000", username: "ubuntu" }),
    role: "box-maintainer",
  });
  const identity = makeIdentity({
    displayName: "Samwise",
    task: "Sidebar search redesign",
  });

  it("returns true for empty / whitespace-only queries (no filter active)", () => {
    expect(rowMatchesSearchQuery(row, identity, "")).toBe(true);
    expect(rowMatchesSearchQuery(row, identity, "   ")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(rowMatchesSearchQuery(row, identity, "SAMWISE")).toBe(true);
    expect(rowMatchesSearchQuery(row, identity, "samwise")).toBe(true);
    expect(rowMatchesSearchQuery(row, identity, "SamWise")).toBe(true);
  });

  it("does substring matching (not word-boundary or exact)", () => {
    expect(rowMatchesSearchQuery(row, identity, "wise")).toBe(true);
    expect(rowMatchesSearchQuery(row, identity, "maint")).toBe(true);
  });

  it("matches the identity name even when task would be the primary-line", () => {
    // Row where task takes over primary line — but "samwise" should still match.
    expect(rowMatchesSearchQuery(row, identity, "samwise")).toBe(true);
  });

  it("matches the task string too", () => {
    expect(rowMatchesSearchQuery(row, identity, "redesign")).toBe(true);
  });

  it("matches the host name and role", () => {
    expect(rowMatchesSearchQuery(row, identity, "t1000")).toBe(true);
    expect(rowMatchesSearchQuery(row, identity, "box-maintainer")).toBe(true);
  });

  it("returns false when no candidate contains the query", () => {
    expect(rowMatchesSearchQuery(row, identity, "nonexistent")).toBe(false);
    expect(rowMatchesSearchQuery(row, identity, "xyzzy")).toBe(false);
  });

  it("trims the query before comparing", () => {
    expect(rowMatchesSearchQuery(row, identity, "  samwise  ")).toBe(true);
  });

  it("matches the display form of a row's role even without a resolved identity — /close code-review", () => {
    // Identity has not resolved yet from the store; row still carries the
    // raw role slug on row.role. Typing "Box Maintainer" must hit via the
    // display-form candidate (getRowCandidateStrings pushes roleDisplayName
    // of row.role even when identity is null).
    const rowOnly = makeRow({ role: "box-maintainer" });
    expect(rowMatchesSearchQuery(rowOnly, null, "Box Maintainer")).toBe(true);
    expect(rowMatchesSearchQuery(rowOnly, null, "box maintainer")).toBe(true);
  });
});

describe("appTileMatches", () => {
  it("returns true for empty query", () => {
    expect(appTileMatches("grafana", "")).toBe(true);
  });
  it("case-insensitive substring match", () => {
    expect(appTileMatches("Grafana Dashboard", "graf")).toBe(true);
    expect(appTileMatches("Grafana Dashboard", "DASH")).toBe(true);
  });
  it("returns false for non-match", () => {
    expect(appTileMatches("Grafana Dashboard", "kibana")).toBe(false);
  });
});

describe("resolveIdentityForRow", () => {
  const alice = makeIdentity({ identityKey: "alice", displayName: "Alice", hostId: 1 });
  const aliceOnHost2 = makeIdentity({ identityKey: "alice", displayName: "Alice-on-2", hostId: 2 });
  const bob = makeIdentity({ identityKey: "bob", displayName: "Bob" });

  const byHostKey = new Map<string, Identity>([
    ["1::alice", alice],
    ["2::alice", aliceOnHost2],
  ]);
  const byKey = new Map<string, Identity>([
    ["alice", alice],
    ["bob", bob],
  ]);

  it("returns null for relay-room rows (no identity backing)", () => {
    const row = makeRow({ kind: "relay-room", targetTmuxSession: "some-key" });
    expect(resolveIdentityForRow(row, byHostKey, byKey)).toBeNull();
  });

  it("prefers host-scoped map to disambiguate cross-host identity name collisions", () => {
    const rowOnHost2 = makeRow({
      host: makeHost({ id: "2" }),
      targetTmuxSession: "alice",
    });
    expect(resolveIdentityForRow(rowOnHost2, byHostKey, byKey)).toBe(aliceOnHost2);
  });

  it("falls back to unscoped map when host-scoped lookup misses", () => {
    const row = makeRow({
      host: makeHost({ id: "99" }), // no entry in byHostKey for host 99
      targetTmuxSession: "bob",
    });
    expect(resolveIdentityForRow(row, byHostKey, byKey)).toBe(bob);
  });

  it("returns null when neither map has the identity", () => {
    const row = makeRow({ targetTmuxSession: "unknown-agent" });
    expect(resolveIdentityForRow(row, byHostKey, byKey)).toBeNull();
  });

  it("returns null when targetTmuxSession is null (no lookup key)", () => {
    const row = makeRow({ targetTmuxSession: null });
    expect(resolveIdentityForRow(row, byHostKey, byKey)).toBeNull();
  });
});
