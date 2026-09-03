---
phase: quick-260903-vnu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
autonomous: true
requirements:
  - QUICK-260903-VNU
must_haves:
  truths:
    - "Clicking a row in the Hidden section opens the session (selectConversation fires for plain rows; onRdpRowClick/onDetachedRowClick fire for their branches) AND onConversationSelected fires."
    - "Clicking a row in the Hidden section does NOT call unhideConversation — the row stays in hiddenIds and the Hidden section still contains it after the click."
    - "The context-menu Hide/Unhide flow (handleToggleHide) still toggles hiddenIds correctly (unchanged)."
    - "Pinning a hidden row via context menu still auto-unhides before pinning (handleTogglePin at line 1188 is untouched)."
  artifacts:
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "handleRowSelect with the auto-unhide branch removed; comment above cites Ashley 2026-09-03 flip of quick-260731-tgg."
      contains: "handleRowSelect"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx"
      provides: "Regression test in the Hide/Show wiring describe block asserting click-on-hidden-row does not call unhideConversationSpy but DOES call selectConversationSpy + onConversationSelected."
      contains: "clicking a hidden row"
  key_links:
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx handleRowSelect"
      to: "hiddenIds store"
      via: "read-only — no mutation on click path"
      pattern: "handleRowSelect[\\s\\S]{0,400}selectConversation"
---

<objective>
Fix: clicking a row in the Hidden section of the pretty-conversations panel currently auto-unhides the row before routing the click. The synchronous store mutation re-renders the Hidden section, moves the row's DOM element out from under the cursor, and (a) violates the "hidden means hidden" semantic Ashley re-asserted 2026-09-03 and (b) races the click handler so the session sometimes never opens.

Root cause: two lines inside `handleRowSelect` at src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:974-975 — a `hiddenIds.has(row.id)` guard that calls `unhideConversation(row.id)` before the routing branches. This is a deliberate flip of the prior `quick-260731-tgg` design decision.

Purpose: honor Ashley 2026-09-03: hidden means hidden. Clicking a hidden row opens the session without changing hidden status. Kills both symptoms (wrong semantic + click-race navigation failure) with one edit.

Output: 2 files modified (source + test), one atomic commit, deployed to term.gigaashley.click with HTTPS 200 verification.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Remove auto-unhide from handleRowSelect + add regression test (RED-then-GREEN, single atomic commit)</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <behavior>
    - New test in the existing `describe("PrettyConversationsPanel: Hide/Show wiring (quick-260731-tgg)", ...)` block (test file line 2420-2576), placed as Test (n) after Test (j). Name it: `Test (n) [Ashley 2026-09-03 flip of quick-260731-tgg]: clicking a hidden row calls selectConversation + onConversationSelected but does NOT call unhideConversation`.
    - Setup: seed one plain (non-rdp, non-fleet) row via `makeConversationRow({ id: "hidden-row-n", label: "hidden-n", host: hostA })` in the `grouped` tier with `hiddenIds: new Set(["hidden-row-n"])`. Follow the exact pattern of Test (h) at line 2471 — seeding the row into `grouped` even though it's hidden, and expanding the Hidden chip so the row's `[data-conversation-id]` element is queryable.
    - The Hidden section is collapsed by default (see Test (b) at line 2258 and Test (c) at line 2289). To make the hidden row clickable, first `fireEvent.click(container.querySelector('[data-testid="hidden-divider"]'))` to expand it (mirror Test (c) at lines 2302-2308).
    - Render with `onConversationSelected={vi.fn()}` captured in a local variable so the test can assert it fires with `"hidden-row-n"`.
    - Action: query the row body via `container.querySelector('[data-conversation-id="hidden-row-n"]')` then `.querySelector('[role="button"]')`, then `fireEvent.click(body)`.
    - Assert 1 (semantic): `expect(unhideConversationSpy).not.toHaveBeenCalled()` — the fleet-critical invariant. Hidden rows stay hidden on click.
    - Assert 2 (navigation): `expect(selectConversationSpy).toHaveBeenCalledWith("hidden-row-n")` and `expect(onConversationSelected).toHaveBeenCalledWith("hidden-row-n")` — proves the session-open path still fires end-to-end.
    - Test (f) at line 2375 already asserts `unhideConversationSpy` is called on the PIN path — that test remains green (we are not touching handleTogglePin at line 1188). Do not modify Test (f). The two tests together lock the invariant: unhide-on-pin YES, unhide-on-click NO.
  </behavior>
  <action>
    Do both edits in one task, one atomic commit. Order (RED-first ceremony optional per constraints; recommended single-commit for one-line fix):

    STEP 1 — Source edit in src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:
    - Locate `handleRowSelect` at line 973.
    - DELETE line 974 (`// quick-260731-tgg: opening a hidden row auto-unhides it before routing.`) and line 975 (`if (hiddenIds.has(row.id)) unhideConversation(row.id);`).
    - REPLACE with a new leading comment inside the function body that reads:
      `// Ashley 2026-09-03 [inverts quick-260731-tgg]: hidden means hidden.`
      `// Clicking a hidden row opens the session WITHOUT mutating hiddenIds.`
      `// Two reasons: (1) semantic — "hidden" is a user-controlled bucket, only`
      `// the explicit Unhide context-menu action (handleToggleHide) should change`
      `// it; (2) race — the prior synchronous unhide re-rendered the Hidden`
      `// section, shifted the row's DOM out from under the cursor mid-click, and`
      `// sometimes swallowed the routing branch entirely so the session never`
      `// opened. Note: handleTogglePin (line ~1188) still unhides-before-pin`
      `// because pinning is promotion — that path is intentional and untouched.`
    - Leave every other line of `handleRowSelect` (lines 976-989) verbatim: `addToActiveSet`, the `row.rdpHostRow` branch, the `row.fleetOnly` branch, the default `selectConversation` + `onConversationSelected` fire.
    - Do NOT modify the `unhideConversation` import or the `useUnhideConversation`-adjacent store subscription — other callers (handleTogglePin, handleToggleHide) still need it.
    - Do NOT touch `hiddenIds` in the closure — `handleRowSelect` no longer reads it, but other handlers in the same component (handleTogglePin at 1188, handleToggleHide at 1207) still do. Leaving the `hiddenIds` subscription in place is correct.

    STEP 2 — Test edit in src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx:
    - Insert Test (n) inside the existing `describe("PrettyConversationsPanel: Hide/Show wiring (quick-260731-tgg)", ...)` block. Best insertion point: immediately after Test (j) closes (around line 2564, before the comment block at 2566 that documents the deleted (k)/(l)/(m) tests). Placing it there keeps all click-on-hidden semantics tests contiguous.
    - Structure (follow Test (c) at line 2289 for the "expand then click" pattern, follow Test 14 at line 1534 for the plain-row click assertion pattern, follow Test 15 at line 1566 for the `onConversationSelected` fixture wiring):
      1. `const row = makeConversationRow({ id: "hidden-row-n", label: "hidden-n", host: hostA });`
      2. `setSnapshot({ grouped: [{ hostId: "h1", hostName: "hostA", rows: [row] }], hiddenIds: new Set(["hidden-row-n"]) });`
      3. `const onConversationSelected = vi.fn();`
      4. `const { container } = render(<PrettyConversationsPanel variant="desktop" onConversationSelected={onConversationSelected} onDeactivateRow={() => {}} />);`
      5. Expand the Hidden section: `fireEvent.click(container.querySelector('[data-testid="hidden-divider"]') as HTMLElement);` then `await waitFor(...)` if needed to confirm the row is present in `[data-hidden-group="true"]` (mirror Test (c) at lines 2308-2313).
      6. Query the row body and click: `const rowEl = container.querySelector('[data-conversation-id="hidden-row-n"]') as HTMLElement; const body = rowEl.querySelector('[role="button"]') as HTMLElement; fireEvent.click(body);`
      7. Assertions:
         - `expect(unhideConversationSpy).not.toHaveBeenCalled();`  // Ashley 2026-09-03 invariant
         - `expect(selectConversationSpy).toHaveBeenCalledWith("hidden-row-n");`
         - `expect(onConversationSelected).toHaveBeenCalledWith("hidden-row-n");`
    - Add a leading test-block comment above the `it(...)` that reads:
      `// Test (n) [Ashley 2026-09-03 — inverts quick-260731-tgg]: clicking a`
      `// hidden row opens the session but leaves hiddenIds untouched. The prior`
      `// quick-260731-tgg auto-unhide-on-click both violated the "hidden means`
      `// hidden" semantic and produced a click race (row DOM moved out from`
      `// under the cursor between click-down and click-up, dropping the`
      `// selectConversation dispatch). Test (f) above still asserts unhide-on-`
      `// pin — that path is unchanged; only the click path stops mutating.`

    STEP 3 — Verify locally: `npm test -- PrettyConversationsPanel.test.tsx` (or the project's vitest command — check package.json for exact script) must pass with Test (n) green. All prior tests (a-j, m onwards) must remain green. If Test (f) breaks, the source edit was wrong (do NOT weaken Test (f)).

    STEP 4 — Ship (fleet-critical, per CLAUDE.md — Docker requires sudo on this box):
    - `npm run build` (or the project's build script)
    - `sudo docker compose up -d --force-recreate` (from repo root)
    - Verify: `curl -sSI https://term.gigaashley.click/ | head -1` returns `HTTP/2 200` (or the equivalent — nginx caveat: this route is served by `/` so no new location block is required; source-only + test-only edits, no new backend routes).
    - Manual smoke (optional but recommended given fleet-critical blast radius): log into term.gigaashley.click, expand Hidden section, click a hidden row → session opens in the tab area, row stays in Hidden section.

    STEP 5 — Commit (single atomic per constraints):
    - `git add src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
    - Commit message: `fix(pretty-conversations): clicking hidden row opens session without unhiding` with a body noting the flip of quick-260731-tgg and the click-race root cause.
  </action>
  <verify>
    <automated>npm test -- src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx 2>&1 | tail -40</automated>
  </verify>
  <done>
    - Lines 974-975 of the OLD PrettyConversationsPanel.tsx (`// quick-260731-tgg: opening a hidden row auto-unhides…` + the `if (hiddenIds.has(row.id)) unhideConversation(row.id);`) are gone; replaced with the Ashley 2026-09-03 explanatory comment. `grep -n "opening a hidden row auto-unhides" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns 0 matches. `grep -n "Ashley 2026-09-03" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns at least 1 match inside handleRowSelect.
    - `handleTogglePin` at ~line 1188 STILL contains `if (hiddenIds.has(row.id)) unhideConversation(row.id);` — grep confirms `grep -c "if (hiddenIds.has(row.id)) unhideConversation(row.id);" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns `1` (down from 2).
    - Test (n) exists in PrettyConversationsPanel.test.tsx inside the Hide/Show wiring describe block. `grep -c "Test (n)" src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` returns at least 1.
    - Vitest run of `PrettyConversationsPanel.test.tsx` is fully green. Test (n) passes. Test (f) (unhide-before-pin) still passes untouched.
    - Deployed: `curl -sSI https://term.gigaashley.click/ | head -1` returns HTTP 200.
    - One atomic commit exists with the specified commit message; git log shows it as HEAD (or one behind if a follow-up commit is added, but the fix is a single commit per the constraint).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user click → React handler | untrusted user gesture crosses into store mutation surface |
| React handler → in-memory store (hiddenIds Set) | client-side state; not persisted server-side on this path |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-quick-260903-vnu-01 | Tampering | handleRowSelect click → hiddenIds mutation | mitigate | Remove the unhide-on-click branch entirely; only the explicit context-menu Unhide action (handleToggleHide) mutates hiddenIds. Regression test asserts `unhideConversationSpy` NOT called on click path. |
| T-quick-260903-vnu-02 | Denial of Service | Click race causing session-open failure | mitigate | Removing the pre-routing state mutation eliminates the DOM shift that races the click handler; navigation branches (selectConversation / onRdpRowClick / onDetachedRowClick) now fire deterministically. Test asserts selectConversation + onConversationSelected both fire. |
| T-quick-260903-vnu-03 | Elevation of Privilege | Malicious PR restoring auto-unhide | accept | Low risk on a solo-dev repo; the Ashley 2026-09-03 comment + Test (n) name embed the design decision inline. Future reviewers see "why this line is missing" without needing archaeology. |
| T-quick-260903-vnu-SC | Tampering | npm/pip/cargo installs | accept | No new dependencies introduced; edit is pure source + test in existing files. Package-legitimacy gate not applicable. |
</threat_model>

<verification>
- Vitest suite for PrettyConversationsPanel.test.tsx runs clean; Test (n) present and passing; Test (f) present and passing.
- `grep` gates in <done> above prove: (a) old auto-unhide-on-click line is gone from handleRowSelect, (b) unhide-on-pin line is still present exactly once, (c) Ashley 2026-09-03 comment landed in the file, (d) Test (n) is present.
- Production HTTPS on term.gigaashley.click returns 200 after docker compose recreate.
- Manual smoke on production: clicking a hidden row opens the session and leaves the row in the Hidden section (Ashley visual confirmation, not gate-blocking).
</verification>

<success_criteria>
- Clicking a hidden row opens the session (all three routing branches — plain / rdp / fleet-only — work).
- Clicking a hidden row does NOT mutate hiddenIds; the row remains in the Hidden section.
- The context-menu Hide / Unhide / Pin actions all still work identically to before (handleToggleHide and handleTogglePin untouched).
- No new "sometimes navigation fails" reports — the click race is gone because the pre-routing state mutation is gone.
- One atomic commit with the specified message. Deployed and HTTPS 200 verified on term.gigaashley.click.
</success_criteria>

<output>
Create `.planning/quick/260903-vnu-fix-pretty-conversations-clicking-hidden/260903-vnu-SUMMARY.md` when done, per the summary.md template. Note the flip of quick-260731-tgg for future patch-archaeology.
</output>
