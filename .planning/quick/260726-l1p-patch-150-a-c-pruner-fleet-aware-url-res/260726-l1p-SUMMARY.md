---
quick_id: 260726-l1p
mode: quick
type: summary
branch: feat/tab-title-from-tmux
autonomous: true
files_modified:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.test.ts
  - src/ui/AppShell.tsx
tags: [skynet, fork-tina, patch-150, pinner-fleet, url-restore, glow, active-set]
completed_date: 2026-07-26
outcome: shipped
commits:
  - hash: 7f63a4b
    subject: "patch #150 A: pruner fleet-aware — updateOpenTabs no longer nukes legitimate fleet-derived pinnedIds"
  - hash: b48023e
    subject: "patch #150 C investigate: URL-restore multi-tab click-to-load path"
  - hash: 162dc1c
    subject: "patch #150 C: URL-restore multi-tab glow — iterate all restoredTabs, not just [0]"
investigation_verdict: SAME_BUG
task_4_status: SKIPPED (per SAME_BUG verdict — Task 3 covers both symptoms)
---

# Quick task 260726-l1p — patch #150 A + C (SUMMARY)

## Commits landed (3, all on feat/tab-title-from-tmux)

| # | Hash | Subject |
|---|------|---------|
| 1 | `7f63a4b` | patch #150 A: pruner fleet-aware — updateOpenTabs no longer nukes legitimate fleet-derived pinnedIds |
| 2 | `b48023e` | patch #150 C investigate: URL-restore multi-tab click-to-load path |
| 3 | `162dc1c` | patch #150 C: URL-restore multi-tab glow — iterate all restoredTabs, not just [0] |

No Co-Authored-By trailer on any commit (fork convention held — verified via `git log ... | grep -c Co-Authored-By` = 0).

## Task 2 investigation verdict: **SAME_BUG**

Both of Ashley's followup-3 UAT symptoms (2026-07-24) — (a) only ONE restored tab glowed with `.active-set`, and (b) the un-glowed tab "did NOT auto-load its content, had to wait" — collapse to a single root cause in the persisted-tab-restore branch: only `restoredTabs[0]` was routed through any store-side signal.

**Mechanism traced end-to-end** (in the inline C-investigate comment block at AppShell.tsx L825-861, and repeated in the b48023e commit body):

1. `selectConversationDeferred(restoredTabs[0].id)` at synchronous call time parks the id in `pendingSelectId` because `state.openTabs` is still empty (the `setTabs` call above is batched — React commit hasn't fired yet).
2. React commit fires → the `useEffect(() => updateOpenTabs(tabs), [tabs])` at AppShell.tsx:427 runs → the pending-flush block at `conversation-store.ts:530-533` sets `state.selectedId = restoredTabs[0].id`. **The flush does NOT call `addToActiveSet`** — only the `selectedId` slot moves.
3. `PrettyConversationsPanel.tsx:162-164`'s useEffect on `selectedId` change fires → `addToActiveSet(selectedId)` → `restoredTabs[0]` glows.
4. Every OTHER restoredTabs entry is invisible to this chain: no `pendingSelectId` write for them, no `selectedId` flip, no `addToActiveSet` reach.

**Content-load pathway (why the un-glowed tab also "didn't load"):** Every tab in `tabs` mounts via the `createPortal` loop at AppShell.tsx ~L1598-1626 regardless of selection. But `Terminal.tsx`'s WebSocket-connect effect at L2800-2831 is gated on `isVisible = tab.id === effectiveSelectedTabId`. Only the focused tab is `isVisible=true`, so only its `restoredSessionId` reconnects at mount. **This is CORRECT behavior** — we do not want to prefetch N WebSocket handshakes at restore time. When Ashley clicks the un-glowed row, `selectConversation(row.id)` fires from `PrettyConversationsPanel.tsx:208`, `addToActiveSet` gives glow, the mirror effect at AppShell L510-519 sets `activeTabId`, `effectiveSelectedTabId` flips, `isVisible=true`, the connect effect fires. **That IS the load.** The "had to wait" perception is WebSocket handshake latency (~100-500ms), not a distinct bug.

**Task 4 (#150 D) status: SKIPPED.** No separate click-to-load bug exists; Task 3's fix covers both symptoms via the store-level per-tab `addToActiveSet` primitive.

## Task 3 fix approach (locked by the C-investigate comment)

- **Per-tab `addToActiveSet(t.id)` loop** over `restoredTabs` — the correct primitive because it is idempotent AND does NOT disturb `selectedId`.
- **Retained** `setActiveTabId(restoredTabs[0].id)` + `selectConversationDeferred(restoredTabs[0].id)` — preserves the "first restored tab is focused" contract.
- **Rejected alternative** (documented in the commit body): looping `selectConversationDeferred` per tab would only ever flush the FINAL id (pendingSelectId is last-write-wins) OR would delegate to `selectConversation` and move `selectedId` to the last one — fighting the retained `setActiveTabId`. `addToActiveSet` sidesteps both hazards.

## Verification results

| Check | Result |
|-------|--------|
| `npm run type-check` after each task | clean (all 3 tasks) |
| `npx vitest run src/ui/state/conversation-store.test.ts` after Task 1 | 43/43 pass (was 41 pre-plan; +2 new `patch #150 A` regression tests) |
| Same suite after Task 3 | 44/44 pass (+1 new `patch #150 C` two-URL-tab-restore test) |
| `npx vitest run src/ui/features/pretty-conversations/` after Task 3 | 38/38 pass (no regression in the addToActiveSet consumer) |
| Grep for `patch #150` anchor comments across touched files | 6 anchors (spec required ≥3) |
| Git working tree at end | clean; on `feat/tab-title-from-tmux`; no new branch created |
| Co-Authored-By trailer check across the 3 new commits | 0 (fork convention held) |
| `git log origin/…..feat/tab-title-from-tmux --oneline` | 3 new commits unpushed as expected |
| Write to `~/.claude/identities/tina/skynet-patches.md` | none (batch-writeups-until-deploy rule honored) |
| Deploy attempts | none (deploy timing is the orchestrator's decision) |

### Test file details

**Task 1 (patch #150 A) tests** — inserted after the `"session-end lifecycle"` describe block per plan §context, in a new describe block titled `"conversation-store: pruner fleet-aware (patch #150 A)"`:
- `"clicking a pinned fleet row does NOT unpin OTHER pinned fleet rows"` — the load-bearing bug reproducer. Setup: 2 hosts × 4 fleet sessions all synthesized as `fleet::N::S` ids, all four pinned via `pinConversation`. Exercise: `updateOpenTabs([makeTab("t1", "terminal", hostA)])` (unrelated openTab). Pre-fix: `pinnedIds.size` was 0 (all pins nuked). Post-fix: `pinnedIds.size === 4`, all four fleet ids present.
- `"clicking an openTab row still prunes stale openTab pins as before (regression guard)"` — proves the fix doesn't over-preserve. `fleetSessions` empty per `beforeEach`, so any pruned openTab id must NOT be kept. Passes both pre- and post-fix.

**Task 3 (patch #150 C) test** — appended at the end of the file in a new describe block titled `"conversation-store (patch #150 C): two-URL-tab restore glows both restored tabs"`:
- `"per-tab addToActiveSet after updateOpenTabs lights BOTH tabs in activeSet"` — mirrors the fixed AppShell sequence: `updateOpenTabs([tabA, tabB])` + `addToActiveSet("restored-a")` + `addToActiveSet("restored-b")` + `selectConversationDeferred("restored-a")`. Asserts both ids are in `useActiveSet()` and `selectedId === "restored-a"` (focus contract preserved). Passes trivially today (the store contract works; the bug was in AppShell); will fail if the store contract underneath the C-investigate mechanism ever regresses.

## Anti-scope-creep temptations (none surfaced)

None. Each change stayed inside its named function/branch. Explicitly held boundaries per the plan's anti-patterns list:
- Did NOT re-add an openTabs guard to `pinConversation` (would revert #149 A).
- Did NOT touch `computeSnapshot` fleet-row synthesis at L293-312.
- Did NOT touch RDP-row synthesis at L440-472.
- Did NOT touch the URL-driven initial-open branch at AppShell L849-903 (already correct via `openedIds` + `activeIndex`).
- Did NOT touch the tab-restore data-loading loop at AppShell L722-822 (that's the "what to restore" phase; the fix is in "what to focus/glow" phase).
- Did NOT touch: settings modal, AppRail, dashboard, snippets, host-manager UI, admin console, file-manager, top-level Skynet chrome, keyboard-shortcut editor.

Files touched exactly match the plan's `files_modified` frontmatter list:
- `src/ui/state/conversation-store.ts` (pruner fleet-aware, patch #150 A)
- `src/ui/state/conversation-store.test.ts` (2 new tests for #150 A + 1 new test for #150 C)
- `src/ui/AppShell.tsx` (1-line import + C-investigate comment block + patch #150 C loop with anchor comment)

## Confirmation of what did NOT happen

- **No push** — commits are local only; `git log origin/feat/tab-title-from-tmux..feat/tab-title-from-tmux` shows exactly the 3 new commits + the pre-dispatch plan doc unpushed.
- **No build** — the plan's verify steps only ran `type-check` + vitest; no `npm run build`, no `docker compose` invocation.
- **No deploy** — see above.
- **No `~/.claude/identities/tina/skynet-patches.md` write** — deferred to the deploy-batch write-up per Ashley 2026-07-23 batch-writeups-until-deploy rule.

## Deploy recommendation to the orchestrator

**RECOMMEND SOLO-DEPLOY CARVEOUT for followup-1 (#150 A).**

Reasoning:
- **#150 A is actively broken in production** (Ashley's fleet-panel pin workflow: pin 4-5 fleet rows → single click nukes all pins). Per the plan's shape, this is production-broken behavior blocking Ashley's daily workflow. The three-tier sort (patch #149 B+C) that Ashley loves specifically depends on fleet rows being pinnable AND surviving activation clicks — right now #149 B+C is silently degraded by the #150 A bug.
- **#150 C** cleans up a visual regression from #145 that leaves Ashley uncertain which of her restored tabs are "live". Medium priority, but bundling it with #150 A saves a deploy round-trip and both are surgical.
- Nothing concerning surfaced during Task 1 — the fix is minimally-scoped (one function, one micro-guard, one new keep-set), the two regression tests exhaustively pin both directions of the pruner contract (keep fleet, still drop stale), and the pre-existing 41 conversation-store tests + 38 pretty-conversations tests all remained green throughout.
- The 15-min deadman rollback timer is standing constraint per Ashley 2026-07-03 — recommendation is to deploy behind that timer, not without.

Solo-deploy = ship #150 A + #150 C investigate + #150 C together (they're one plan on one branch — atomic from the deploy's perspective). Batch with any newer patches Ashley greenlights, but do NOT sit on #150 A waiting for a bigger batch.
