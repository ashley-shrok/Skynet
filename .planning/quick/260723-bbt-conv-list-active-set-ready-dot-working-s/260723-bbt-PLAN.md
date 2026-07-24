---
phase: quick-260723-bbt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.test.ts
  - src/ui/state/session-working-store.ts
  - src/ui/state/session-working-store.test.ts
  - src/ui/features/terminal/Terminal.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/index.css
autonomous: true
requirements:
  - PATCH-137
tags:
  - pretty-conversations
  - conversation-store
  - active-set
  - ready-dot
  - working-state
  - patch-137
must_haves:
  truths:
    - "sessionStorage under key `pv-conv-active-set` is a JSON array of conversation ids; on module load it hydrates conversation-store `activeSet` (empty Set on missing/invalid key)."
    - "Calling `selectConversation(id)` where `id !== null` also idempotently adds `id` to `activeSet` and persists JSON back to sessionStorage under `pv-conv-active-set`."
    - "`useActiveSet()` returns a stable ReadonlySet reference across no-op mutations and a new reference after every real add (mirrors `usePinnedIds` semantics)."
    - "`publishSessionWorking(key, isWorking)` updates the module-scoped working snapshot; `useSessionWorking(key)` returns `null` for unknown keys, `true` when working, `false` when idle."
    - "`Terminal.tsx` emits `publishSessionWorking(`${hostConfig.id}:${tmuxSessionName ?? ''}`, isIdle===null ? null : isIdle===false)` whenever `isIdle`, `hostConfig.id`, or `tmuxSessionName` changes; no other Terminal.tsx behavior is altered."
    - "`PrettyConversationRow` accepts `isWorking?: boolean | null` (default `null`, renamed from `isWip`) and `inActiveSet?: boolean` (default `false`); the ready-dot renders iff `inActiveSet === true && isWorking === false`."
    - "The ready-dot uses `data-pv-conv-ready-dot=\"true\"`, `aria-label=\"ready\"`, steady (NO CSS animation), hue-cream fill (`hsla(H,60%,80%,1)`) with hue outer glow + warm inset per mock; hue-null fallback uses neutral rgba (mirrors patch #136 fallback)."
    - "Ambient recession (`!inActiveSet && !isRdp`) overrides the base bubble to the mock's ambient hue-recessed rgba (background/border/shadow/color) and disables backdrop-filter; ambient hover shifts to ambient-hover rgba (no transform lift, no full-bubble hover)."
    - "RDP rows (`row.rdpHostRow === true`) render the SAME neutral treatment regardless of `inActiveSet` — the ambient branch does NOT fire on RDP rows."
    - "`PrettyConversationsPanel` threads `isWorking={useSessionWorking(sessionWorkingKey(row))}` and `inActiveSet={activeSet.has(row.id)}` at all 3 render sites (pinned, regular host groups, RDP sentinel group); the hardcoded `isWip={false}` sites are fully removed."
    - "`@keyframes pv-conv-wip-pulse` and the `[data-pv-conv-wip-dot=\"true\"]` reduced-motion block are removed from src/ui/index.css (dead code — ready-dot is steady)."
    - "PrettyConversationRow tests cover: Test 13 renamed + inverted (inActiveSet+!isWorking → dot); Test 15 (inActiveSet+isWorking → no dot); Test 16 (inActiveSet+isWorking=null → no dot); Test 17 (!inActiveSet+!isWorking → no dot); Test 18 (ambient row style probe); RDP-neutral invariant preserved across `inActiveSet` values."
    - "conversation-store tests cover: `selectConversation(id)` writes id into activeSet + sessionStorage; module-init hydrates from sessionStorage; idempotent second call causes no duplicate sessionStorage write."
    - "session-working-store tests cover: publish updates snapshot; unknown key returns null; publishing null clears back to null; multiple keys are independent."
    - "One atomic git commit lands on `feat/tab-title-from-tmux` with subject `feat(pretty-conversations): patch #137 — wire active-set + ready-for-attention dot from session-working store` and NO Co-Authored-By trailer."
  artifacts:
    - path: "src/ui/state/session-working-store.ts"
      provides: "publishSessionWorking / useSessionWorking / getSessionWorkingSnapshot module + module-scoped Map<string, boolean|null> + useSyncExternalStore subscribe/notify pattern matching conversation-store"
      contains: "publishSessionWorking"
    - path: "src/ui/state/session-working-store.test.ts"
      provides: "Vitest coverage for publish/hook/null semantics/independent keys"
      contains: "publishSessionWorking"
    - path: "src/ui/state/conversation-store.ts"
      provides: "Extended with State.activeSet: Set<string>, sessionStorage hydration under key pv-conv-active-set, addToActiveSet(id), useActiveSet() hook; selectConversation() side-effects addToActiveSet(id) for non-null ids"
      contains: "activeSet"
    - path: "src/ui/state/conversation-store.test.ts"
      provides: "New tests for selectConversation→activeSet+sessionStorage side-effect, module-init hydration, idempotent second-call"
      contains: "activeSet"
    - path: "src/ui/features/terminal/Terminal.tsx"
      provides: "New useEffect ~7 lines beside existing isIdle state (line ~244) publishing to session-working-store on [isIdle, hostConfig.id, tmuxSessionName]"
      contains: "publishSessionWorking"
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      provides: "isWip → isWorking rename (boolean|null), new inActiveSet prop, dot render condition inversion + rename to ready-dot (data-pv-conv-ready-dot, aria-label=ready, steady/no-animation), inline ambient recession branch (isAmbient = !inActiveSet && !isRdp) layered under hover/selected"
      contains: "inActiveSet"
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx"
      provides: "Updated Test 13 + new Tests 15/16/17/18; RDP-invariant coverage across inActiveSet values"
      contains: "inActiveSet"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "Replaces 3 hardcoded isWip={false} with isWorking={useSessionWorking(sessionWorkingKey(row))} + inActiveSet={activeSet.has(row.id)}; useActiveSet() hoisted once at panel top; stale patch-#137-comment replaced"
      contains: "useSessionWorking"
    - path: "src/ui/index.css"
      provides: "Remove @keyframes pv-conv-wip-pulse (lines ~163-173) + reduced-motion block for [data-pv-conv-wip-dot] (lines ~175-181) + patch-#136 header comment referencing the dead pulse"
      contains: "pretty-view"
  key_links:
    - from: "src/ui/features/terminal/Terminal.tsx (isIdle useEffect)"
      to: "src/ui/state/session-working-store.ts (publishSessionWorking)"
      via: "direct import + call on [isIdle, hostConfig.id, tmuxSessionName] deps"
      pattern: "publishSessionWorking\\("
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "src/ui/state/session-working-store.ts (useSessionWorking)"
      via: "per-row hook inside map"
      pattern: "useSessionWorking\\("
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "src/ui/state/conversation-store.ts (useActiveSet)"
      via: "single top-level subscription"
      pattern: "useActiveSet\\(\\)"
    - from: "src/ui/state/conversation-store.ts (selectConversation)"
      to: "src/ui/state/conversation-store.ts (addToActiveSet)"
      via: "in-function side-effect after stale-guard + before/after selectedId mutation (last-write-wins on state notify)"
      pattern: "addToActiveSet\\("
    - from: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx (ready-dot render)"
      to: "prop contract inActiveSet && isWorking===false"
      via: "explicit strict equality check for the isWorking===false branch (null and true both suppress)"
      pattern: "inActiveSet.*isWorking\\s*===\\s*false"
---

<objective>
Wire two new visual signals into the pretty-conversations list per Ashley's 2026-07-23 LOCKED spec (patch #137, fork ordinal after #136 which shipped the every-row bubble+badge treatment + `isWip` render slot):

1. **Active-set** — sessionStorage-backed `Set<string>` of conversation ids Ashley has selected in this window session. Populated as a side-effect of `selectConversation`. Rows in the set keep the full patch #136 pretty-view bubble treatment; rows NOT in the set visually recede to the mock's ambient recession (dimmer hue rgba background, no drop shadow, no backdrop-blur, muted foreground).

2. **Ready-for-attention dot** — ONE dot, ONE meaning. Appears iff `inActiveSet(row) === true && isWorking(row) === false`. Absent = agent working, OR row is ambient, OR both. This is the click-priority signal driving her workflow. Steady (no animation) — the dot IS the affordance; a pulse would read as WIP-motion.

Patch #136's `isWip` prop is RENAMED to `isWorking` (now `boolean | null`) and its render condition is INVERTED. The dead `pv-conv-wip-pulse` keyframe + its reduced-motion fallback are removed from index.css (steady dot needs neither).

Purpose: Ashley's list must telegraph "what needs my attention next" at a glance. Active-set = "I have engaged with this recently." Ready-dot = "engaged AND agent is idle waiting on me." Ambient = "still open but backgrounded, quiet."

Output: 9 files touched (2 new — session-working-store + its test; 7 modified). One atomic commit `feat(pretty-conversations): patch #137 — wire active-set + ready-for-attention dot from session-working store` on `feat/tab-title-from-tmux`. NO Co-Authored-By trailer (fork commits don't use one). NO build, NO deploy, NO skynet-patches.md write-up (per Ashley's re-emphasized 2026-07-23 guardrails).

Locked planner choices (per task_spec §4/§6):
- **Ambient recession implementation:** Choice A — conditional inline `style` object driven by `isAmbient = !inActiveSet && !isRdp`, layered via spread under `hoverOverlay`/`selectedOverlay`/`bodyTransformStyle`. Mirrors the existing `selectedOverlay` pattern verbatim; simplest; no new stylesheet section required.
- **Ready-dot styles:** inline (matches the existing patch #136 dot inline-style pattern). index.css only REMOVES the dead pulse keyframes; no new CSS blocks added.
- **Ambient-hover treatment:** inline `hoverOverlay` branch — when `isAmbient && shouldHover`, spread the ambient-hover object (rgba shift, NO transform lift) INSTEAD of the full-bubble hover object. Layered via ternary inside `hoverOverlay` construction so selected still dominates.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/ubuntu/skynet/.planning/STATE.md
@/home/ubuntu/skynet/src/ui/state/conversation-store.ts
@/home/ubuntu/skynet/src/ui/state/conversation-store.test.ts
@/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx
@/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
@/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@/home/ubuntu/skynet/src/ui/features/terminal/Terminal.tsx
@/home/ubuntu/skynet/src/ui/index.css

**Reference prototype (READ-ONLY, do NOT modify):** `/home/ubuntu/.claude/identities/tina/bounties/conversation-list-bubble-badge-restyle/prototype.html` (v4 locked). Also served at `http://100.99.149.8:8899/conversation-list-bubble-badge-restyle/prototype.html` for visual reference.

**Interface exports to add (executor implements these signatures verbatim):**

```ts
// src/ui/state/session-working-store.ts
export function publishSessionWorking(key: string, isWorking: boolean | null): void;
export function useSessionWorking(key: string | null): boolean | null;
export function getSessionWorkingSnapshot(): ReadonlyMap<string, boolean | null>;
```

```ts
// src/ui/state/conversation-store.ts (additions)
export function addToActiveSet(id: string): void;
export function useActiveSet(): ReadonlySet<string>;
// selectConversation() signature UNCHANGED — active-set write is a side-effect inside its body
```

```tsx
// src/ui/features/pretty-conversations/PrettyConversationRow.tsx (prop diff)
// REMOVED:  isWip?: boolean
// ADDED:    isWorking?: boolean | null     // default null
// ADDED:    inActiveSet?: boolean          // default false
```

**Ambient recession mock values (verbatim from prototype v4 — DO NOT tweak):**
- Background: `linear-gradient` NOT used — flat `hsla(H, 40%, 20%, 0.16)`. Hue-null fallback: `rgba(45,55,80,0.12)`; RDP fallback: N/A (RDP never goes ambient).
- Border: `1px solid hsla(H, 40%, 45%, 0.14)` (hue-null: `rgba(120,140,180,0.12)`).
- Box-shadow: `inset 0 1px 0 rgba(255,220,170,0.06), 0 0 0 0.5px hsla(H, 60%, 55%, 0.08)` (hue-null: `inset 0 1px 0 rgba(220,225,245,0.05), 0 0 0 0.5px rgba(120,140,180,0.06)`).
- backdropFilter: `none`, WebkitBackdropFilter: `none`.
- color: `rgba(251,245,232,0.72)`.
- Ambient hover overlay: `background: hsla(H,45%,25%,0.26); borderColor: hsla(H,55%,55%,0.22); transform: none;` (NO translateY lift; NO shadow boost).
- Ambient avatar: `background: linear-gradient(160deg, hsla(H,35%,22%,0.55), hsla(H,30%,14%,0.65)); border: 1px solid hsla(H,55%,50%,0.24); boxShadow: 0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,235,190,0.14), 0 0 10px hsla(H,55%,50%,0.14);`. Hue-null fallback: parallel neutral rgba values.
- Ambient label: `textShadow: none; fontWeight: 500` (NOT semibold). Ambient host line: `color: rgba(255,235,190,0.45)`.

**Ready-dot mock values (verbatim from prototype v4):**
- Size: `width: 8px; height: 8px; borderRadius: 999px`.
- Background: `hsla(H, 60%, 80%, 1)` (hue-cream fill). Hue-null fallback: `rgba(240,235,224,1)` (bright neutral cream).
- Box-shadow: `0 0 10px 0px hsla(H, 70%, 60%, 0.7), 0 0 18px 2px hsla(H, 70%, 55%, 0.28), inset 0 1px 0 rgba(255,235,190,0.55)`. Hue-null fallback: parallel neutral rgba values with the same warm inset.
- Animation: NONE (steady).
- aria-label: `"ready"` (was `"working"` under patch #136).
- data attribute: `data-pv-conv-ready-dot="true"` (was `data-pv-conv-wip-dot="true"`).

**STATE.md notes (RE: CLAUDE.md staleness):** CLAUDE.md's 15-min deadman claim and "42 patches" count are stale (deadman retired 2026-07-21; current patch count is 136). Do NOT emit a deadman step, do NOT touch skynet-patches.md, do NOT bump any count.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: New session-working-store + Terminal.tsx wire-up</name>
  <files>
    src/ui/state/session-working-store.ts (NEW),
    src/ui/state/session-working-store.test.ts (NEW),
    src/ui/features/terminal/Terminal.tsx (MODIFIED — one useEffect addition ~line 244)
  </files>
  <behavior>
    - publishSessionWorking(key, isWorking): stores value in module-scoped Map<string, boolean|null>, bumps version, notifies subscribers only when value changed for that key (no-op notify guard).
    - useSessionWorking(key): returns `null` for unknown keys; returns stored value otherwise. Accepts `key: string | null` and returns `null` immediately when key is null (avoids useSyncExternalStore work).
    - getSessionWorkingSnapshot(): returns a ReadonlyMap view of the current state — for tests only.
    - Publishing `null` for a previously-set key overwrites to `null` (does NOT delete — a re-mount observing null after a known transition is semantically correct).
    - Multiple distinct keys are independent — publishing to key A does not affect key B's snapshot.
    - Store is NOT persisted to any storage layer — in-memory only.
    - Terminal.tsx's new useEffect fires on `[isIdle, hostConfig.id, tmuxSessionName]`; emits `publishSessionWorking(key, isIdle===null ? null : isIdle===false)` where `key = \`${hostConfig.id}:${tmuxSessionName ?? ''}\``. Early-returns when `hostConfig.id == null`.
    - Terminal.tsx: NOTHING else changes — no new useState, no WS handler edits, no isIdle setter changes, no unmount cleanup added to this effect (per §1 semantics: preserve last-known state across route changes).
  </behavior>
  <action>
    Create `src/ui/state/session-working-store.ts` mirroring the pattern of `src/ui/state/conversation-store.ts` verbatim: module-scoped `state` object with a `Map<string, boolean | null>`, `Set<() => void>` listener registry, `snapshotVersion` counter, `notify()` bumps + iterates listeners, `subscribe(cb)` returns disposer. Do NOT use zustand/jotai/redux — the fork rolls its own (see `identities-store.ts` / `conversation-store.ts` for reference).

    Export `publishSessionWorking(key: string, isWorking: boolean | null): void`:
    - Read current value: `const prev = state.map.get(key);`. If `prev === isWorking` AND `state.map.has(key)`, return (no-op — do not notify). Note: distinguish "never published" (has=false) from "explicitly null" (has=true, value=null).
    - Otherwise: build a new Map (structural sharing acceptable — `new Map(state.map)` then `.set(key, isWorking)`) and replace `state.map`. Notify.

    Export `useSessionWorking(key: string | null): boolean | null`:
    - When key is null, return null immediately (do NOT call useSyncExternalStore — avoids unnecessary subscription for RDP/host-less rows).
    - Otherwise use useSyncExternalStore with subscribe + a per-key getSnapshot closure that reads `state.map.get(key) ?? null`. Return value.

    Export `getSessionWorkingSnapshot()`: returns `state.map` (typed as `ReadonlyMap<string, boolean | null>`) — for test assertions.

    Also export a test-only reset helper `__resetForTest(): void` that clears the map + bumps version + notifies — needed so session-working-store.test.ts's `beforeEach` can start from empty state.

    Create `src/ui/state/session-working-store.test.ts` with 4 tests using Vitest + @testing-library/react's `renderHook`:
    1. `publishSessionWorking("h1:s1", true)` then `useSessionWorking("h1:s1")` returns `true`; then publish `false` and assert `false`; then publish `null` and assert `null` (proves publishing null overwrites, does not delete).
    2. `useSessionWorking("never-set")` returns `null` (unknown key semantics).
    3. `useSessionWorking(null)` returns `null` (null-key short-circuit).
    4. Publish `true` to `"h1:s1"` and `false` to `"h2:s2"`; assert `useSessionWorking("h1:s1")` returns `true` AND `useSessionWorking("h2:s2")` returns `false` (independent keys).

    Add `__resetForTest()` call in `beforeEach`.

    In `src/ui/features/terminal/Terminal.tsx`, ADD one import at the top with the other `@/state/*` imports: `import { publishSessionWorking } from "@/state/session-working-store";`.

    ADD this exact useEffect immediately after the existing `const [isIdle, setIsIdle] = useState<boolean | null>(null);` line (~line 244) — BEFORE the `autoOpenCheckedKeysRef` line (~line 245):

    ```
    useEffect(() => {
      const hostId = hostConfig.id;
      if (hostId == null) return;
      const key = `${hostId}:${tmuxSessionName ?? ""}`;
      publishSessionWorking(key, isIdle === null ? null : isIdle === false);
    }, [isIdle, hostConfig.id, tmuxSessionName]);
    ```

    DO NOT touch anything else in Terminal.tsx. DO NOT add a cleanup function (unmount must NOT clear per §1). DO NOT modify the existing `isIdle` useState line, WS handlers, or any surrounding effect. Confirm the file still tsc-clean.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "(session-working-store|Terminal\.tsx)" | grep -vE "^$" | wc -l | grep -qx "0" && npx vitest run src/ui/state/session-working-store.test.ts --reporter=basic 2>&1 | tail -20</automated>
    Also confirm:
    - `grep -c "publishSessionWorking" /home/ubuntu/skynet/src/ui/features/terminal/Terminal.tsx` returns exactly `2` (one import, one call).
    - `grep -c "publishSessionWorking\|useSessionWorking\|getSessionWorkingSnapshot" /home/ubuntu/skynet/src/ui/state/session-working-store.ts` returns >= `6` (3 exports × 2 definition-sites: once in signature, at least once in body).
    - `grep -c "sessionStorage\|localStorage" /home/ubuntu/skynet/src/ui/state/session-working-store.ts` returns exactly `0` (in-memory only per §1).
    - New session-working-store.test.ts is 4 tests all green.
  </verify>
  <done>
    - `src/ui/state/session-working-store.ts` exists and exports `publishSessionWorking`, `useSessionWorking`, `getSessionWorkingSnapshot`, `__resetForTest`.
    - `src/ui/state/session-working-store.test.ts` exists with 4 tests, all passing.
    - `src/ui/features/terminal/Terminal.tsx` has ONE new import (`publishSessionWorking`) and ONE new useEffect (~7 lines) adjacent to the existing `isIdle` useState declaration; every other line in the file is byte-identical to pre-patch.
    - `tsc --noEmit` clean across the modified files.
    - No sessionStorage/localStorage references in session-working-store.ts.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend conversation-store with sessionStorage-backed activeSet</name>
  <files>
    src/ui/state/conversation-store.ts (MODIFIED — add State.activeSet, hydration, addToActiveSet, useActiveSet, wire selectConversation),
    src/ui/state/conversation-store.test.ts (MODIFIED — new tests for activeSet)
  </files>
  <behavior>
    - On module load: read `sessionStorage.getItem("pv-conv-active-set")`; if present, `JSON.parse` → array → `new Set<string>()`. Wrap in try/catch — malformed JSON, empty string, missing key, or absent `sessionStorage` (SSR/JSDOM edge) ALL fall back to `new Set<string>()` silently. No console.warn.
    - `addToActiveSet(id: string): void` — idempotent. If `state.activeSet.has(id)` return without touching sessionStorage OR calling notify. Otherwise build a new Set (`new Set(state.activeSet)` + `.add(id)`), persist via `sessionStorage.setItem("pv-conv-active-set", JSON.stringify([...next]))` inside try/catch (silent), update `state.activeSet = next`, notify.
    - `useActiveSet(): ReadonlySet<string>` — useSyncExternalStore returning `state.activeSet`. New Set reference on every real mutation; same reference across no-ops.
    - `selectConversation(id)` — after the stale-id guard passes and BEFORE the "no change" short-circuit at line 575, if `id !== null` call `addToActiveSet(id)`. Placement rationale: even a same-id re-selection is a legitimate signal that Ashley is "engaging" with this conversation — the active-set should record it. addToActiveSet is idempotent so a repeat call is a cheap no-op.
    - Do NOT export `removeFromActiveSet` — the set only grows within a session.
    - `selectConversation(null)` does NOT touch activeSet (deselect is not a positive engagement signal).
  </behavior>
  <action>
    In `src/ui/state/conversation-store.ts`:

    1. Add `activeSet: Set<string>` to the `State` type (line ~115) directly under `hostsFlat` field. Include a JSDoc comment: `// Patch #137: sessionStorage-backed set of conversation ids Ashley has selected in this browser-tab session. Persisted under key "pv-conv-active-set" as a JSON array. Rehydrated on module load; grows only (no remove API); dies on tab close (sessionStorage semantics).`

    2. Add a top-level constant near the CONVERSATION_TAB_TYPES declaration: `const ACTIVE_SET_STORAGE_KEY = "pv-conv-active-set";`.

    3. Add a top-level helper `hydrateActiveSetFromStorage(): Set<string>` above the `state` initializer:

    ```
    function hydrateActiveSetFromStorage(): Set<string> {
      try {
        if (typeof sessionStorage === "undefined") return new Set<string>();
        const raw = sessionStorage.getItem(ACTIVE_SET_STORAGE_KEY);
        if (!raw) return new Set<string>();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set<string>();
        const out = new Set<string>();
        for (const v of parsed) if (typeof v === "string") out.add(v);
        return out;
      } catch {
        return new Set<string>();
      }
    }
    ```

    4. Change `let state: State = { ... }` initializer to include `activeSet: hydrateActiveSetFromStorage(),` at the end.

    5. Below the existing action exports (near `pinConversation`) add:

    ```
    // Patch #137: activeSet mutator. Idempotent no-op when the id is already
    // present (avoids gratuitous sessionStorage writes on repeat selects).
    // Silent try/catch on sessionStorage so SSR/JSDOM/quota-exceeded errors
    // never crash the UI thread.
    export function addToActiveSet(id: string): void {
      if (state.activeSet.has(id)) return;
      const nextActiveSet = new Set(state.activeSet);
      nextActiveSet.add(id);
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(
            ACTIVE_SET_STORAGE_KEY,
            JSON.stringify([...nextActiveSet]),
          );
        }
      } catch {
        // Silent — do not block state update on storage failure.
      }
      state = { ...state, activeSet: nextActiveSet };
      notify();
    }
    ```

    6. Below `usePinnedIds` hook add `useActiveSet`:

    ```
    function getActiveSetSnapshot(): ReadonlySet<string> {
      return state.activeSet;
    }
    export function useActiveSet(): ReadonlySet<string> {
      return useSyncExternalStore(
        subscribe,
        getActiveSetSnapshot,
        getActiveSetSnapshot,
      );
    }
    ```

    7. Inside `selectConversation(id)`: after the existing stale-guard block (lines 559-568) and after the `pendingSelectId = null;` clear (line 574), but BEFORE the `if (id === state.selectedId) return;` short-circuit (line 575), insert:

    ```
    // Patch #137: every non-null selection is an active-set engagement
    // signal — record it BEFORE the same-selectedId short-circuit so a
    // re-select of the currently-selected id still counts. addToActiveSet
    // is idempotent so this is a cheap no-op when the id is already present.
    if (id !== null) addToActiveSet(id);
    ```

    In `src/ui/state/conversation-store.test.ts`:

    Add a top-level `beforeEach` sessionStorage reset — inside the existing `beforeEach` at line 61, add `sessionStorage.clear();` as the very first statement (before `updateOpenTabs([])`).

    Add three new tests at the END of the file (after the last existing test):

    - Test N+1 `"patch #137: selectConversation(id) adds id to activeSet AND writes to sessionStorage"`:
      - Push a tab into openTabs (via `updateOpenTabs([makeTab("t-A", "terminal", makeHost("hA", "nasty"))])`).
      - `selectConversation("t-A")`.
      - `const { result } = renderHook(() => useActiveSet());` → assert `result.current.has("t-A") === true`.
      - `const raw = sessionStorage.getItem("pv-conv-active-set");` → assert `JSON.parse(raw!)` includes `"t-A"`.

    - Test N+2 `"patch #137: selectConversation(id) is idempotent on repeat calls (no duplicate sessionStorage write)"`:
      - Same setup + first select.
      - Spy on `sessionStorage.setItem` via `vi.spyOn(Storage.prototype, "setItem")` AFTER the first select.
      - Second `selectConversation("t-A")`.
      - Assert `spy.mock.calls.filter(([k]) => k === "pv-conv-active-set").length === 0` (no write from the second call).

    - Test N+3 `"patch #137: module-init hydrates activeSet from sessionStorage"`:
      - Pre-seed: `sessionStorage.setItem("pv-conv-active-set", JSON.stringify(["seed-1", "seed-2"]));`.
      - Use Vitest's `vi.resetModules()` + dynamic `await import("./conversation-store")` to force re-execution of the module-scope hydration.
      - `const { useActiveSet: reImportedHook } = await import(...); const { result } = renderHook(() => reImportedHook());`.
      - Assert `result.current.has("seed-1") && result.current.has("seed-2")` AND `result.current.size === 2`.

    Note for executor: the module-init test may fight Vitest module caching depending on the fork's vite/vitest config. If `vi.resetModules()` proves flaky, fall back to a direct-invocation of the exported `hydrateActiveSetFromStorage` — export it with an `__` prefix (`__hydrateActiveSetForTest`) and assert its return contains the seeded ids. Prefer the `vi.resetModules()` path first; only use the fallback if it fails after one iteration.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep "conversation-store" | wc -l | grep -qx "0" && npx vitest run src/ui/state/conversation-store.test.ts --reporter=basic 2>&1 | tail -30</automated>
    Also confirm:
    - `grep -v '^\s*//' /home/ubuntu/skynet/src/ui/state/conversation-store.ts | grep -c "addToActiveSet\|useActiveSet\|activeSet" ` returns `>= 8` (State field + hydrate helper + mutator body + hook + selectConversation call site + type refs).
    - `grep -c "ACTIVE_SET_STORAGE_KEY\|pv-conv-active-set" /home/ubuntu/skynet/src/ui/state/conversation-store.ts` returns >= `3` (constant declaration + hydrate read + mutator write).
    - `grep -c "sessionStorage" /home/ubuntu/skynet/src/ui/state/conversation-store.ts` returns >= `3` (hydrate typeof check + hydrate getItem + mutator setItem + at least one typeof guard on mutator side).
    - All existing conversation-store.test.ts tests still pass (regression proof); the 3 new tests pass; total pass count increases by 3.
  </verify>
  <done>
    - `State.activeSet` field added and initialized from sessionStorage via `hydrateActiveSetFromStorage()`.
    - `addToActiveSet(id)` exported, idempotent, silent-fail on sessionStorage errors.
    - `useActiveSet()` hook exported, mirrors `usePinnedIds` shape (ReadonlySet return).
    - `selectConversation(id)` calls `addToActiveSet(id)` for non-null ids after stale-guard, before same-id short-circuit.
    - 3 new tests green in `conversation-store.test.ts`; existing tests unchanged.
    - `tsc --noEmit` clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: PrettyConversationRow prop rename + ready-dot inversion + ambient recession</name>
  <files>
    src/ui/features/pretty-conversations/PrettyConversationRow.tsx (MODIFIED),
    src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx (MODIFIED — update Test 13, add Tests 15/16/17/18)
  </files>
  <behavior>
    - Prop `isWip?: boolean` REMOVED. NEW prop `isWorking?: boolean | null` (default `null`). NEW prop `inActiveSet?: boolean` (default `false`).
    - Dot renders IFF `inActiveSet === true && isWorking === false` (strict equality — `null` and `true` both suppress).
    - Dot uses `aria-label="ready"`, `data-pv-conv-ready-dot="true"`, steady inline styles (see mock values in `<context>`); NO `animation` string in inline style.
    - `isAmbient = !inActiveSet && !isRdp` — when true, override `baseBodyStyle` to the ambient recession values (flat hsla background, ambient border, minimal inset+hairline shadow, NO backdropFilter, `color: rgba(251,245,232,0.72)`). Layered ORDER preserved: ambient → hover (ambient-hover branch replaces full-bubble hover when `isAmbient`) → selected → transform. Selected still dominates (an ambient row that becomes selected returns to the strongest treatment — Test 18 explicitly covers non-selected ambient).
    - Ambient avatar: when `isAmbient` and `hue != null`, override `avatarStyle` to the ambient linear-gradient + ambient border + ambient shadow. Hue-null ambient rows use neutral rgba fallback. RDP rows never reach the ambient avatar branch.
    - Ambient label: when `isAmbient`, override label span's `textShadow: "none"` and `fontWeight: 500` (not `font-semibold`). Ambient host line color shifts to `rgba(255,235,190,0.45)`.
    - RDP rows (`isRdp === true`): NEVER go ambient. The dot NEVER renders on RDP rows regardless of `inActiveSet`/`isWorking` — the ambient branch is short-circuited by `isRdp` in `isAmbient` derivation, and the dot render condition is unchanged (RDP rows can be `inActiveSet===true` if someone selects them, but the dot condition still requires `isWorking===false` which for an RDP row would come from useSessionWorking returning null in the panel — the panel passes `isWorking={null}` for RDP rows because their sessionWorkingKey resolves to an empty session name).
    - Prop-not-provided branch: when the panel omits `isWorking` and `inActiveSet` (test render sites in existing Tests 1-11), the row must behave identically to the pre-patch #136 baseline. Test 1's selected-row hue treatment (Test 1 in the current file) still passes.
    - The stale `isWip` comment in the props type body is fully removed. New JSDoc explains the two new props' semantics.
    - Prop rename cascades: rename `isWip` → `isWorking` in the destructured props at the function signature. Delete the `isWip` line entirely; do NOT keep it as a deprecated alias.
  </behavior>
  <action>
    In `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`:

    1. Update the file-header block comment (lines 1-50): rename `#136` render slot section (line 32-36) to describe patch #137's ready-dot semantics + ambient recession. Preserve every non-related line byte-for-byte. Suggested rewrite for lines 32-36:

    ```
    //   7. `isWorking` + `inActiveSet` props (patch #137 wires the store):
    //      Ready-dot renders as the LAST child in the right-meta column iff
    //      `inActiveSet === true && isWorking === false`. aria-label="ready",
    //      data-pv-conv-ready-dot="true", steady (no animation). Ambient rows
    //      (`!inActiveSet && !isRdp`) recede visually — flat hue rgba
    //      background, no drop shadow, no backdrop-blur, muted foreground.
    //      RDP rows are exempt from ambient recession and never render the dot.
    ```

    2. Update the props typedef (lines 83-108):
       - REMOVE the `isWip?: boolean` line entirely.
       - REMOVE the `isWip = false,` default in destructuring.
       - ADD `isWorking = null,` and `inActiveSet = false,` defaults.
       - REPLACE the isWip JSDoc block (lines 102-107) with:

    ```
    // Patch #137: WS-published working state for the row's (host, tmux)
    // pair. `true` = agent busy, `false` = idle, `null` = unknown
    // (backend hasn't published yet). Only `false` allows the ready-dot
    // to render; `null` and `true` both suppress. Panel resolves via
    // useSessionWorking(sessionWorkingKey(row)).
    isWorking?: boolean | null;
    // Patch #137: whether this row is in Ashley's active-set (any
    // session she has selectConversation-ed in this browser-tab
    // session). Rows in the set keep the patch #136 full-bubble
    // treatment; rows out of the set recede to the ambient values
    // (per prototype v4). RDP rows are exempt from ambient recession
    // regardless of this flag.
    inActiveSet?: boolean;
    ```

    3. Add the ambient derivation right after `const isRdp = row.rdpHostRow === true;` (line 115):

    ```
    // Patch #137: ambient recession applies to non-RDP rows NOT in
    // Ashley's active-set. Layered as an early override in the body-
    // bubble derivation below; also drives ambient avatar + ambient
    // label branches.
    const isAmbient = !isRdp && !inActiveSet;
    ```

    4. Refactor `avatarStyle` (lines 138-158) — wrap the existing IIFE so it returns the ambient branch when `isAmbient` (and hue-null-safe). Insertion order INSIDE the IIFE at the very top:

    ```
    if (isAmbient) {
      if (hue == null) {
        return {
          background: "linear-gradient(160deg, rgba(45,55,80,0.55), rgba(28,35,55,0.65))",
          border: "1px solid rgba(120,140,180,0.24)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(220,225,245,0.14), 0 0 10px rgba(120,140,180,0.14)",
          color: "var(--color-pv-fg-muted)",
        };
      }
      return {
        background: `linear-gradient(160deg, hsla(${hue}, 35%, 22%, 0.55), hsla(${hue}, 30%, 14%, 0.65))`,
        border: `1px solid hsla(${hue}, 55%, 50%, 0.24)`,
        boxShadow: `0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,235,190,0.14), 0 0 10px hsla(${hue}, 55%, 50%, 0.14)`,
        color: "#fbf5e8",
      };
    }
    ```
    Preserve the existing non-ambient branches (isRdp || hue==null and the hue-driven default) verbatim below.

    5. Refactor `baseBodyStyle` (lines 206-214): wrap the current shape in a ternary keyed on `isAmbient`. When `isAmbient` (implicit non-RDP):

    ```
    const ambientBase: CSSProperties = hue == null
      ? {
          background: "rgba(45,55,80,0.12)",
          border: "1px solid rgba(120,140,180,0.12)",
          boxShadow:
            "inset 0 1px 0 rgba(220,225,245,0.05), 0 0 0 0.5px rgba(120,140,180,0.06)",
          borderRadius: 14,
          color: "rgba(251,245,232,0.72)",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
        }
      : {
          background: `hsla(${hue}, 40%, 20%, 0.16)`,
          border: `1px solid hsla(${hue}, 40%, 45%, 0.14)`,
          boxShadow:
            `inset 0 1px 0 rgba(255,220,170,0.06), 0 0 0 0.5px hsla(${hue}, 60%, 55%, 0.08)`,
          borderRadius: 14,
          color: "rgba(251,245,232,0.72)",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
        };
    ```

    Then `const baseBodyStyle: CSSProperties = isAmbient ? ambientBase : {full-bubble-object-unchanged};`. This preserves the existing full-bubble body (patch #136) for non-ambient rows byte-for-byte.

    6. Refactor `hoverOverlay` (lines 267-273): when `isAmbient && shouldHover`, spread the ambient-hover object INSTEAD of the full-bubble hover object. Add:

    ```
    const ambientHoverOverlay: CSSProperties = hue == null
      ? { background: "rgba(45,55,80,0.20)", borderColor: "rgba(120,140,180,0.22)" }
      : { background: `hsla(${hue}, 45%, 25%, 0.26)`, borderColor: `hsla(${hue}, 55%, 55%, 0.22)` };
    const hoverOverlay: CSSProperties = shouldHover
      ? (isAmbient ? ambientHoverOverlay : { /* existing full-bubble hover verbatim */ })
      : {};
    ```

    NOTE: ambient hover has NO transform lift, NO shadow boost — only background/border-color shifts.

    7. Update the label span (lines 526-534): add inline style overrides when `isAmbient`:

    ```
    style={{
      letterSpacing: "-0.005em",
      ...(isAmbient
        ? { textShadow: "none", fontWeight: 500 }
        : { textShadow: "0 1px 2px rgba(0,0,0,0.4)" }),
    }}
    ```
    Also, when isAmbient, drop the `font-semibold` class token — do this by making the className conditional: `${labelTextSize} ${isAmbient ? 'font-medium' : 'font-semibold'} text-[#fbf5e8] truncate leading-tight`. Note: Tailwind `font-medium` = 500, matches the ambient spec.

    8. Update the host line (lines 536-549): when isAmbient, override the Server icon color and text color to `rgba(255,235,190,0.45)` (was `rgba(255,235,190,0.65)`). Simplest: `const hostLineColor = isAmbient ? "rgba(255,235,190,0.45)" : "rgba(255,235,190,0.65)";` computed at top and used in both style objects.

    9. REPLACE the dot render block (lines 580-604) with the ready-dot:

    ```
    {/* Patch #137 ready-dot — signals "engaged AND agent idle, ready
        for Ashley's next input." Renders as LAST child in the
        right-meta column (after PinAction + pin glyph) iff
        inActiveSet && isWorking === false. Steady (no animation) —
        the dot IS the affordance; a pulse would read as WIP-motion.
        aria-label="ready", data-pv-conv-ready-dot="true". Hue-cream
        fill with hue outer glow + warm inset per prototype v4;
        neutral rgba fallback when hue is null. */}
    {inActiveSet && isWorking === false && (
      <span
        aria-label="ready"
        data-pv-conv-ready-dot="true"
        className="inline-block rounded-full"
        style={{
          width: 8,
          height: 8,
          background:
            hue == null
              ? "rgba(240,235,224,1)"
              : `hsla(${hue}, 60%, 80%, 1)`,
          boxShadow:
            hue == null
              ? "0 0 10px 0px rgba(240,235,224,0.7), 0 0 18px 2px rgba(240,235,224,0.28), inset 0 1px 0 rgba(255,235,190,0.55)"
              : `0 0 10px 0px hsla(${hue}, 70%, 60%, 0.7), 0 0 18px 2px hsla(${hue}, 70%, 55%, 0.28), inset 0 1px 0 rgba(255,235,190,0.55)`,
        }}
      />
    )}
    ```

    Note the removed `animation` style key — dot is steady.

    10. In `PrettyConversationRow.test.tsx`:

    Update the test-file header block (lines 1-26) — change "14 tests" to "17 tests" (13 updated + 15/16/17/18 added = 4 new/updated, total 15-14+4 = 17). Renumber test list annotations for tests 13/15/16/17/18. Preserve Tests 1-12 and Test 14 header lines byte-identical (they don't change semantically).

    Update Test 13 (lines ~586-609) — rename describe + it, invert semantics:

    ```
    describe("PrettyConversationRow: patch #137 ready-dot render", () => {
      it("Test 13: inActiveSet+isWorking===false renders ready-dot with aria-label='ready'", () => {
        currentIdentity = makeIdentity(210, "nelly");
        const { getByLabelText, queryByLabelText } = render(
          <PrettyConversationRow
            row={makeRow()}
            selected={false}
            pinned={false}
            variant="desktop"
            onSelect={vi.fn()}
            onTogglePin={vi.fn()}
            inActiveSet={true}
            isWorking={false}
          />,
        );
        const dot = getByLabelText("ready") as HTMLElement;
        expect(dot.getAttribute("data-pv-conv-ready-dot")).toBe("true");
        // Steady — no animation string in style.
        expect(dot.style.animation).toBe("");
        // Regression: old wip aria-label must be absent.
        expect(queryByLabelText("working")).toBeNull();
      });
    });
    ```

    Update Test 14 (patch #136 neutral fallback — RDP row): rewrite in the SAME spirit but for the ready-dot semantics. Set `inActiveSet={true}, isWorking={false}` alongside `rdpHostRow: true`. Under patch #137, RDP rows in the active-set with isWorking===false WOULD show the dot (spec is agnostic to RDP for the render condition — see behavior note above). Assert the neutral rgba fallback is used (not hsla). Suggested:

    ```
    it("Test 14: RDP row with inActiveSet+isWorking===false uses neutral rgba dot", () => {
      const { getByLabelText } = render(
        <PrettyConversationRow
          row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
          selected={false}
          pinned={false}
          variant="desktop"
          onSelect={vi.fn()}
          onTogglePin={vi.fn()}
          inActiveSet={true}
          isWorking={false}
        />,
      );
      const dot = getByLabelText("ready") as HTMLElement;
      const rawStyle = dot.getAttribute("style") ?? "";
      expect(rawStyle).toContain("rgba(240,235,224");
      expect(rawStyle).not.toContain("hsla(");
    });
    ```

    ADD Test 15:
    ```
    describe("PrettyConversationRow: patch #137 ready-dot suppression — working", () => {
      it("Test 15: inActiveSet+isWorking===true renders NO ready-dot", () => {
        currentIdentity = makeIdentity(210);
        const { queryByLabelText } = render(
          <PrettyConversationRow row={makeRow()} selected={false} pinned={false}
            variant="desktop" onSelect={vi.fn()} onTogglePin={vi.fn()}
            inActiveSet={true} isWorking={true} />,
        );
        expect(queryByLabelText("ready")).toBeNull();
      });
    });
    ```

    ADD Test 16:
    ```
    describe("PrettyConversationRow: patch #137 ready-dot suppression — unknown", () => {
      it("Test 16: inActiveSet+isWorking===null renders NO ready-dot", () => {
        currentIdentity = makeIdentity(210);
        const { queryByLabelText } = render(
          <PrettyConversationRow row={makeRow()} selected={false} pinned={false}
            variant="desktop" onSelect={vi.fn()} onTogglePin={vi.fn()}
            inActiveSet={true} isWorking={null} />,
        );
        expect(queryByLabelText("ready")).toBeNull();
      });
    });
    ```

    ADD Test 17:
    ```
    describe("PrettyConversationRow: patch #137 ready-dot suppression — ambient", () => {
      it("Test 17: !inActiveSet+isWorking===false renders NO ready-dot (ambient never shows it)", () => {
        currentIdentity = makeIdentity(210);
        const { queryByLabelText } = render(
          <PrettyConversationRow row={makeRow()} selected={false} pinned={false}
            variant="desktop" onSelect={vi.fn()} onTogglePin={vi.fn()}
            inActiveSet={false} isWorking={false} />,
        );
        expect(queryByLabelText("ready")).toBeNull();
      });
    });
    ```

    ADD Test 18:
    ```
    describe("PrettyConversationRow: patch #137 ambient recession", () => {
      it("Test 18: !inActiveSet && !isRdp row applies ambient body style (flat hsla background, no drop shadow, no backdrop-blur)", () => {
        currentIdentity = makeIdentity(210, "nelly");
        const { container } = render(
          <PrettyConversationRow row={makeRow()} selected={false} pinned={false}
            variant="desktop" onSelect={vi.fn()} onTogglePin={vi.fn()}
            inActiveSet={false} /* isWorking omitted — defaults to null */ />,
        );
        const wrapper = container.querySelector('[data-conversation-id="conv-1"]') as HTMLElement;
        const body = wrapper.querySelector('[role="button"]') as HTMLElement;
        const rawStyle = body.getAttribute("style") ?? "";
        // Ambient flat hsla background (not linear-gradient)
        expect(rawStyle).toContain("hsla(210, 40%, 20%, 0.16)");
        // NO backdrop-filter (or explicitly "none")
        expect(rawStyle.replace(/\s/g, "")).toMatch(/backdrop-filter:none|backdropfilter:none/i);
        // NO 8px+ drop shadow (patch #136 signature was "0 8px 24px rgba(0,0,0,0.5)")
        expect(rawStyle).not.toContain("0 8px 24px");
      });

      it("Test 18b: RDP row is EXEMPT from ambient — inActiveSet=false still uses neutral bubble treatment (not ambient)", () => {
        const { container } = render(
          <PrettyConversationRow row={makeRow({ rdpHostRow: true, targetTmuxSession: null })}
            selected={false} pinned={false} variant="desktop"
            onSelect={vi.fn()} onTogglePin={vi.fn()}
            inActiveSet={false} isWorking={null} />,
        );
        const wrapper = container.querySelector('[data-conversation-id="conv-1"]') as HTMLElement;
        const body = wrapper.querySelector('[role="button"]') as HTMLElement;
        const rawStyle = body.getAttribute("style") ?? "";
        // Neutral full-bubble treatment retained — rgba(60,65,80,0.42) is the RDP baseline (patch #136 body).
        expect(rawStyle).toContain("rgba(60,65,80");
        // Full-bubble drop shadow signature — proves RDP did NOT go ambient.
        expect(rawStyle).toContain("0 8px 24px");
      });
    });
    ```

    Confirm existing Tests 1-12 still pass without prop-shape edits (they omit both new props and rely on defaults). Test 12 (patch #136 full-bubble) must still pass because it omits `inActiveSet` (defaults to false) — WAIT: `inActiveSet: false` means ambient per new logic, which would break Test 12's assertion of `linear-gradient(160deg, ` with 0.55/0.6 alphas. RESOLUTION: Test 12 needs one prop addition — pass `inActiveSet={true}` explicitly so it continues to assert the full-bubble treatment (which was the pre-patch-#137 default). Update Test 12's render call to include `inActiveSet={true}` and add a code comment inside the it() body: `// Patch #137: inActiveSet=true keeps the row in the full-bubble treatment; the ambient-vs-full body branch is exercised by Test 18.`

    Same one-prop-addition (`inActiveSet={true}`) is needed for Test 1 (selected-row hue) — but wait, Test 1's row is `selected={true}` which layers selectedOverlay ON TOP of baseBodyStyle. If baseBodyStyle is ambient AND selected overlays, the selected border/shadow still dominate but the background stays ambient. Test 1's assertion is `linear-gradient(160deg` in the raw style — which under ambient becomes `hsla(30, 40%, 20%, 0.16)` (flat, NOT gradient). RESOLUTION: Test 1 also needs `inActiveSet={true}` added. Same one-prop-addition. Alternatively: the executor could argue selected rows should always get the full bubble regardless of inActiveSet (a defensible design choice per Ashley's spec: selected = current focus = always full treatment). This is a small planner-discretion call — LOCKED: prefer the explicit-prop route (add `inActiveSet={true}` to Test 1) because it keeps the render logic simpler (isAmbient = !inActiveSet && !isRdp, no selected-override). The panel will always pass inActiveSet={true} for a selected row (selectConversation always adds to activeSet), so this is behaviorally identical.

    Sanity-scan all other existing tests (Tests 2-11): none of them assert body background/shadow contents — they assert data-attributes, swipe state, click behavior, avatar SVG presence. Under the new ambient default they will render ambient bodies but their assertions do not read body style keys, so they PASS unchanged.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "PrettyConversationRow" | wc -l | grep -qx "0" && npx vitest run src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx --reporter=basic 2>&1 | tail -30</automated>
    Also confirm:
    - `grep -c "isWip" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx` returns exactly `0` (rename complete, no stragglers).
    - `grep -c "data-pv-conv-wip-dot" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx` returns exactly `0`.
    - `grep -c "data-pv-conv-ready-dot" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx` returns exactly `1`.
    - `grep -c "pv-conv-wip-pulse\|animation:" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — the wip-pulse count MUST be `0`; the file may still have zero `animation:` inline styles (steady dot means no animation strings in the ready-dot block).
    - `grep -c "isWorking\|inActiveSet\|isAmbient" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx` returns >= `10` (props + defaults + derivation + branches).
    - vitest: PrettyConversationRow.test.tsx passes 17/17 tests (was 14; +Test 15/16/17/18b, - none removed; 15 unique it()-blocks now that Test 18 has an 18b sub-case; count includes them all).
  </verify>
  <done>
    - `PrettyConversationRow.tsx` prop rename complete; `isWip` fully gone; `isWorking`/`inActiveSet` in place with correct defaults.
    - Ready-dot renders only under strict `inActiveSet===true && isWorking===false`; steady inline styles per mock.
    - Ambient recession derives `isAmbient = !inActiveSet && !isRdp` and layers under the existing hover/selected overlay chain; ambient avatar + ambient label + ambient host-line branches wired.
    - RDP rows exempt from ambient.
    - Test 13 renamed + inverted; Tests 15/16/17/18 added; Tests 1/12 patched with explicit `inActiveSet={true}` prop to preserve their intended treatment.
    - `tsc --noEmit` clean; PrettyConversationRow.test.tsx passes all tests including patch #137 additions.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: PrettyConversationsPanel wire-up + index.css dead code removal + commit</name>
  <files>
    src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (MODIFIED — 3 render-site prop swap + hoisted useActiveSet + sessionWorkingKey helper),
    src/ui/index.css (MODIFIED — remove @keyframes pv-conv-wip-pulse + reduced-motion block + patch #136 header comment)
  </files>
  <behavior>
    - `useActiveSet()` called ONCE at the top of the panel component alongside the existing hook trio.
    - New local helper `sessionWorkingKey(row)` returns `${row.host.id}:${row.targetTmuxSession ?? ""}` when `row.host != null`, else returns `null` (RDP rows and host-less rows get null → useSessionWorking short-circuits to null → dot suppressed).
    - Each of the 3 render sites (pinned map, regular-host map, RDP-sentinel map) swaps `isWip={false}` for:
        ```
        isWorking={useSessionWorking(sessionWorkingKey(row))}
        inActiveSet={activeSet.has(row.id)}
        ```
      where `activeSet` is the ReadonlySet from `useActiveSet()`.
    - Rules-of-Hooks compliance: `useSessionWorking` MUST be called at the top level of the render function (not conditionally). Since each row is rendered inside a `.map()` callback, the hook call inside the callback is legal only because the array's length and identity are stable across renders per React docs — but this is fragile. SAFER pattern: extract a `<PrettyConversationRowWithLiveWorking>` micro-component that receives `row` + `inActiveSet` as props and internally calls `useSessionWorking(sessionWorkingKey(row))` before rendering the underlying `PrettyConversationRow`. This isolates the hook call to a stable per-row component instance (React's reconciler keeps hook order stable across renders of the same row).
    - The stale `// isWip={false} pass-through — patch #136 render slot; patch #137 will wire this to the WIP-vs-idle store subscription` comment (lines 268-271) is replaced with a short comment noting the wiring is now live per patch #137.
    - `@keyframes pv-conv-wip-pulse` block (index.css lines ~163-173) and the reduced-motion `[data-pv-conv-wip-dot="true"]` block (lines ~175-181) are DELETED. The header comment block for patch #136 (lines ~154-162) is also deleted OR retasked to point to patch #137's inline dot (executor's choice — LOCKED: delete the entire header block, keep the file compact; the ready-dot is fully inline in PrettyConversationRow with no shared CSS to document).
    - No other index.css changes — leave every other pretty-view token / keyframe / media query byte-identical.
    - Final atomic commit lands on the current branch (`feat/tab-title-from-tmux`). Subject exactly: `feat(pretty-conversations): patch #137 — wire active-set + ready-for-attention dot from session-working store`. NO Co-Authored-By trailer.
  </behavior>
  <action>
    In `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:

    1. Update imports (line 43-54): add `useActiveSet` to the `@/state/conversation-store` named-import group, and add a new import line `import { useSessionWorking } from "@/state/session-working-store";`.

    2. Below the existing `pinnedIds` hook call (line 101), add `const activeSet = useActiveSet();`.

    3. Add a small helper below the destructured props block (right above the `const [newSessionDialogOpen ...]` line at line 104):

    ```
    // Patch #137: derive the (hostId:tmuxSessionName) key used by the
    // session-working-store to look up the row's live isWorking state.
    // Rows without a host (fleet-only pre-resolution races) or with
    // no tmux session (RDP rows carry targetTmuxSession=null) resolve
    // to null → useSessionWorking short-circuits to null → dot
    // suppressed at the row level.
    const sessionWorkingKey = (row: ConversationRowShape): string | null => {
      if (!row.host) return null;
      return `${row.host.id}:${row.targetTmuxSession ?? ""}`;
    };
    ```

    4. Define a micro-component ABOVE the exported `PrettyConversationsPanel` function (top of file, after imports):

    ```
    // Patch #137: micro-wrapper that reads the row's live isWorking
    // state from session-working-store. Extracted so useSessionWorking
    // sits at a stable hook-call site (top of an instance component)
    // rather than inside a .map() callback — Rules-of-Hooks compliance.
    function PrettyConversationRowLive(props: {
      row: ConversationRowShape;
      selected: boolean;
      pinned: boolean;
      variant: "mobile" | "desktop";
      onSelect: () => void;
      onTogglePin: () => void;
      onSwipeOpenChange?: (open: boolean) => void;
      forceClosed?: boolean;
      inActiveSet: boolean;
      sessionKey: string | null;
    }) {
      const { sessionKey, inActiveSet, ...rowProps } = props;
      const isWorking = useSessionWorking(sessionKey);
      return (
        <PrettyConversationRow
          {...rowProps}
          isWorking={isWorking}
          inActiveSet={inActiveSet}
        />
      );
    }
    ```

    5. Replace the three `<PrettyConversationRow ... isWip={false} />` render sites with `<PrettyConversationRowLive ... inActiveSet={activeSet.has(row.id)} sessionKey={sessionWorkingKey(row)} />`. Remove the `isWip={false}` prop entirely at each site. Preserve every OTHER prop (row/selected/pinned/variant/onSelect/onTogglePin/onSwipeOpenChange/forceClosed) verbatim.

       Sites to touch:
       - Pinned map (~line 267-288): swap `PrettyConversationRow` → `PrettyConversationRowLive`; remove `isWip={false}`; add `inActiveSet={activeSet.has(row.id)}` and `sessionKey={sessionWorkingKey(row)}`.
       - Regular host map (~line 338-357): same swap.
       - RDP sentinel map (~line 321-332): same swap — but confirm `sessionWorkingKey(row)` returns null (RDP rows have `targetTmuxSession: null`, so key is `${host.id}:` — non-null but a "known no-session" key. This still returns null in the store on first read, so the dot is suppressed. Verified consistent with §4 semantics.)

    6. Replace the stale comment block at lines 267-272 (`// isWip={false} pass-through — patch #136 render slot; patch #137 will wire this to...`) with:

    ```
    // Patch #137: live isWorking + inActiveSet wiring per row. The
    // panel-level activeSet subscription is hoisted once; each row's
    // isWorking is read via a per-row PrettyConversationRowLive
    // micro-component (Rules-of-Hooks safety inside .map()).
    ```

    In `src/ui/index.css`:

    1. DELETE lines ~154-162 (the entire `/* ── Patch #136: pretty-conversations WIP pulse-dot ──── ... */` header comment block).

    2. DELETE the `@keyframes pv-conv-wip-pulse { ... }` block (~lines 163-173).

    3. DELETE the reduced-motion block `@media (prefers-reduced-motion: reduce) { [data-pv-conv-wip-dot="true"] { ... } }` (~lines 175-181).

    4. Preserve every other CSS byte — the OTHER `@media (prefers-reduced-motion: reduce)` block at line 634 is unrelated and MUST stay.

    Confirm final file has zero references to `pv-conv-wip-pulse` and zero references to `data-pv-conv-wip-dot` anywhere.

    Final commit steps:
    1. Run one full-repo `npx tsc --noEmit` — must be clean.
    2. Run `npx vitest run --reporter=basic` — assert no new regressions (baseline going in: ~504/506 or similar per STATE.md; new tests bump the numerator by at least Task 1's 4 tests + Task 2's 3 tests + Task 3's 4 new + 1 modified = +11 net-new). Executor: record the exact before/after numbers in the commit body.
    3. `git status` to confirm exactly these 9 files are dirty:
       - `src/ui/state/conversation-store.ts`
       - `src/ui/state/conversation-store.test.ts`
       - `src/ui/state/session-working-store.ts`
       - `src/ui/state/session-working-store.test.ts`
       - `src/ui/features/terminal/Terminal.tsx`
       - `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`
       - `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx`
       - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
       - `src/ui/index.css`
    4. `git add` those 9 files by name (do NOT use `git add -A`).
    5. `git commit -m "$(cat <<'EOF'\nfeat(pretty-conversations): patch #137 — wire active-set + ready-for-attention dot from session-working store\n\n<body — 2-4 short lines summarizing: 1. new session-working-store publishes from Terminal.tsx's isIdle transitions; 2. conversation-store activeSet grows via selectConversation side-effect and persists to sessionStorage; 3. PrettyConversationRow's dot inverts to inActiveSet && !isWorking with ambient recession for out-of-set rows; 4. tests updated + added.>\nEOF\n)"`. NO `Co-Authored-By` trailer.
    6. `git log --oneline -3` to confirm the commit landed.

    DO NOT run `npm run build`. DO NOT run `docker compose up`. DO NOT push. DO NOT touch `~/.claude/identities/tina/skynet-patches.md`.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | tail -5 && grep -v '^\s*//' /home/ubuntu/skynet/src/ui/index.css | grep -c "pv-conv-wip-pulse\|data-pv-conv-wip-dot" | grep -qx "0" && grep -v '^\s*//' /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | grep -c "isWip" | grep -qx "0" && npx vitest run src/ui/features/pretty-conversations/ src/ui/state/ --reporter=basic 2>&1 | tail -30 && git log --oneline -1 | grep -q "patch #137"</automated>
    Also confirm:
    - `grep -c "useActiveSet\(\)" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns exactly `1` (hoisted single subscription).
    - `grep -c "useSessionWorking" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns exactly `2` (import + call inside PrettyConversationRowLive).
    - `grep -c "PrettyConversationRowLive" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns >= `4` (definition + 3 render sites).
    - `grep -c "isWip" /home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns exactly `0`.
    - `git diff HEAD~1 --stat` shows exactly 9 files modified (2 new, 7 modified) with reasonable line counts.
    - `git log -1 --format=%B` does NOT contain the string `Co-Authored-By`.
  </verify>
  <done>
    - Panel threads live signals at all 3 render sites via `PrettyConversationRowLive` micro-component; `useActiveSet()` hoisted once.
    - `sessionWorkingKey(row)` helper returns `null` for host-less rows and a `${hostId}:${targetTmuxSession ?? ""}` string otherwise.
    - `index.css` has zero references to `pv-conv-wip-pulse` and `data-pv-conv-wip-dot`; the patch #136 header comment block is removed.
    - `tsc --noEmit` fully clean across all modified files.
    - `vitest` (scoped to pretty-conversations + state): all tests green; regression baseline preserved elsewhere.
    - Single commit on `feat/tab-title-from-tmux` with the specified subject; no Co-Authored-By trailer; 9 files touched; no build/deploy/push.
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WS backend → Terminal.tsx `isIdle` | Existing patch #13 backend emits `{type:"idle", idle:bool}` frames; already trusted per fork baseline (this patch does NOT alter the WS handler). New `useEffect` observes an already-validated state. |
| Terminal.tsx → session-working-store | In-process function call; no serialization; TypeScript-checked signature. |
| conversation-store → sessionStorage | Browser storage boundary — sessionStorage is per-tab, browser-controlled. |
| sessionStorage → conversation-store (hydration path) | UNTRUSTED input — a rogue extension or manual DevTools edit could inject malformed JSON. |
| PrettyConversationsPanel → PrettyConversationRow (props) | Internal React prop flow; type-checked. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-137-01 | Tampering | conversation-store `hydrateActiveSetFromStorage` reading sessionStorage `pv-conv-active-set` | mitigate | try/catch wraps JSON.parse; strict `Array.isArray(parsed)` check + per-element `typeof v === "string"` filter drops malformed entries; empty Set fallback on any failure. Values are conversation ids used only as Set membership tests + rendered as `data-conversation-id` — no eval, no innerHTML, no dangerouslySetInnerHTML anywhere. |
| T-137-02 | Denial of Service | sessionStorage quota exceeded on addToActiveSet write | mitigate | setItem wrapped in try/catch; failure silently swallowed → state.activeSet still updates in-memory + notify still fires → UI stays functional for the current session even if persistence fails. Documented in code comment. |
| T-137-03 | Information Disclosure | sessionStorage active-set persists conversation ids across window session | accept | Conversation ids are non-secret UI identifiers (already leak into `data-conversation-id` DOM attributes, DevTools, and browser history via URL fragments per Phase 6 `#tab=` scheme). No new PII exposure. sessionStorage per-tab isolation is the correct trust level. |
| T-137-04 | Repudiation | User cannot remove a conversation from active-set once added | accept | Design decision per §3 — the set only grows within a session. Documented in code comment. No security implication; a "clear" gesture can be added in a future patch if Ashley asks. |
| T-137-05 | Elevation of Privilege | Cross-tab leakage of active-set state | accept | sessionStorage is per-tab by design; this is the intended trust boundary. Cross-tab isolation confirmed in §3. |
| T-137-06 | Tampering | Rules-of-Hooks violation from calling `useSessionWorking` inside `.map()` callback | mitigate | `PrettyConversationRowLive` micro-component extracts the hook call to a stable top-level position within a per-row instance component — React reconciler keeps hook order stable across renders (standard React idiom). Verified by keeping the `key={row.id}` prop unchanged on the wrapper. |
| T-137-SC | Tampering | npm/pip/cargo installs | mitigate | N/A — this patch adds ZERO new dependencies. `grep -c '"[a-z@]' package.json` before-vs-after must be identical. Verified in Task 4's verify block indirectly (no `npm install` command anywhere in the plan). |

</threat_model>

<verification>

Phase-level checks (all must pass before commit):

1. **TypeScript**: `cd /home/ubuntu/skynet && npx tsc --noEmit` — zero errors across all 9 modified files.

2. **Vitest scope** (patch-relevant):
   ```
   npx vitest run \
     src/ui/state/conversation-store.test.ts \
     src/ui/state/session-working-store.test.ts \
     src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx \
     src/ui/features/pretty-conversations/ \
     --reporter=basic
   ```
   Must be fully green. Total test count net-delta: `+11` (Task 1: +4 new; Task 2: +3 new; Task 3: +4 new — Tests 15/16/17/18+18b, minus zero removed; Test 13 modified not counted).

3. **Full-tree Vitest regression**: `npx vitest run --reporter=basic` — no NEW failures beyond the 2 known pre-existing patch #124 ThumbsUp aria-label failures (per STATE.md Phase 10 baseline `504/506`; new counts should be roughly `515/517` after +11 patch-#137 tests).

4. **Grep gates** (all must return the specified counts):
   - `grep -rn "isWip" src/ui/features/pretty-conversations/ src/ui/features/terminal/ src/ui/state/` → `0` (rename complete, no stragglers in scope files).
   - `grep -rn "data-pv-conv-wip-dot" src/ui/` → `0`.
   - `grep -rn "pv-conv-wip-pulse" src/ui/` → `0`.
   - `grep -rn "data-pv-conv-ready-dot" src/ui/` → `1` (only in PrettyConversationRow.tsx).
   - `grep -c "publishSessionWorking\|useSessionWorking" src/ui/` when aggregated across the plan's files → >= `5` (Task 1 store defs + Terminal call + Panel import + Panel micro-component call).
   - `grep -c "activeSet\|ACTIVE_SET_STORAGE_KEY\|pv-conv-active-set" src/ui/state/conversation-store.ts` → >= `8`.
   - `grep -c "Co-Authored-By" .git/COMMIT_EDITMSG 2>/dev/null || git log -1 --format=%B | grep -c "Co-Authored-By"` → `0` (fork commits don't use one).

5. **File count**: `git diff HEAD~1 --stat | tail -1` shows exactly `9 files changed`.

6. **Branch check**: `git rev-parse --abbrev-ref HEAD` returns `feat/tab-title-from-tmux`.

7. **Guardrail negations**:
   - `git log --oneline -1 | grep -c "npm run build\|docker compose\|Co-Authored"` → `0` (no build/deploy/co-author in commit metadata).
   - `[ ! -f /tmp/patch-137-build.log ]` proves no `npm run build` ran (executor did not create a build log).
   - `[ ! -f /tmp/patch-137-deploy.log ]` proves no deploy ran.
   - No changes to `~/.claude/identities/tina/skynet-patches.md` (out-of-repo file — not touched).

</verification>

<success_criteria>

**Behaviorally observable in dev-server post-patch (deferred — Ashley will greenlight after batched deploy):**

1. Every conversation Ashley has clicked in the current tab-session shows the full patch #136 pretty-view bubble treatment.
2. Every conversation she has NOT clicked in the current tab-session shows the ambient recession (dim hue rgba background, no drop shadow, no backdrop-blur, muted foreground).
3. On any active-set row where the agent is idle (isIdle-published false), a single steady ready-dot appears in the right-meta column — hue-cream fill, hue outer glow, warm inset.
4. On any active-set row where the agent is working (isIdle-published true), the ready-dot is absent.
5. On any row where the WS has not yet published isIdle (isWorking===null), the ready-dot is absent (defaults to "unknown = suppress").
6. Closing and reopening the browser tab clears the active-set (sessionStorage semantics).
7. Refreshing the page within the same tab preserves the active-set (session storage rehydration).
8. Two different browser tabs maintain independent active-sets (per-tab sessionStorage isolation).
9. RDP rows always render with the patch #136 neutral (60,65,80 / 30,33,44) full-bubble treatment — never ambient, never the ready-dot.

**Code-level provable (verifiable during this patch):**

- All Task 1-4 automated verify commands pass.
- All grep gates return the specified counts.
- Single commit on `feat/tab-title-from-tmux` with the specified subject.
- 9 files touched (2 new, 7 modified).
- Zero new npm dependencies.
- Zero references to legacy `isWip` / `data-pv-conv-wip-dot` / `pv-conv-wip-pulse` remain anywhere in `src/ui/`.

</success_criteria>

<output>
Create `.planning/quick/260723-bbt-conv-list-active-set-ready-dot-working-s/260723-bbt-SUMMARY.md` when done.
</output>
