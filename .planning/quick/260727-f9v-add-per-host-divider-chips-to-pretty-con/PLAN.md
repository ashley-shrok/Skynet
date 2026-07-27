---
quick_id: 260727-f9v
slug: add-per-host-divider-chips-to-pretty-con
type: execute
autonomous: true
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx

must_haves:
  truths:
    - "Above each non-RDP, non-active-set, non-pinned host group, a divider chip renders with the group's hostName as its uppercase label and a small Server icon glyph."
    - "The active-set group (data-active-set-group=\"true\") renders NO divider chip above it."
    - "The pinned group (data-pinned-group=\"true\") renders NO divider chip above it."
    - "The __rdp__ group still renders exactly ONE 'Remote desktop' divider chip (unchanged behavior apart from the brightness bump)."
    - "Inside host-grouped sections (non-active-set, non-pinned, non-RDP), each row's sublabel shows identity.title (falling back to identity.displayName when title is null), and the Server icon is dropped from that row."
    - "When no identity resolves for a row in a host-grouped section, the row falls back to the previous behavior verbatim: hostname text + Server icon."
    - "Active-set rows, pinned rows, and RDP rows keep the hostname + Server icon sublabel unchanged (their render sites do not pass the identityTitle subtitleMode)."
    - "All divider chips (new per-host chips AND the existing 'Remote desktop' chip) render at the raised brightness — same cool-gray family, alpha 85 (text-[#5c6070]/85) — applied consistently to both label text and icon."
    - "Full test suite (604 tests) stays green; new test cases pass; the existing Test 3 (no per-host semibold header) is updated to reflect the divider-chip form."
  artifacts:
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      provides: "subtitleMode prop; conditional sublabel + Server icon render logic"
      contains: "subtitleMode"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "Per-host divider chip render above non-RDP grouped sections; subtitleMode='identityTitle' at that render site; brightness bump on existing RDP chip"
      contains: "data-testid=\"host-divider\""
  key_links:
    - from: "PrettyConversationsPanel.tsx grouped.map non-RDP branch"
      to: "PrettyConversationRowLive"
      via: "subtitleMode=\"identityTitle\" prop"
      pattern: "subtitleMode=\"identityTitle\""
    - from: "PrettyConversationRow.tsx sublabel render block"
      to: "identity.title / identity.displayName / row.host.name fallback chain"
      via: "conditional in <span className=\"pv-host\"> render"
      pattern: "identity\\?.title"
---

<objective>
Two coupled UI changes in the pretty-conversations list, greenlit by Ashley:

1. Render a per-host divider chip above each non-RDP, non-active-set, non-pinned host group in `PrettyConversationsPanel.tsx` (mirrors the existing "Remote desktop" chip's visual treatment, using `Server` glyph instead of `Monitor`, with the group's `hostName` as the uppercase label).
2. Inside those same host-grouped sections ONLY, swap the row sublabel from hostname → `identity.title ?? identity.displayName`, and drop the `Server` icon from that row. When no identity resolves, fall back to hostname + Server icon verbatim.
3. Bump brightness on ALL divider chips (new per-host chips AND existing RDP chip) from `text-[#5c6070]/50` → `text-[#5c6070]/85` on both label text and icon.

Purpose: Slice of the `skynet-transformation` master bounty. Restores group affordance (per-host chip) while making rows inside those groups read as "which identity is this" rather than duplicating the hostname the chip already announces.

Output: Modified panel + row + tests. Behavior confirmed via updated + new tests. Full suite (604 tests) green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-quick.md
</execution_context>

<context>
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
@src/ui/api/identities-api.ts

Identity shape (from `src/ui/api/identities-api.ts`):
  - `displayName: string` (always present)
  - `title: string | null` (nullable — the whole reason a fallback chain exists)

Panel context:
  - `grouped` shape: `HostGroup[]` where `HostGroup = { hostId: string, hostName: string, rows: ConversationRow[] }`
  - `__rdp__` sentinel: `hostId === "__rdp__"` — panel line 380, keeps its existing chip
  - Active-set group: `data-active-set-group="true"` — panel lines 324-344, cross-host, NO chip
  - Pinned group: `data-pinned-group="true"` — panel lines 355-375, cross-host, NO chip
  - Regular host groups: panel lines 424-448, currently FLAT (comment "FLAT per Ashley/prototype lock" — that lock is INTENTIONALLY reversed by this task)

Row context:
  - Identity resolution: `useIdentities().byKey`, keyed on `sessionMatchKey(row.targetTmuxSession)` — may return null for unresolved sessions
  - Current sublabel render: `PrettyConversationRow.tsx` lines 365-370 — renders `row.host` conditionally with a `<Server>` icon + `<span>{row.host.name}</span>` inside `<span className="pv-host">`
  - `Server` from `lucide-react` already imported (line 57)
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add subtitleMode prop to PrettyConversationRow (tests first)</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationRow.tsx, src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx</files>
  <behavior>
    Add three new test cases to `PrettyConversationRow.test.tsx` covering the new `subtitleMode` prop (default "hostname"; new value "identityTitle"). All three assertions target the row when rendered with an identity registered in the `useIdentities` mock so `identitiesByKey.get(key)` returns the shape you want.

    - Test A (identityTitle + identity.title set): render row with `subtitleMode="identityTitle"` and a resolved identity having `title="Ashley Ops"` and `displayName="ashley"`. Assert the sublabel text is exactly "Ashley Ops"; assert NO `svg` corresponding to the Server icon exists inside the `.pv-host` span (query by parent tag or by lucide's rendered class marker — the existing Server render uses width=11 height=11, so `.pv-host svg[width="11"]` should return null).
    - Test B (identityTitle + identity.title null, displayName set): render with `subtitleMode="identityTitle"` and identity `title=null`, `displayName="ashley"`. Assert sublabel text is "ashley"; assert no Server icon in `.pv-host`.
    - Test C (identityTitle + no identity resolved — safe fallback): render with `subtitleMode="identityTitle"` but a `targetTmuxSession` that will NOT match any identity in the mock (empty identitiesByKey). Assert sublabel text equals `row.host.name` (e.g. "hostA"), AND the Server icon IS present in `.pv-host` (verbatim previous behavior).
    - Existing tests that render without `subtitleMode` (default "hostname" behavior) MUST still pass unchanged — verifying backward compatibility.

    Then implement the prop in `PrettyConversationRow.tsx`:
    - Extend the prop type: add `subtitleMode?: "hostname" | "identityTitle"` after `inActiveSet` in the destructured props signature (~line 89-110) and the JSDoc-adjacent type block. Default to `"hostname"` via `subtitleMode = "hostname"`.
    - In the sublabel render block (~lines 365-370, the `{row.host && ...}` branch inside `<div className="pv-body">`), replace the current hardcoded render with a conditional:
      - If `subtitleMode === "identityTitle"` AND `identity !== null`: render `<span className="pv-host"><span>{identity.title ?? identity.displayName}</span></span>` — no Server icon.
      - Else (subtitleMode "hostname", OR identityTitle with no identity resolved): keep the current render verbatim — `<Server aria-hidden="true" width={11} height={11} /> <span>{row.host.name}</span>` inside `<span className="pv-host">`.
    - The `{row.host && ...}` outer guard stays intact — rows without a host still render nothing here, both modes. This is the terminal safety net enumerated in the risk callout (title → displayName → keep-hostname → render-nothing if no host at all).
    - Do NOT rename `.pv-host` (CSS coupling stays intact).
    - Do NOT touch any other prop, hook, or render logic.
  </behavior>
  <action>Follow the test-first order in `<behavior>`: extend the test file with the three new cases, run them to confirm RED (they fail against the current row), then implement the prop changes in `PrettyConversationRow.tsx` to make them GREEN. Preserve all existing test assertions. Do not introduce a new subtitleMode value beyond the two documented. Keep the fallback chain explicit and comment-annotated in the row source so the "title → displayName → keep-hostname" safety net is self-documenting per Tina's patch #149 lesson.</action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx</automated>
  </verify>
  <done>PrettyConversationRow.test.tsx contains three new test cases (A/B/C) covering subtitleMode="identityTitle" with title-set / title-null / no-identity-resolved. All prior tests still pass. New `subtitleMode` prop accepted, defaults to "hostname", implemented per the fallback chain described. No changes to `.pv-host` class name or other row logic. `npx vitest run` on the row test file exits 0.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add per-host divider chip render + subtitleMode wiring + brightness bump in Panel</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <behavior>
    Add / update tests in `PrettyConversationsPanel.test.tsx`:

    - Update existing Test 3 (`does NOT render a "Pinned" section header or a per-host semibold header`): the "hostA appears outside a row" assertion is now WRONG — hostA WILL appear in the new host divider chip. Rework Test 3 to:
      - Still assert NO standalone "Pinned" section header (the pinned-glyph-only rule stands).
      - Replace the "hostA does not appear outside a row" assertion with: hostA now DOES appear outside a row (in the divider chip), AND the containing chip element has `data-testid="host-divider"` AND `data-host-id="h1"` (or equivalent identifying attributes chosen by the executor).
    - Add new Test A: setSnapshot with two non-RDP host groups (hostA h1, hostB h2), pinned=[], activeSet=[]. Assert exactly two elements with `data-testid="host-divider"` render, one carrying "hostA" text, one carrying "hostB" text, each with a leading Server icon (query the chip container for an `svg` child).
    - Add new Test B: setSnapshot with pinned=[one row], activeSet=[one row], grouped=[one non-RDP host group]. Assert the panel renders exactly ONE `data-testid="host-divider"` (only above the grouped host section — NOT above the active-set group and NOT above the pinned group). Also assert `data-active-set-group="true"` and `data-pinned-group="true"` wrappers exist in the DOM (structural precondition) and do NOT have a `host-divider` sibling immediately above them.
    - Add new Test C: setSnapshot with grouped=[one non-RDP host group AND the __rdp__ sentinel group]. Assert BOTH `data-testid="host-divider"` (for the non-RDP group) AND `data-testid="rdp-divider"` (existing, for __rdp__) render — the new chip does NOT replace or duplicate the RDP chip.
    - Existing Test 4 (RDP-sentinel with "Remote desktop" divider) must still pass — assertion is text-based and structure-based, brightness bump is invisible to it.

    Then modify `PrettyConversationsPanel.tsx`:

    - Import `Server` from `lucide-react` (add to the existing `import { MessagesSquare, Monitor, Pencil } from "lucide-react";` line at ~line 43 → `import { MessagesSquare, Monitor, Pencil, Server } from "lucide-react";`).
    - In the `grouped.map((group) => ...)` block (~line 379): inside the else-branch (regular host group, currently lines 424-448), PRE-PEND a divider chip inside the `<div key={group.hostId} className="pv-panel-group">` wrapper, BEFORE the `{group.rows.map(...)}`. The chip's markup mirrors the existing RDP chip (lines 392-407) exactly — same wrapping div, same className `flex items-center gap-2 px-4 pt-3 pb-1.5`, same 12px icon + uppercase 11px semibold 0.08em-tracked label + gradient rule filler — with these differences:
      - `data-testid="host-divider"`
      - `data-host-id={group.hostId}` (for test targeting + future debug hooks)
      - Icon: `<Server className="size-3 text-[#5c6070]/85 shrink-0" aria-hidden="true" />` (Server glyph, brightness bumped from /50 → /85)
      - Label: `<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">{group.hostName}</span>` (uses group.hostName, brightness bumped from /50 → /85)
    - In the SAME regular-host-group branch, pass `subtitleMode="identityTitle"` to each `<PrettyConversationRowLive>` in the `group.rows.map(...)` block. Do NOT touch the active-set map (~lines 325-343), the pinned map (~lines 356-374), or the RDP-branch map (~lines 408-420) — those keep the default "hostname" behavior (either omit the prop or pass "hostname" explicitly; executor's choice — omit is cleaner).
    - `subtitleMode` is not currently on the `PrettyConversationRowLive` wrapper's prop shape. Extend that wrapper (top of file, ~lines 79-100) to accept and pass through `subtitleMode?: "hostname" | "identityTitle"` — spread it through with the existing `...rowProps` pattern, no other change needed.
    - In the EXISTING RDP chip (lines 392-407): change `text-[#5c6070]/50` → `text-[#5c6070]/85` on BOTH the `<Monitor ... />` icon className AND the `<span>` label className. Do NOT alter any other class or the gradient rule filler.

    Do NOT modify:
    - Active-set group wrapper or its row iteration.
    - Pinned group wrapper or its row iteration.
    - The `useConversations` / `useSelectedConversationId` / `usePinnedIds` / `useActiveSet` hook usage.
    - The `handleRowSelect`, `handleSwipeOpenChange`, `forceClosedFor`, or `sessionWorkingKey` helpers.
    - The empty-state block or the header block or the NewSessionDialog block.
  </behavior>
  <action>Follow the test-first order in `<behavior>`: update Test 3 and add Tests A/B/C in `PrettyConversationsPanel.test.tsx`, run them to confirm RED, then apply the panel edits to make them GREEN. Keep the new chip's markup structurally identical to the existing RDP chip (copy-paste-modify), only swapping the glyph to Server, wiring `data-testid="host-divider"` + `data-host-id`, using `group.hostName` as label text, and applying the /85 brightness. Apply the same /85 brightness bump to the existing RDP chip in-place. Pass `subtitleMode="identityTitle"` only at the non-RDP grouped render site. Every other render site remains untouched, per Ashley's design lock.</action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</automated>
  </verify>
  <done>PrettyConversationsPanel.test.tsx has updated Test 3 + three new tests (A/B/C) covering per-host chip presence, active-set/pinned suppression, and RDP coexistence. Panel renders `data-testid="host-divider"` chips above non-RDP host groups only, using Server glyph + hostName label at /85 brightness. Non-RDP grouped rows receive `subtitleMode="identityTitle"`. Active-set / pinned / RDP render paths untouched (default "hostname" mode / omitted prop). Existing RDP chip's text + icon bumped from /50 → /85. `npx vitest run` on the panel test file exits 0.</done>
</task>

<task type="auto">
  <name>Task 3: Full-suite regression + lint sanity check</name>
  <files>(no writes — verification only)</files>
  <action>Run the full test suite to confirm the changes from Tasks 1+2 haven't broken anything outside the pretty-conversations feature (604 tests should stay green). If any tests fail: inspect the failure, decide whether it's a legitimate coupling to the swapped behavior (in which case update the test comment + assertion narrowly to the new contract) or a real regression (in which case revisit Task 1 or 2). Also run typecheck to catch any prop-type drift from the new `subtitleMode` field. Do NOT touch source files outside the four listed in `files_modified` without explicit user approval — if a distant test breaks, surface the failure to the user before adjusting.</action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run 2>&1 | tail -20 && npx tsc --noEmit 2>&1 | tail -10</automated>
  </verify>
  <done>Full vitest suite exits 0 with the expected test count (~604 + 6 new = ~610, or updated per Task 2's Test 3 rewrite which stays at 1 case). `npx tsc --noEmit` reports zero errors related to the modified files. If any test outside `src/ui/features/pretty-conversations/` fails, the executor has explicitly surfaced it to the user before proceeding.</done>
</task>

</tasks>

<verification>
Manual smoke check (optional, executor's discretion — this is a visual change; no smoke required for correctness but Ashley may want a pretty-preview screenshot before deploy):
- Rebuild the frontend bundle (`cd /home/ubuntu/skynet && npm run build` or the project's equivalent) and visually confirm on a running dev server that non-RDP host groups now show the chip and the sublabels within those groups render the identity title, not the hostname.
- Confirm the RDP chip and the active-set / pinned rows are visually unchanged apart from the brightness bump on the RDP chip.
</verification>

<success_criteria>
- All four files modified as scoped; no other files touched.
- Two new prop-driven code paths (`subtitleMode="identityTitle"` in row + wired at non-RDP grouped render site in panel) with explicit fallback (identity.title → identity.displayName → keep-hostname-with-Server-icon).
- Per-host divider chips render above non-RDP grouped sections ONLY. Active-set, pinned, and RDP groups' render structure unchanged apart from the RDP chip brightness bump.
- All chip label text + icons at `text-[#5c6070]/85` brightness (both new per-host chips AND existing RDP chip).
- Full test suite green (604 base + net-new cases from Tasks 1+2).
- No TypeScript errors introduced.
</success_criteria>

<risk_notes>
- **Per Tina's patch #149 lesson ("known limitation, inert ≠ inert"):** the row's fallback chain in the "identityTitle" branch MUST have the terminal keep-hostname safety net — if it's silently missing, unresolved-identity rows in host groups will ship with sublabel "" or "undefined" on Ashley's very next click. Test C in Task 1 exists specifically to guard this — do NOT skip it.
- **Deploy discipline:** this change alone does NOT warrant an immediate deploy. Leave the deploy call to the executor/Tina after the commit lands, unless Ashley explicitly asks for an out-of-band push. If a deploy does happen, the executor's deploy notification MUST pre-warn Ashley about first-hard-refresh HTTP2_PROTOCOL_ERROR (Tina's learned pref on any container recreate).
- **Test 3 rewrite:** the current Test 3 asserts hostA does NOT appear outside a row. That assertion is the OLD contract and is being intentionally reversed. Do not "fix" the test to preserve the old assertion — the new contract IS the new assertion.
</risk_notes>

<output>
No SUMMARY.md required for quick tasks. Commit message suggestion (executor to compose final):
`feat(pretty-conversations): per-host divider chips + identity-title sublabels in host groups (quick-260727-f9v)`
</output>
