---
phase: 93-relay-rooms-use-the-chat-surface-one-surface-two-data-source
plan: 01
subsystem: ui/pretty-view
tags:
  - foundation
  - types
  - source-prop
  - harness-adapter
  - interface-first
  - slice-1
requires:
  - Phase 90 Slice D shipped the standalone relay-room pane tree (retires in Slice 4)
  - Phase 41 Plan 02 IdentitySessionPane wrapper (extended here)
  - Phase 47 hydration-cap + Phase 148 reconnect scheduler (byte-preserved)
provides:
  - ChatSurfaceSource discriminated-union type with kind:"harness"|"relay" variants
  - useChatSurfaceAdapter(source, isVisible) unified adapter hook (Pitfall 2 resolution)
  - useHarnessAdapter inert shim (hook-order stability contract)
  - Stubbed useRelayAdapter peer inlined for Slice 3 drop-in replacement
  - PrettyView accepts optional source prop; harness ingestion effect gated on source.kind
  - IdentitySessionPane passes source={{kind:"harness",...}} alongside redundant legacy props
affects:
  - src/ui/features/pretty-view/PrettyView.tsx (extension in place)
  - src/ui/shell/IdentitySessionPane.tsx (extension in place — prop restructure)
tech-stack:
  added: []
  patterns:
    - Discriminated-union kind props (D-07) at pane-source level
    - Adapter-hook encapsulation (D-09) with unconditional calls (Pitfall 2)
    - Redundant legacy props alongside new source (Blocker 1 resolution)
key-files:
  created:
    - src/ui/features/pretty-view/sources/chat-surface-source.ts
    - src/ui/features/pretty-view/sources/use-harness-adapter.ts
    - src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts
    - src/ui/features/pretty-view/sources/chat-surface-source.test.ts
    - src/ui/features/pretty-view/PrettyView.source-prop.test.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/shell/IdentitySessionPane.tsx
    - src/ui/shell/IdentitySessionPane.test.tsx
decisions:
  - "Optional source prop with fallback synthesis during Slice 1 (Rule 3 auto-fix) — required prop would break every existing PrettyView test file byte-identically per the plan's regression floor. Reverts to required post-Slice-4 cleanup once all consumers migrate."
  - "Stubbed useRelayAdapter inlined in use-chat-surface-adapter.ts (not a separate file) so Slice 3's unstubbing diff is a single-file change."
metrics:
  duration: "~30 min executor wall-clock"
  completed: 2026-09-09
requirements:
  - D-07
  - D-08
  - D-09
  - D-05
---

# Phase 93 Plan 01: Type foundation and adapter-hook contract Summary

**One-liner:** Locks the D-07 discriminated-union source prop shape, the D-09 unified adapter-hook contract, and the Pitfall 2 rules-of-hooks resolution that every subsequent slice (2-5) will build on — with the harness case rendered byte-identically.

## What Landed

Wave 1 of the Phase 93 refactor. Three tasks, three atomic commits, ~460 lines of new code (types + hooks + tests) plus surgical extensions to PrettyView.tsx (12 additions) and IdentitySessionPane.tsx (24 additions).

### Task 1: ChatSurfaceSource type + unified adapter hook contract

Commit: `473bfa9a`

- `src/ui/features/pretty-view/sources/chat-surface-source.ts` — exports the `ChatSurfaceSource` discriminated-union type with two variants (`kind: "harness" | "relay"`), the `ChatSurfaceMessage` type mirroring PrettyView's local `StreamEvent` union, and the `ChatSurfaceAdapterState` uniform return shape both adapters conform to.
- `src/ui/features/pretty-view/sources/use-harness-adapter.ts` — inert hook-order-stable shim. Ignores `isVisible` (accepted for signature symmetry with `useRelayAdapter`); returns constant `{ messages: [], participants: null, sendMessage: async () => false, error: null, isReady: true }`. Discipline comment at file top pins the Pitfall 2 invariant.
- `src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts` — unified `useChatSurfaceAdapter(source, isVisible)` hook. Calls both `useHarnessAdapter` and `useRelayAdapter` unconditionally in stable order (Pitfall 2 resolution) and returns whichever adapter's state matches `source.kind`. Includes an inlined stubbed `useRelayAdapter` that returns `isReady: false` — Slice 3 replaces this with the ported ~488-line hook from `use-relay-room-stream.ts`.
- `src/ui/features/pretty-view/sources/chat-surface-source.test.ts` — 5 runtime tests (hook-order stability under kind-flip; harness+relay state return; sendMessage inert) + 2 compile-time `@ts-expect-error` sentinels that assert invalid-state rejection (harness with `roomId` → compile error; relay with `hostId` → compile error).

### Task 2: Thread source prop through PrettyView + gate harness ingestion effect

Commit: `10b05d5d`

- `PrettyViewProps.source?: ChatSurfaceSource` entry added. **Optional during Slice 1** (see Deviation 1 below).
- Redundant legacy `hostId: number`, `tmuxSession: string`, `tabId?: string` props preserved on the interface alongside `source` (Blocker 1 resolution — many internal PrettyView consumers still read the flat props).
- `useChatSurfaceAdapter(source, isVisible)` called EXACTLY once at the top of PrettyView's body. Establishes the hook-order contract for later slices; threads `isVisible` for Slice 3's WS visibility gate.
- Harness ingestion effect at `PrettyView.tsx:~L1881` short-circuits with `if (source.kind !== "harness") return;` as the FIRST statement in the effect body. `source.kind` added to the effect's dependency array. Behavior for the harness case is byte-preserved (dep is inert when kind never flips).
- `PrettyView.source-prop.test.tsx` — 7 tests: harness regression floor (exactly one badge at position class `absolute top-4 right-5 z-[101]`); redundant legacy props preserved (source-file assertion); D-08 discipline (zero `source.roomId` / `source.hostId` reads outside narrowed blocks); ingestion gate (no `openClaudeSessionSocket` call for a relay-source mount); adapter call shape (source-file grep of two-arg call site); no unsafe casts (Blocker 1 invariant); positive control (harness source DOES open WS).

### Task 3: Restructure IdentitySessionPane's PrettyView mount

Commit: `0cab86c1`

- IdentitySessionPane's PrettyView mount now passes `source={{ kind: "harness", hostId: parseInt(host.id, 10), tmuxSession: effectiveTmuxSession ?? "", tabId: tabId ?? undefined }}` ALONGSIDE the redundant legacy `hostId={parseInt(host.id, 10)}`, `tmuxSession={effectiveTmuxSession ?? ""}`, `tabId={tabId}` props.
- All other PrettyView props unchanged byte-for-byte from pre-slice: `className`, `isVisible`, `identityBadgeContextMenuItems`, `onSend` (55-line body preserved verbatim), `onInterrupt`, `onInjectedTurnReady`, ref-forwarding registration surface.
- `IdentitySessionPane.test.tsx` extended with 4 new tests capturing PrettyView props via the mock: source-prop shape assertion; redundant legacy props still present; other props unchanged; harness-regression-floor marker for the existing P1-P7 tests (which all still pass).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Made `source` prop OPTIONAL during Slice 1 (was `required` in plan)**

- **Found during:** Task 2 (before running any existing PrettyView tests)
- **Issue:** Plan Task 2 said "Migration decision: `source` is REQUIRED (not optional). Task 3 updates the sole harness call site atomically." However, ~15 existing PrettyView test files (85 test files total in `src/ui/features/pretty-view/`) mount `<PrettyView hostId={1} tmuxSession="s1" isVisible={true} ... />` WITHOUT a `source` prop. Making `source` required would either (a) crash them at runtime when `source.kind` is accessed, or (b) require modifying every test file — but the plan's Task 2 acceptance criteria explicitly says "existing PrettyView tests untouched and passing" and lists `PrettyView.test.tsx` / `PrettyView.task-pill.test.tsx` / `PrettyView.compose-send.test.tsx` as the harness-regression-floor tests that must pass with "ZERO snapshot diffs or assertion changes vs. pre-slice." These are contradictory constraints.
- **Fix:** Made `source?: ChatSurfaceSource` optional in `PrettyViewProps` and synthesized a harness-kind fallback from the flat `hostId` / `tmuxSession` / `tabId` props when omitted:
  ```ts
  const source: ChatSurfaceSource = sourceProp ?? {
    kind: "harness",
    hostId,
    tmuxSession,
    tabId,
  };
  ```
  This preserves the "byte-identical harness case" invariant (any pre-Slice test mounting without `source` gets a harness source that behaves identically) AND satisfies Task 3's explicit `source={{kind:"harness",...}}` prop passing at IdentitySessionPane. Post-Slice-4 cleanup can flip `source` back to required once every internal caller has been migrated. Slice 4 rewires the tabUtils dispatcher for the relay branch — it MUST pass `source` explicitly there because the synthesized fallback is harness-only by construction.
- **Files modified:** `src/ui/features/pretty-view/PrettyView.tsx` (the interface entry + the destructure fallback synthesis)
- **Commit:** `10b05d5d`
- **Rule alignment:** Rule 3 (auto-fix blocking issues) — the constraint contradiction blocked completing Task 2 without either violating the "existing tests untouched" invariant OR failing typecheck via a required prop.

No architectural changes were needed. No Rule 4 (ask about architectural changes) triggered.

## Authentication Gates

None. Zero user-facing runtime state was touched.

## Threat Flags

None. This slice adds a discriminated-union type + adapter-hook contract inside a React component. No new network endpoints, no new auth paths, no new file access, no schema changes at trust boundaries. The threat register in the plan (T-92-01-01 through T-92-01-04 + T-92-01-SC) is fully addressed:

- **T-92-01-01 (Tampering, source construction)** — mitigated. `ChatSurfaceSource` discriminated union enforces valid-state-unrepresentable at compile time (verified via `@ts-expect-error` sentinels in `chat-surface-source.test.ts`).
- **T-92-01-02 (DoS, hook-order violation)** — mitigated. `useChatSurfaceAdapter` calls both underlying hooks unconditionally with narrowed `| null` inputs + `isVisible` threaded. Test 3 in `chat-surface-source.test.ts` asserts no throw under kind-flip.
- **T-92-01-03 (Repudiation, harness ingestion regression)** — mitigated. `if (source.kind !== "harness") return;` gate is the FIRST statement in the effect body. Test 4 in `PrettyView.source-prop.test.tsx` asserts no `openClaudeSessionSocket` call for a relay-source mount. All 85 pretty-view test files pass unchanged (984 tests, 11 skipped, 1 todo).
- **T-92-01-04 (EoP, legacy prop escape hatch)** — accept, per Blocker 1 resolution. Documented in code comments at both `PrettyViewProps` interface and IdentitySessionPane mount site.
- **T-92-01-SC** — N/A, no packages installed.

## Known Stubs

- **`useRelayAdapter` stub inside `use-chat-surface-adapter.ts`** — returns `{ messages: [], participants: { humans: [], agents: [] }, sendMessage: async () => false, error: null, isReady: false }`. Slice 3 replaces this with the real ported hook (from `use-relay-room-stream.ts` per D-10). File location, signature, and initial state shape all match Slice 3's target — Slice 3 is a drop-in.
- **`useHarnessAdapter` inert shim** — intentionally does not own ingestion state. Harness ingestion continues to live in PrettyView's `messages` reducer (unchanged from pre-slice). This is BY DESIGN per the plan's must-haves ("`useHarnessAdapter` is a hook-order-stable shim per Pitfall 2 — Does NOT own ingestion state. Harness case's ingestion state stays in PrettyView's local `messages` reducer, unchanged. The shim exists purely to keep hook-call order stable across both source variants.") — not a stub to resolve. Later slices do NOT expand this shim.

Both stubs are intentional and documented in code comments. The plan explicitly calls for Slice 3 to unstub `useRelayAdapter`.

## Rationale for Deviations

- **Fallback synthesis** — preserves the "harness case byte-identical" regression-floor invariant. All 85 pretty-view test files pass unchanged post-slice.
- **Interface entry `source?` (not `source`)** — Slice 4 must still pass `source` explicitly for the relay branch because the synthesized fallback is harness-only. Enforcement is deferred by one slice but not lost.
- **Naming discipline** — used `"harness" | "relay"` (short form) at the pane-source level per plan D-05 constraint; `Tab.sessionKind: "harness" | "relay-room"` at the tab level stays as a separate axis.

## Test Results

**Aggregate verification per plan verify block:**

```
npx vitest run \
  src/ui/features/pretty-view/PrettyView.test.tsx \
  src/ui/features/pretty-view/PrettyView.task-pill.test.tsx \
  src/ui/features/pretty-view/PrettyView.compose-send.test.tsx \
  src/ui/features/pretty-view/PrettyView.autoplay.test.tsx \
  src/ui/features/pretty-view/PrettyView.aside.test.tsx \
  src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx \
  src/ui/features/pretty-view/PrettyView.source-prop.test.tsx \
  src/ui/features/pretty-view/sources/chat-surface-source.test.ts \
  src/ui/shell/IdentitySessionPane.test.tsx

Test Files  9 passed (9)
     Tests  89 passed | 11 skipped | 1 todo (101)
   Duration ~13.4s
```

**Broader pretty-view suite (defensive — 85 test files):**

```
npx vitest run src/ui/features/pretty-view/

Test Files  85 passed (85)
     Tests  984 passed | 11 skipped | 1 todo (996)
```

**Typecheck:**

```
npx tsc --noEmit
(no output — clean)
```

## Acceptance Criteria Verification

### Plan Success Criteria

- ✅ `ChatSurfaceSource` type + `useChatSurfaceAdapter` hook (two-arg: `(source, isVisible)`) + `useHarnessAdapter` inert shim in `src/ui/features/pretty-view/sources/` with green tests.
- ✅ PrettyView accepts `source: ChatSurfaceSource` ALONGSIDE redundant legacy `hostId`/`tmuxSession`/`tabId` props. Gates harness ingestion effect on `source.kind === "harness"`. D-08 discipline holds. No unsafe casts.
- ✅ IdentitySessionPane passes `source={{ kind: "harness", hostId, tmuxSession, tabId }}` AND redundant legacy props to PrettyView.
- ✅ Harness case renders byte-identical DOM at the badge anchor and identical message-list rendering.
- ✅ All existing PrettyView + IdentitySessionPane tests pass unchanged.
- ✅ `npx tsc --noEmit` passes.

### must_haves.truths (from plan frontmatter)

- ✅ PrettyView accepts a `source: ChatSurfaceSource` discriminated-union prop with `kind: 'harness' | 'relay'` variants.
- ✅ TypeScript rejects a harness-kind source carrying `roomId`, and rejects a relay-kind source carrying `hostId` — invalid states unrepresentable per D-07 (verified via `@ts-expect-error` sentinels).
- ✅ IdentitySessionPane passes `source={{ kind: 'harness', hostId, tmuxSession, tabId }}` ALONGSIDE the legacy `hostId={host.id} tmuxSession={effectiveTmuxSession}` props.
- ✅ Every case-based branch inside PrettyView touched by this plan reads `source.kind` — no case detection off other fields (D-08). Only branch touched is the ingestion effect gate.
- ✅ Harness case renders byte-identical DOM at the badge anchor (PrettyView.tsx:~L3349-3366) and identical message-list rendering.
- ✅ The harness ingestion effect at PrettyView.tsx:~L1881 is gated at the top with `if (source.kind !== "harness") return;`; the relay branch is a no-op stub returning empty messages.
- ✅ `useHarnessAdapter` is a hook-order-stable shim per Pitfall 2 — returns `{ messages: [], participants: null, sendMessage: async () => false, error: null, isReady: true }`. Does NOT own ingestion state.
- ✅ `useChatSurfaceAdapter(source, isVisible)` takes TWO arguments; both underlying adapter hooks are called unconditionally with narrowed nullable inputs.

## Follow-Ups for Downstream Slices

- **Slice 2** (multi-badge extension): will add case-based badge rendering at PrettyView.tsx:~L3349-3366; every case-based branch it introduces MUST read `source.kind`. `chat-surface-source.ts` exposes `ChatSurfaceParticipants`, `HumanParticipant`, `AgentParticipant` types ready to consume.
- **Slice 3** (relay adapter port): drops in real `useRelayAdapter` at `src/ui/features/pretty-view/sources/use-relay-adapter.ts`, then updates the inline stub in `use-chat-surface-adapter.ts` to import from the new file. Signature MUST match `(source: Extract<ChatSurfaceSource, { kind: "relay" }> | null, isVisible: boolean): ChatSurfaceAdapterState` — verified compatible with the current stub.
- **Slice 4** (tabUtils rewire): the relay branch of `TerminalOrIdentitySessionPane` must pass `source` explicitly (the synthesized fallback in PrettyView is harness-only by construction). Once Slice 4 lands, a Slice 5 cleanup can flip `source?:` back to `source:` (required) on the PrettyView props interface — Slice 5's regression floor: every internal PrettyView consumer that currently reads flat `hostId`/`tmuxSession`/`tabId` has been either audited and gated on `source.kind === "harness"` or migrated to read from `source`.

## Self-Check: PASSED

Files created:
- ✅ src/ui/features/pretty-view/sources/chat-surface-source.ts (FOUND)
- ✅ src/ui/features/pretty-view/sources/use-harness-adapter.ts (FOUND)
- ✅ src/ui/features/pretty-view/sources/use-chat-surface-adapter.ts (FOUND)
- ✅ src/ui/features/pretty-view/sources/chat-surface-source.test.ts (FOUND)
- ✅ src/ui/features/pretty-view/PrettyView.source-prop.test.tsx (FOUND)

Files modified:
- ✅ src/ui/features/pretty-view/PrettyView.tsx (verified via `grep -c "source?: ChatSurfaceSource"`)
- ✅ src/ui/shell/IdentitySessionPane.tsx (verified via `grep -c "source={{"`)
- ✅ src/ui/shell/IdentitySessionPane.test.tsx (verified via `grep -c "capturedPrettyViewProps"`)

Commits:
- ✅ 473bfa9a feat(92-01): add ChatSurfaceSource type + unified adapter hook contract
- ✅ 10b05d5d feat(92-01): thread source prop through PrettyView + gate harness ingestion effect
- ✅ 0cab86c1 feat(92-01): IdentitySessionPane mounts PrettyView with source={{kind:"harness",...}}
