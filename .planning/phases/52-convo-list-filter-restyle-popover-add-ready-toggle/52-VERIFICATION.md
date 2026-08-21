---
phase: 52-convo-list-filter-restyle-popover-add-ready-toggle
verified: 2026-08-21T05:20:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
---

# Phase 52: Convo-list filter — restyle popover + add Ready toggle — Verification Report

**Phase Goal (from ROADMAP.md:1379):** Restyle the pretty-conversations filter popover to match the panel's menu vocabulary (glass chrome + inline-SVG check affordance mirroring PrettyConversationContextMenu + the three-dots MoreVertical menu), retire the shadcn Checkbox / .pv-filter-toggle-row markup, and add a third filter toggle "Ready" whose predicate is `!isWorking && !dormant` (real supervisor-dormancy signal). Ready extends `anyFilterOn`, participates in AND-intersection with Pinned + Needs-desk, and skips the RDP zone.

**Verified:** 2026-08-21T05:20:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (12 verification questions)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| Q1 | Dormant is a real supervisor signal end-to-end (wire → poll → working-store → row) | VERIFIED | wire-protocol.ts:173 `dormant: z.boolean().nullable().optional()`; ssh-poll-orchestrator.ts source A at :726-737 (stat `.dormant` per PID-tick with fail-open cache) + source B at :553-628 (`pollDormantOnlyIdentities` enumerates `~/.claude/identities/*/` and publishes for dormant-only identities keyed by identityName, `sessionId:"__dormant__"`, `pid:null`); AppShell.tsx:450/460 forwards to `publishFleetStatusSessionState`; session-working-store.ts:238-266 Axis D block mirrors `dormant` into WorkingRecord; PrettyConversationsPanel.tsx:645-669 builds `rowSessionStates` map via `getSessionWorkingSnapshot`; matchesFilterForRow at :686-710 reads `rowState.isDormant`. Fail-CLOSED on undefined rowState at :707. |
| Q2 | Popover chrome byte-equivalent to three-dots menu + context menu | VERIFIED | PrettyConversationsPanel.tsx:1266-1283 filter popover inline style has: `padding: 4`, `borderRadius: 12`, `background: "linear-gradient(160deg, rgba(20,21,32,0.94), rgba(10,11,18,0.94))"`, `border: "1px solid rgba(255,240,215,0.12)"`, `boxShadow: "0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,240,215,0.08)"`, `backdropFilter: "blur(20px) saturate(1.6)"`, `WebkitBackdropFilter: "blur(20px) saturate(1.6)"`, `color: "#e8e4d8"`, `minWidth: 200`, `width: "auto"`. Three-dots menu at :1777-1782 has byte-identical `borderRadius: 12`, `background: "linear-gradient(160deg, rgba(20,21,32,0.94), rgba(10,11,18,0.94))"`, `border: "1px solid rgba(255,240,215,0.12)"`, `boxShadow: "0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,240,215,0.08)"`, `backdropFilter: "blur(20px) saturate(1.6)"`, `WebkitBackdropFilter: "blur(20px) saturate(1.6)"`. The `width: "auto"` is the W-1 fix overriding shadcn's hardcoded `w-72` from popover.tsx. |
| Q3 | Three `role="menuitemcheckbox"` buttons for Ready · Pinned · Needs desk with outlined-square check affordance + inline SVG path `M3.5 8.5 L7 12 L13 5` (not unicode) | VERIFIED | PrettyConversationsPanel.tsx:1290-1334 renders three buttons in order Ready → Pinned → Needs desk, all with `role="menuitemcheckbox"`, each carrying `<span className="pv-filter-check" data-checked={...}>` containing `<svg viewBox="0 0 16 16"><path d="M3.5 8.5 L7 12 L13 5" /></svg>`. Zero unicode `✓` glyphs anywhere in the popover markup. Testids: `pv-filter-toggle-ready`, `pv-filter-toggle-pinned`, `pv-filter-toggle-needs-desk`. CSS at pretty-conversations.css:257-286 renders the 16×16 square, warm-cream border rgba(255,240,215,0.32), amber-fill on `data-checked="true"` at rgba(255,220,170,0.22). |
| Q4 | Ready predicate is fail-CLOSED — forbidden pattern `!rowState?` absent | VERIFIED | `grep -c "!rowState?" PrettyConversationsPanel.tsx` returns 0. Actual predicate at line 707: `const readyOk = !readyOnly || (rowState !== undefined && !rowState.isWorking && !rowState.isDormant);` — explicit undefined check, no optional chaining. Test P50-6b (line 3929) exercises the fail-CLOSED path: row with NO working-store seed is HIDDEN when readyOnly is on. |
| Q5 | `anyFilterOn` extends to `readyOnly` | VERIFIED | PrettyConversationsPanel.tsx:598 `const anyFilterOn = readyOnly || pinnedOnly || needsDeskOnly;` (Ready leftmost per V2 snippet). `.pv-filter-dot` at :1258 renders on `anyFilterOn && ...`. Test P50-7 (line 3954) locks this behavior. |
| Q6 | RDP-group rows pass through unfiltered | VERIFIED | PrettyConversationsPanel.tsx:734 `const displayedRdpGroup = rdpGroup;` — no `.filter(matchesFilterForRow)` on the RDP group. Only `displayedPinned` (line 728) and `displayedMiddle` (line 731) apply the filter. Test P50-8 (line 3972) locks this. |
| Q7 | Pinned + Needs-desk predicates preserved | VERIFIED | PrettyConversationsPanel.tsx:696-697 `pinnedOk = !pinnedOnly || (pair !== undefined && pair.pinnedCount > 0)` and `needsDeskOk = !needsDeskOnly || (pair !== undefined && pair.needsDeskCount > 0)` — same predicates as pre-Phase-52. AND-intersection at line 708 `return readyOk && pinnedOk && needsDeskOk;`. |
| Q8 | 10 P50 tests present (P50-1..P50-9 + P50-6b) with fail-CLOSED lock (P50-6b) | VERIFIED | `grep -cE 'it\("P50-'` returns 10. All 10 P50 tests present in PrettyConversationsPanel.test.tsx at lines 3786, 3832, 3848, 3870, 3891, 3910, 3929 (P50-6b, fail-CLOSED lock — description contains string "fail-CLOSED"), 3954, 3972, 4002. Describe block header at line 3754: "Phase 52 — filter popover restyle + Ready toggle". |
| Q9 | Full-suite green: `npx vitest run` + `npm run build:backend` both clean | VERIFIED | Re-run this verification session: `npx vitest run` → **Test Files 201 passed (201), Tests 2692 passed | 9 skipped | 1 todo (2702)**, exit 0, duration 444s. `npm run build:backend` → exit 0. `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel` → 4/4 files, 101/101 tests pass. `npx vitest run src/backend/fleet-status` → 10/10 files, 159/159 tests pass. |
| Q10 | Retired: `.pv-filter-toggle-row`, shadcn Checkbox, unicode ✓ glyph | VERIFIED | `grep -c "pv-filter-toggle-row" PrettyConversationsPanel.tsx pretty-conversations.css` → 0 each. Shadcn Checkbox import removed from Panel.tsx (per Plan 02 summary). No unicode ✓ glyphs anywhere in the filter popover; all three items render inline SVG path. |
| Q11 | `FRAME_SCHEMA_VERSION` NOT bumped (additive-optional pattern preserved) | VERIFIED | wire-protocol.ts:14 `export const FRAME_SCHEMA_VERSION = 1 as const;` — unchanged. `dormant` field at line 173 is `.optional().nullable()` per T-41-03-05 mitigation reused (third time: lastMessageAt → aiTitle → dormant). |
| Q12 | Commits exist for all 4 plans | VERIFIED | `git log --oneline` shows `06b07a70` (52-01 T1), `e4fee281` (52-01 T2 source A), `edf36d38` (52-01 T3 source B), `6ce685a1` (52-02 CSS), `7b7027e0` (52-02 markup), `77066429` (52-03 Ready predicate), `9fc17534` (52-04 P50 tests), plus `a5363a7b` fix(52-01) for Axis D preserve-on-absent. All present on `feat/tab-title-from-tmux`. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/fleet-status/wire-protocol.ts` | SessionStateSchema.dormant field + pid nullable | VERIFIED | Line 163 `pid: z.number().int().nullable()`, line 173 `dormant: z.boolean().nullable().optional()`, FRAME_SCHEMA_VERSION unchanged at 1. |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | source A `.dormant` stat + source B `pollDormantOnlyIdentities` | VERIFIED | Source A at :720-940 (derivedDormant stat + PidCacheEntry writeback + fingerprint axis); source B at :553-628 (pollDormantOnlyIdentities helper), :514 (invocation from pollOneHost), :185 (PerHostState.dormantOnlyIdentities), :1026 (factory init). |
| `src/ui/state/session-working-store.ts` | WorkingRecord.dormant + Axis D block + useSessionIsDormant hook | VERIFIED | Line 93 `dormant: boolean;`, lines 238-266 Axis D block (fires only on change, direct swap-and-notify), line 527 `export function useSessionIsDormant(key: string | null): boolean`. |
| `src/ui/features/pretty-conversations/pretty-conversations.css` | `.pv-filter-popover` marker rule + `.pv-filter-menu-item` + `.pv-filter-check` classes; `.pv-filter-toggle-row` retired | VERIFIED | Line 223 marker rule, lines 229-255 `.pv-filter-menu-item` block (hover rgba(255,240,215,0.08), active rgba(255,240,215,0.18)) with mobile-touch bump at 767.98px matching existing convention at :205, :1287, and :1333, lines 257-286 `.pv-filter-check` block (16×16 outlined square, data-checked drives amber fill + SVG opacity). `.pv-filter-toggle-row` absent. |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | Rewritten popover markup + readyOnly state + rowSessionStates map + Ready predicate | VERIFIED | Line 593 `const [readyOnly, setReadyOnly] = useState(false)`, line 598 anyFilterOn extension, lines 626-669 rowSessionStates dirty-flag cache pattern (fixes tearing-check re-render), lines 686-710 matchesFilterForRow fail-CLOSED Ready predicate, lines 1266-1334 rewritten popover markup with three menuitemcheckbox buttons. |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | 10 P50 tests + spy-based vi.mock factory | VERIFIED | Describe block at line 3754; 10 `it("P50-...")` blocks; vi.mock factory upgraded to spy-based per-test seeding via mockIsWorkingByKey / mockIsDormantByKey / mockWorkingSnapshot module-scoped Maps (lines 317-328). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| ssh-poll-orchestrator source A `processPid` | wire-protocol `SessionState.dormant` | `dormant: derivedDormant` in composed SessionState | WIRED | ssh-poll-orchestrator.ts:900/927/940 all include `dormant: derivedDormant`. Fingerprint at :425 appends dormant axis. |
| ssh-poll-orchestrator source B `pollDormantOnlyIdentities` | wire-protocol `SessionState.dormant=true` frame | `deps.registry.publishSessionState(host.id, {..., tmuxSession: name, dormant: isDormant, sessionId: "__dormant__", pid: null, ...})` | WIRED | ssh-poll-orchestrator.ts:615-628 constructs and publishes the source-B frame. |
| Backend `publishSessionState` | Frontend `publishFleetStatusSessionState` | WS frame propagation via subscription-registry + AppShell subscribers | WIRED | subscription-registry.ts:184 `publishSessionState`, AppShell.tsx:450/460 subscribes and calls `publishFleetStatusSessionState(state.hostId, state)`. |
| `publishFleetStatusSessionState` | WorkingRecord.dormant | Axis D block reads `state_arg.dormant` | WIRED | session-working-store.ts:249 `if (state_arg.dormant !== undefined) { const dormant = state_arg.dormant === true; ...` writes to `nextMap` and notifies. |
| Panel `rowSessionStates` | working-store snapshot | `useSyncExternalStore(subscribeSessionWorkingStore, () => getSessionWorkingSnapshot() ...)` with dirty-flag cache | WIRED | PrettyConversationsPanel.tsx:626-669. Dirty-flag cache prevents tearing-check infinite re-render. |
| `matchesFilterForRow` | `rowSessionStates` map | `rowSessionStates.get(matchKey)` + fail-CLOSED predicate | WIRED | PrettyConversationsPanel.tsx:706-707. rowSessionStates listed in useMemo deps at line 710. |
| Filter markup | `pinnedOnly`/`needsDeskOnly`/`readyOnly` state | `onClick={setXOnly((v) => !v)}` + `aria-checked={xOnly ? "true" : "false"}` | WIRED | PrettyConversationsPanel.tsx:1290-1334 all three buttons wire click → state toggle → aria-checked. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full frontend + backend vitest suite passes | `npx vitest run` | 201/201 files, 2692 pass, 9 skip, 1 todo, exit 0, 444.15s | PASS |
| Pretty-conversations panel test suite passes (includes 10 P50 tests) | `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel` | 4/4 files, 101/101 tests pass, exit 0 | PASS |
| Fleet-status backend test suite passes (dormant source A + source B) | `npx vitest run src/backend/fleet-status` | 10/10 files, 159/159 tests pass, exit 0 | PASS |
| Backend TypeScript build clean | `npm run build:backend` | exit 0 | PASS |
| Forbidden fail-OPEN pattern absent | `grep -c "!rowState?" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 0 | PASS |
| Retired `.pv-filter-toggle-row` fully absent | `grep -c "pv-filter-toggle-row"` on Panel.tsx + CSS | 0 + 0 | PASS |
| 10 P50 tests present | `grep -cE 'it\("P50-' PrettyConversationsPanel.test.tsx` | 10 | PASS |

### Requirements Coverage

Phase 52 has no formal REQ IDs (feature phase, no pre-existing REQ tags). Roadmap sequence dependency on Phase 49 is not a code dependency per ROADMAP.md:1381.

### Anti-Patterns Found

None. Files scanned:
- `src/backend/fleet-status/wire-protocol.ts` — clean (no TBD/FIXME/XXX/HACK in modifications).
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — clean; contains `TODO` markers unrelated to Phase 52 (pre-existing).
- `src/ui/state/session-working-store.ts` — clean.
- `src/ui/features/pretty-conversations/pretty-conversations.css` — clean (only pre-existing debt markers in unrelated blocks).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — clean; contains `TODO` markers unrelated to Phase 52 (pre-existing).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — clean.

No stub returns, no empty implementations, no console.log-only handlers. The `sessionId: "__dormant__"` sentinel is documented and expected per Plan 01 Task 3 (T-52-01-06 accept).

### Human Verification Required

None. All observable truths are testable through automated integration tests (P50-1..P50-9 + P50-6b), and all wiring is grep-verifiable + build-clean. Visual UAT (chrome look matching three-dots menu at real viewport) is scoped to the orchestrator per plan 02's verification section and does NOT block this verification — the inline-style token snapshot has been asserted byte-for-byte against the reference three-dots menu at PrettyConversationsPanel.tsx:1777-1782 which is byte-identical.

### Gaps Summary

None. All 12 verification questions from the verification context return VERIFIED with concrete codebase evidence. The phase goal — restyled popover chrome + Ready toggle predicated on real supervisor dormancy signal end-to-end — is achieved and locked by 10 integration tests.

---

_Verified: 2026-08-21T05:20:00Z_
_Verifier: Claude (gsd-verifier)_
