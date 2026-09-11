# Phase 95: PV context-pct batch sweep — kill plan mode + delete the plan-pending code path + collapse remaining tail execs — Research

**Researched:** 2026-09-09 (re-research after scope pivot)
**Domain:** Skynet backend PrettyView context-pct + plan-pending pipeline; Claude Code `permissions.deny` settings shape; fleet distributor settings-patch integration; sibling of Phase 92
**Confidence:** HIGH (every finding anchored to source read at HEAD `0a8b5a6f`, branch `feat/tab-title-from-tmux`, plus live docs.claude.com verification 2026-09-09)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Part A — disable plan mode fleet-wide via distributor (LOCKED)

- Extend the distributor to patch `~/.claude/settings.json` per managed box (or per-user) to add `EnterPlanMode` + `ExitPlanMode` (researcher confirmed — canonical tool names verified against tools-reference) to the disallowedTools/deny list. Idempotent.
- Roll out via existing distributor sweep cycle — same 30s retry pattern that already patches `.claude/settings.json` for fleet-status hooks. No new mechanism.
- Fleet-side use verified 2026-09-09: **zero real `tool_use` invocations of ExitPlanMode across 5 identities × ~150 sessions on t1000.** Only `deferred_tools_delta` schema registration (harmless per-session boot noise). Killing plan mode does not break any observed workflow.
- Peer-box confirmation deferred (DNS resolution failure during verification). Reasonable assumption: peer boxes have similar near-zero usage. Revert path: remove entry from the deny list — no code changes needed.

### Part B — capture-pane + plan-pending code removal (LOCKED)

- `tmux capture-pane -p -t <session>` in the contextPctTimer callback → delete.
- `parseContextPct` scrape fallback → drop. JSONL is authoritative for context-pct. If `readContextPctFromJsonl` returns null, emit null pct and let the frontend show the loading state.
- `isPlanPending` + `parsePlanFilePath` in `plan-pending-parser.ts` → delete the file. No consumers post-Part-A.
- The `{type:"plan_pending", pending}` WS frame emit path → delete. Includes the plan-content cache, the `planPendingLastSerialized` change-only guard, the JSONL patch-#63 scan, and the plan-content-delivery seam.
- `src/backend/ssh/plan-file-fetch.ts` → delete. Phase 24 SFTP side-channel unused post-Part-A.
- Frontend `plan_pending` frame handlers → delete. Any UI affordance for pending plans becomes dead code.
- The Symmetric-behavior comment at L7587 → obsolete; delete alongside the capture-pane exec.

### Part C — batch sweep script (LOCKED)

- One sweep script per host per 3s tick. Python 3 stdlib-only. Distributor-shipped. Bump `catalog.test.ts` Test 1 (22→23), Test 6 scriptRows (8→9). Backward-compat fallback preserved verbatim: `test -x` probe, cache per-SSH-channel-lifetime, null-exec re-probe, schema-mismatch latch.
- Schema versioned (`schema_version: 1`). Parity with today's collected state MINUS plan-pending (which is now dead). Change contained to `src/backend/claude-session/`, `substrate/scripts/`, one distributor catalog row. Legacy path extracted-to-helper, not deleted. No `--no-verify`, no destructive git, no push.

### Claude's Discretion

- Exact sweep-script filename (`pv-context-pct-sweep`, `pv-sweep`, etc.).
- Exact JSONL field names.
- How the sweep script learns which identities are subscribed.
- Exact settings.json patch shape — mirror the existing hook-install pattern.

### Deferred Ideas (OUT OF SCOPE)

- Wider batch beyond context-pct (widget collectors, tunnel state polls).
- Removing legacy per-tail path entirely.
- Loosening/removing fleet-status semaphore.
- Removing plan-mode support in ComposeBox layer entirely (Phase 24's `planPendingActive` prop OR-in). Removing the prop + its tests is part of Part B; removing plan-mode's stylistic siblings elsewhere in the UI (WaitingBubble docblock references, PlanPendingBubble aesthetic references from AsideBubble/SessionHoldingOverlay comments) is a comment-cleanup that Part B *may* pick up incidentally but is not a functional dependency.
</user_constraints>

---

## Executive summary

Scope re-pivoted 2026-09-09 late. Original scope: keep plan-pending, migrate it to an FS marker + batch the tail execs. New scope: **kill plan mode at the source via a settings-patch**, then **delete the entire plan-pending code path** with confidence (no downstream state to preserve), then **collapse remaining tail execs** (Part C, identical shape to Phase 92).

Three parts, hard-ordered:

1. **Part A — settings-patch.** Modify each managed box's `~/.claude/settings.json` to add `EnterPlanMode` + `ExitPlanMode` (canonical tool names, verified against docs.claude.com tools-reference) to `permissions.deny`. Ships via the existing `remote-hook-install.ts` mechanism which ALREADY patches this exact file with idempotent per-key merges. Claude Code strips deny-listed bare tool names from the model's context entirely — the tools become invisible, `tool_use` for them can never fire, `ExitPlanModeV2Tool` never buffers a prompt in the Ink UI, plan-approval prompts never render.

2. **Part B — deletion.** With Part A live, every plan-pending code path becomes dead. `plan-pending-parser.ts` (135 lines) — DELETE the file. `plan-file-fetch.ts` (315 lines) — DELETE the file. In `claude-session-server.ts` — 95 line-precise sites across 3 stanzas (declarations 4311-4366, JSONL scan 4796-4897, capture-pane block 7569-7793) plus imports (L49-L50) + teardown resets (L4509-L4519, L5353-L5359) + raw_keystrokes handler (L7046-L7098). In `context-pct-parser.ts` — verify no callers remain besides the L7618 fallback (already confirmed: 4 non-test refs, all inside claude-session-server), then DELETE the file. In frontend PrettyView.tsx — 15 line-precise sites, including the `planPending` state at L653, the `plan_pending` frame handler at L2491, three `setPlanPending(null)` sites, plus the `PlanPendingBubble` render at L3751. Import of PlanPendingBubble at L35 + the ComposeBox `planPendingActive` OR-in chain across ~14 sites (see Section 4). Test files `plan-pending-parser.test.ts`, `plan-file-fetch.test.ts`, `ComposeBox.plan-pending-disable.test.tsx` — DELETE.

3. **Part C — batch sweep.** Same shape as Phase 92 with two material simplifications from the pre-pivot research: (a) no plan-pending in the emitted schema — sweep emits ONLY `context_pct: number|null` + `schema_version: 1` + `identity` per line; (b) no server-side capture-pane inside the sweep — everything the sweep needs comes from the JSONL. Wire-size drops from the pre-pivot ~5KB to ~500 bytes per sweep. The per-host coordinator vs. elected-WS vs. per-WS SSH-topology decision (documented as G1 in pre-pivot research) is UNCHANGED and still blocks Task 1.

**Primary recommendation for planner:** Task 1 of the plan MUST enumerate + LOCK the SSH-topology decision AND deliver a **wave-ordering hard-dependency** between Parts A and B (see Section 5). Part A's settings-patch has to be verified in prod on every fleet peer BEFORE Part B's code deletions ship, or there is a window where plan mode can still be entered (peer boxes not yet patched) but Skynet can't detect it (backend code already deleted). Users would get stuck with a live Ink prompt and zero UI feedback. This risk is asymmetric-blast-radius territory per CLAUDE.md.

---

## 1. Claude Code settings.json + `permissions.deny` schema (Part A mechanics)

### 1a. Exact schema — verified against code.claude.com/docs/en/permissions 2026-09-09

**Modern setting name:** `permissions.deny` (top-level `permissions` object, `deny` key inside it). Array of strings.

- The legacy CLI flag `--disallowedTools` still exists (verified — see `code.claude.com/docs/en/cli-reference#cli-flags`) but is **session-scoped only**. For a persistent settings-file rule, the correct key is `permissions.deny`. CONTEXT.md's `disallowedTools` phrasing refers to the deny-list concept, not the exact JSON key.
- Rules with **bare tool names** — `"EnterPlanMode"`, `"ExitPlanMode"` — "remove the tool from Claude's context entirely, so Claude never sees it." (verbatim from docs.claude.com/docs/en/permissions § "Deny rules ... Bare-name removal").
- **Idempotent by design:** Claude Code reads settings on session start + reloads on file change. A rule listed twice is deduplicated by array-membership semantics of the deny match; no error, no duplication. Re-writing the same key is a no-op from Claude's perspective.
- **Startup warning class to be aware of:** a deny rule whose tool name matches no known tool "produces a startup warning to catch typos" (docs § "Tool name wildcards"). `EnterPlanMode` and `ExitPlanMode` ARE known — verified in the tools reference table. No warning.
- **Precedence:** deny rules from ANY scope (managed / project / user) evaluate before allow rules. A user-level deny cannot be overridden by a project-level allow. This is what we want — the user-level `~/.claude/settings.json` deny is the correct scope for the fleet.

### 1b. Exact tool names — verified

**Canonical tool names, verbatim from docs.claude.com/docs/en/tools-reference:**

| Tool | Purpose |
|------|---------|
| `EnterPlanMode` | Switches to plan mode to design an approach before coding |
| `ExitPlanMode` | Presents a plan for approval and exits plan mode |

**NOT the correct names:**
- `EnterPlanModeV2` — does not exist in the tools-reference.
- `ExitPlanModeV2Tool` — an INTERNAL Claude Code implementation detail (referenced in `plan-pending-parser.ts` L21 docblock as the Ink-UI-buffered v2 implementation). Not a canonical tool name for deny-list matching.

**JSONL evidence:** A sample from `~/.claude/projects/-home-ubuntu-skynet-tabitha/8417e06d-7146-4dc4-883c-4450d113ba1c.jsonl` shows the `deferred_tools_delta` attachment (session boot, Claude Code 2.1.150) listing `EnterPlanMode` and `ExitPlanMode` in `addedNames`:

```json
{"type":"attachment","attachment":{"type":"deferred_tools_delta","addedNames":["...","EnterPlanMode","...","ExitPlanMode","..."]}, "version":"2.1.150"}
```

The runtime `tool_use.name` on the model's actual invocation would be `ExitPlanMode` (matching the deferred-tools-delta added name). **Grep confirms zero such invocations across the sampled JSONLs 2026-09-09** — plan mode is genuinely unused.

### 1c. Concrete shape to write

The planner's Part A settings-patch task must produce the following merge behavior when reading `~/.claude/settings.json`:

```json
{
  "permissions": {
    "deny": [
      "EnterPlanMode",
      "ExitPlanMode"
    ]
  }
}
```

Merged **into existing keys**, not clobbering. Idempotency: if either entry already present, do not add a duplicate.

**Live confirmation** — this exact shape works today. The current Skynet-host `~/.claude/settings.json` (`/home/ubuntu/.claude/settings.json`) has `"permissions": { "deny": ["AskUserQuestion"] }` and Claude Code honors it — verified by inspection at HEAD 0a8b5a6f. No syntax invention required.

**Merge with existing entries** — some fleet boxes will already have `permissions.deny` populated with unrelated denies (e.g. `AskUserQuestion` as above). The merge algorithm mirrors the existing `readAndMergeHookSettings` pattern in `remote-hook-install.ts` L339-L393: preserve every existing entry, append the two new names ONLY if not already present, return `alreadyInstalled: boolean` for logging. Shallow-copy discipline throughout.

### 1d. Interaction with existing `permissions.deny` entries

The Skynet-host settings.json currently denies `AskUserQuestion`. Managed peer boxes may have their own project-local denies (per team policies) or user-level entries. The Part A patch MUST NOT touch any existing entry — only add `EnterPlanMode` + `ExitPlanMode` alongside. This is the same pattern the existing hook-install code uses when merging 6 hook entries into `hooks.Stop[]` / `hooks.UserPromptSubmit[]` etc.

### 1e. `permissions` key may not exist yet

Fleet boxes with no prior `permissions` object at all (fresh Claude Code installs, no prior denies) get a new `permissions` key + `deny` array in a single write. The merge helper must handle:
- `settings.permissions` absent → create `{ permissions: { deny: [...] } }`
- `settings.permissions.deny` absent (permissions exists but only holds `allow` etc.) → create the `deny` array
- `settings.permissions.deny` exists → append the two names, dedup

All three cases already have precedent in `readAndMergeHookSettings` (L339-L393) for the `hooks.<EventName>` sibling shape — the algorithm ports 1:1 to `permissions.deny`.

---

## 2. Existing distributor settings-patch pattern (Part A implementation surface)

### 2a. Location + shape

**File:** `src/backend/fleet-status/remote-hook-install.ts` (864 lines). Called from `src/backend/starter.ts` L249 as `installStopHook(channel, opts?)`.

**Existing behavior (Phase 62 extended shape, verified by full read):**

1. Resolves remote `$HOME` via `channel.exec("(cd ~ 2>/dev/null && pwd) || printf \"%s\" \"$HOME\"")` — belt-and-braces for exotic shells. Result validated: must start with `/`, must not start with `~`.
2. Legacy cleanup: `rm -rf "$HOME/~"` reaps a literal `~` subdirectory left by pre-#454 installs.
3. Ensures `~/.claude/hooks/` and `~/.claude/fleet-status/` exist via `mkdir -p`.
4. Drops THREE hook shell scripts (`skynet-fleet-status-stop.sh`, `-activity.sh`, `-stopped.sh`) atomically via heredoc `.tmp` + `mv` + `chmod +x`. Distinct heredoc sentinels per script to prevent nested-heredoc collision.
5. Verifies all three scripts are executable via `test -x` — throws script-specific error on any failure.
6. Reads `~/.claude/settings.json` via `cat ~/.claude/settings.json 2>/dev/null`. If SSH returns null → throw `fleet_status_hook_install_settings_read_failed`. If empty → start with `{}`. If invalid JSON → throw `fleet_status_hook_install_settings_invalid_json` (refuses to clobber).
7. Calls `readAndMergeHookSettings` SIX times, threading `running` object through each merge:
   - Stop[] ← stop-hook path
   - Stop[] ← stopped-hook path
   - UserPromptSubmit[] ← activity-hook path
   - PreToolUse[] ← activity-hook path
   - StopFailure[] ← stopped-hook path
   - PermissionRequest[] ← stopped-hook path
8. If ALL SIX merges report `alreadyInstalled: true`, skip write (idempotency invariant). Otherwise writes back atomically via heredoc `.tmp.$$ + mv`.
9. Structured `systemLogger.info` at completion with forensic fields.

### 2b. Idempotency guarantees (verified in source)

- `readAndMergeHookSettings` (L339-L393) is a pure function. NEVER mutates input — all spreads are shallow copies. Returns `{ merged, alreadyInstalled }`.
- Check for `alreadyInstalled`: walks `hooks[hookEventName][*].hooks[*]` looking for any entry with `command === remoteHookPath`. Any match → early return unchanged with `alreadyInstalled: true`.
- Merge path: creates `hooks[hookEventName][0]` if missing; appends the new entry to `hooks[hookEventName][0].hooks[]`. Preserves any third-party entries already present in the same hooks[] group.

### 2c. Per-user variability (fleet convention)

**Harness user varies per box.** Alice's box-maintainer role file line 225 (per bounty premise) records: `thenasty`, `alice`, `zoeysephilya`, `ubuntu` — four different harness user names across the fleet. Skynet resolves this via the SSH connection's own user (each fleet peer's Skynet-registered `hosts` row carries the SSH username). The existing `remote-hook-install.ts` L478-L495 already handles this correctly via `cd ~ && pwd` — tilde expansion goes through the passwd entry independent of `$HOME`. **Part A inherits this — zero new plumbing.**

### 2d. Recommended call site for Part A

**Recommendation: extend `installStopHook` in-place.** Add a NEW merge invocation to the existing SIX in `installStopHook` at L658-L678:

```typescript
// Phase 95 Part A: Deny plan-mode tools fleet-wide.
const { merged: withEnterDeny, alreadyInstalled: enterAlready } =
  readAndMergePermissionDeny(running, "EnterPlanMode");
const { merged: withBothDeny, alreadyInstalled: exitAlready } =
  readAndMergePermissionDeny(withEnterDeny, "ExitPlanMode");
running = withBothDeny;
if (!enterAlready || !exitAlready) allAlreadyInstalled = false;
```

Requires a new sibling pure helper `readAndMergePermissionDeny(currentSettings, toolName)` — same shape as `readAndMergeHookSettings` but targeting `permissions.deny` instead of `hooks.<EventName>`. Roughly 40 lines. Same shallow-copy discipline. Same return shape `{ merged, alreadyInstalled }`.

**Alternative rejected: new adjacent module.** Creating `remote-permissions-install.ts` alongside `remote-hook-install.ts` would double the number of SSH round-trips per host (read settings.json → merge hooks → write; then read settings.json → merge denies → write). The existing single-read-single-merge-single-write cycle can absorb the two new entries at zero additional network cost.

**Tradeoff to call out to the planner:** extending `installStopHook` couples plan-mode-deny to the fleet-status hook install. If plan-mode deny is ever wanted independently (e.g. a box that runs Claude Code but not Skynet fleet-status), the coupling means the deny doesn't ship. Alice's current fleet convention: every managed box runs both. Coupling is fine today.

**Rename?** `installStopHook` is already a misnomer post-Phase-62 (installs 3 scripts + 6 hook entries, not just Stop). Renaming to `installFleetSubstratePerUserBaseline` (or similar) is out of scope for Phase 95 — the starter.ts callsite (L249) is the only caller.

### 2e. Timing in the distributor sweep sequence

**Where in the sweep cycle Part A fires:** `installStopHook` fires per-host on newly-discovered identity-hosting-hosts — called from `starter.ts` L249 during host discovery, NOT from the 30s catalog sweep. This is the ONE-TIME-per-host-per-Skynet-process install path.

**30s retry cadence:** the D-CTX docblock at L34 states "This module is a one-time install helper, NOT a persistent process." However — because the retry pattern in CONTEXT.md refers to the distributor's 30s sweep, and CONTEXT.md § Rollout says "same 30s retry pattern that already patches `.claude/settings.json` for fleet-status hooks," there is an implicit assumption here that the planner MUST confirm: **does `installStopHook` actually re-fire on the 30s cadence, or does it fire once at host-discovery and never again?** Reading `starter.ts` L560-L692 more deeply is required to confirm — outside the scope of this research pass but flagged for Task 1.

If it's one-shot per host per Skynet lifetime, then the rollout implication for Part A is: **peer boxes get the deny-patch on the next Skynet container restart** (which is when `starter.ts` re-discovers hosts). Alice owns the ship motion, so this is compatible with the CLAUDE.md deploy-is-orchestrator-owned rule.

---

## 3. Plan-pending code path to delete — comprehensive file/line inventory (Part B)

Enumeration performed by `grep -n` at HEAD `0a8b5a6f` on branch `feat/tab-title-from-tmux`. 222 non-test refs to `planPending`/`plan_pending`/`planFilePath`/`planContent`/`PlanPending`/`fetchPlanFile`/`plan-file`/`plan-pending` across the source tree. 67 non-test refs in `src/ui/`. All enumerated below.

### 3a. Files to DELETE entirely

| File | Lines | Rationale | Grep-verify command |
|------|-------|-----------|---------------------|
| `src/backend/claude-session/plan-pending-parser.ts` | 135 | Two exports (`isPlanPending`, `parsePlanFilePath`); only consumer is claude-session-server.ts L7652-7653 (deleted in 3b). | `grep -rn "plan-pending-parser\|isPlanPending\|parsePlanFilePath" src/` → 0 hits after Part B. |
| `src/backend/ssh/plan-file-fetch.ts` | 315 | One export (`fetchPlanFile`); only consumer is claude-session-server.ts L7742 (deleted in 3b). Also exports `MAX_PLAN_BYTES`, `utf8SafeCutoff`, `__resetHomeDirCacheForTest` — verify no external users (grep should confirm 0). | `grep -rn "plan-file-fetch\|fetchPlanFile\|MAX_PLAN_BYTES\|utf8SafeCutoff" src/` → 0 non-self hits after Part B. |
| `src/backend/claude-session/plan-pending-parser.test.ts` | 177 | Sole purpose: exercises plan-pending-parser.ts. Delete alongside the module. |
| `src/backend/ssh/plan-file-fetch.test.ts` | ~410 (based on file inspection) | Sole purpose: exercises plan-file-fetch.ts. Delete alongside the module. |
| `src/backend/claude-session/context-pct-parser.ts` | 125 | `parseContextPct` — sole caller is claude-session-server.ts L7618 (deleted in 3b). JSONL is authoritative post-Part-B. |
| `src/backend/claude-session/context-pct-parser.test.ts` | (unread) | Sole purpose: exercises context-pct-parser.ts. Delete alongside. |
| `src/ui/features/pretty-view/PlanPendingBubble.tsx` | ~210 | React component — only rendered from PrettyView.tsx L3751 (deleted in 3c). |
| `src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` | ~430 | Tests the `planPendingActive` prop OR-in behavior. Delete when the prop is deleted. |

**Caution flag on `context-pct-parser.ts`:** The plan MUST verify no callers exist besides L7618 before deletion. Grep confirmed 4 non-test refs, all inside claude-session-server.ts (L38 import + L7568 comment + L7602 comment + L7618 call). Safe to delete. But: the file has its OWN test suite (`context-pct-parser.test.ts`) with 6+ cases that exercise regex fixture parsing — those tests need to be deleted alongside. Verify none are re-imported by unrelated tests before rm.

### 3b. `src/backend/claude-session/claude-session-server.ts` — line-precise deletion inventory (95 hits total)

**Imports (2 hits):**
- **L49:** `import { isPlanPending, parsePlanFilePath } from "./plan-pending-parser.js";` → DELETE.
- **L50:** `import { fetchPlanFile } from "../ssh/plan-file-fetch.js";` → DELETE.
- **L38:** `import { parseContextPct } from "./context-pct-parser.js";` → DELETE (context-pct-parser being deleted per 3a).

**Docblock (2 hits):**
- **L163:** `*     { type: "plan_pending", pending }                          // pending = { planFilePath: string|null, planContent: string|null, contentError: string|null } | null (Phase 24 widened; presence via pane-scrape quick 260802-rps + parent-JSONL fallback patch #63; planContent fetched async via SFTP side-channel Phase 24 Plan 02)` → DELETE the whole line from the WS-frame-types docblock.
- **L164:** `*     // (client -> server, Phase 24) { type: "raw_keystrokes", bytes: string } — one-shot PTY write via ...` → DELETE (raw_keystrokes handler being deleted).

**Per-connection closure state declarations (block 4311-4366, ~55 lines to delete):**
- **L4311-L4320:** patch #63 docblock preamble → DELETE
- **L4321-L4325:** `const pendingPlans = new Map<...>(); let pendingPlansLastSerialized = "null";` → DELETE
- **L4326-L4336:** pane-scrape docblock → DELETE
- **L4337:** `let planPendingLastSerialized = "null";` → DELETE
- **L4338-L4350:** Phase 24 Plan 03 content-cache docblock + `planPendingContentByPath` + `planPendingFetchInFlightForPath` declarations → DELETE
- **L4351-L4366:** CR-01 fix docblock + `let planPendingWindowToken = 0;` → DELETE
- **L4166:** `let dormantLastEmitted: boolean | null = null;       // change-only emit guard, mirrors planPendingLastSerialized = "null"` → EDIT comment (remove the reference to planPendingLastSerialized, keep the rest).

**Teardown reset in `teardownPane()` (block 4509-4519, ~11 lines to delete):**
- **L4509:** `pendingPlans.clear();` → DELETE
- **L4510:** `pendingPlansLastSerialized = "null";` → DELETE
- **L4511:** `planPendingLastSerialized = "null";` → DELETE
- **L4512-L4516:** Phase 24 Plan 03 invalidation docblock → DELETE
- **L4517:** `planPendingContentByPath.clear();` → DELETE
- **L4518:** `planPendingFetchInFlightForPath.clear();` → DELETE
- **L4519:** `planPendingWindowToken += 1;` → DELETE

**JSONL scanner branch — patch #63 emit block (L4796-L4897, ~102 lines to delete):**
- **L4796-L4816:** "DEPRECATED FOR PENDING-WINDOW DETECTION" docblock → DELETE
- **L4817-L4826:** Plan-pending scan preamble → DELETE
- **L4827-L4862:** `if (obj?.type === "assistant" ...) { for (block of content) { if b.name === "ExitPlanMode" pendingPlans.set(...) } } else if (obj?.type === "user" ...) { for (block of content) { pendingPlans.delete(...) } }` → DELETE the whole branch
- **L4863-L4867:** "Only one ExitPlanMode can be pending at a time" docblock → DELETE
- **L4868:** `const pendingIter = pendingPlans.values().next();` → DELETE
- **L4869-L4876:** Phase 24 Plan 03 shape-widening comment → DELETE
- **L4877-L4883:** `const currentPending = pendingIter.done ? null : {planFilePath, planContent, contentError};` → DELETE
- **L4884-L4897:** `const planSerialized = ...; if (planSerialized !== pendingPlansLastSerialized) { pendingPlansLastSerialized = ...; ws.send({type:"plan_pending", pending: currentPending}); }` → DELETE

**Reference in `_teardownAndRebindForFalseAlarmRecovery` (or similar) at L5238:**
- **L5238:** `// / backgroundedAgents / plan_pending / asideText — false-alarm recovery` → EDIT (remove the `/ plan_pending` mention).

**Second teardown site at L5353-L5359 (parallel to L4509-L4519):**
- **L5353:** `planPendingLastSerialized = "null";` → DELETE
- **L5354-L5356:** intervening comment → EDIT (drop plan-pending refs)
- **L5357:** `planPendingContentByPath.clear();` → DELETE
- **L5358:** `planPendingFetchInFlightForPath.clear();` → DELETE
- **L5359:** `planPendingWindowToken += 1;` → DELETE

**raw_keystrokes handler (L7046-L7098, ~53 lines to delete):**
- **L7046-L7058:** Docblock referencing PlanPendingBubble Approve/Feedback flow → DELETE
- **L7059-L7097:** The `if (msg.type === "raw_keystrokes") { ... }` handler → DELETE (post-Part-A, no user interaction produces `raw_keystrokes` messages; the only sender was PlanPendingBubble).

**contextPctTimer callback IIFE (L7569-L7943 — deletion band 7580-7793, ~214 lines total; ~152 lines to delete):**
- **L7580-L7589:** existing preamble (session-file snapshot + TODO comment referring to plan-pending) → EDIT (keep `sessionFileSnapshot = currentSessionFile;` line; DELETE the TODO comment at L7585-L7588 that references plan-pending).
- **L7602-L7612:** the `output = await execCommand(connSnapshot, captureCmd)` block → DELETE (this is the capture-pane exec being killed).
- **L7613-L7619:** the `if (pct === null && output !== "") pct = parseContextPct(output);` fallback → DELETE.
- **L7620-L7635:** the `context_pct` emit block → **KEEP but SIMPLIFY** — retain `setContextPct(...)` + `ws.send({type:"context_pct", pct})` (Alice 2026-09-09 verbatim: "PRIMARY: JSONL read"); drop the `if (pct !== null)` guard so a null pct also emits (Part B decision).
- **L7636-L7717:** Plan-pending PANE-SCRAPE block (isPending, planFilePath, currentPending, pendingSerialized, ws.send({type:"plan_pending"})) → DELETE the entire block.
- **L7719-L7793:** Async SFTP fetch dispatch block (`if (isPending && planFilePath && sshConn && !cached && !inFlight) { planPendingFetchInFlightForPath.add(); const targetPath = ...; fetchPlanFile(...).then(...)` → DELETE the entire block.
- **L7796+ (dormancy stat block D1, D2, D3):** UNCHANGED. Preserve verbatim. These are sidechannels OUT of Phase 95 scope.

**Docblock reference (L7407-L7417) — closure-state summary comment near function boundary:**
- **L7414-L7416:** references to `planPendingContentByPath`, `pendingPlans`, `pendingPlansLastSerialized`, `planPendingLastSerialized`, `planPendingWindowToken`, `planPendingFetchInFlightForPath` in a state-summary comment → EDIT (remove all six from the comment).

### 3c. Frontend `src/ui/features/pretty-view/PrettyView.tsx` — line-precise deletion inventory (15 hits total)

- **L35:** `import { PlanPendingBubble } from "./PlanPendingBubble";` → DELETE.
- **L184:** comment referencing PlanPendingBubble as one of the bubble types → EDIT (remove the reference).
- **L632-L659:** `planPending` state declaration + docblock (`const [planPending, setPlanPending] = useState<...>(null);`) → DELETE the whole block.
- **L1878:** `setPlanPending(null);` → DELETE (one of the resets — likely inside a WS boot / pane-switch reset).
- **L2125:** `setPlanPending(null);` → DELETE (another reset site).
- **L2491-L2494:** `case "plan_pending": { setPlanPending(parsed.pending); break; }` → DELETE the whole case.
- **L2554:** comment mentioning `/ plan_pending / asideText` in session_holding_cleared handler → EDIT (drop mention).
- **L2596:** `setPlanPending(null);` in session_changed handler → DELETE.
- **L2646:** comment in wire_boot handler "deliberately preserve (planPending / dormantRef / draft)" → EDIT (drop planPending mention).
- **L2942:** comment listing state that isn't touched — "backgroundedShells/planPending/asideText/isHolding are NOT touched" → EDIT (drop planPending).
- **L3646:** comment listing bubble types → EDIT (drop PlanPendingBubble).
- **L3740-L3747:** comment referring to pre-Phase-43 rendering + PlanPendingBubble → EDIT.
- **L3751-L3756:** `{planPending && (<PlanPendingBubble planFilePath={planPending.planFilePath} planContent={...} contentError={...} onApprove={...} onFeedback={...} />)}` → DELETE the whole conditional render block.
- **L3972-L3982:** `plan_pending state is non-null` comment + `planPendingActive={planPending !== null}` on ComposeBox → DELETE (the `planPendingActive` prop is being removed from ComposeBox anyway per 3d).

### 3d. Frontend `src/ui/features/pretty-view/ComposeBox.tsx` — the `planPendingActive` prop OR-in chain (14 hits)

**All refs are in the props chain that gates various compose actions:**

- **L415-L422:** prop docblock → DELETE.
- **L426:** comment referring to ThumbsUp+Recap+Queue disable chain → EDIT (drop planPendingActive mention).
- **L584:** `planPendingActive,` in props destructure → DELETE.
- **L1726, L1742:** `if (!recycleActive && !planPendingActive && !reconnectingActive)` guards → EDIT (drop `!planPendingActive`).
- **L2031:** `if (recycleActive || planPendingActive || reconnectingActive) return;` → EDIT (drop `|| planPendingActive`).
- **L2122:** `planPendingActive === true ||` in an OR-chain → EDIT (drop).
- **L2203:** `!planPendingActive &&` in an AND-chain → EDIT (drop).
- **L2356:** button disabled prop OR-chain `planPendingActive === true` → EDIT (drop).
- **L2555, L2588:** aux button disabled prop OR-chains → EDIT (drop `|| planPendingActive === true`).
- **L2639:** `planPendingActive={planPendingActive}` prop-drill to child component → DELETE.
- **L3219-L3220, L3262, L3353, L3421:** duplicate prop chain in the sibling component below (inner ComposeBox render? Look at file structure — 3200+ lines suggests two overloaded shapes). SAME edits pattern applies.

### 3e. Frontend other files with plan-pending references (comment/doc only — EDIT not DELETE)

- **`src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx:95`** — comment reference to PlanPendingBubble aesthetic. EDIT.
- **`src/ui/features/pretty-view/RelayInboundBubble.tsx:18`** — comment reference to PlanPendingBubble+other bubbles. EDIT.
- **`src/ui/features/pretty-view/AsideBubble.tsx:6`** — comment reference. EDIT.
- **`src/ui/features/pretty-view/SessionHoldingOverlay.tsx:29,140`** — comment references to PlanPendingBubble aesthetic. EDIT.
- **`src/ui/features/pretty-view/WaitingBubble.tsx:11,21-38,69,83,100`** — extensive references in the sibling docblock explaining semantic distinction from PlanPendingBubble. EDIT — but leave enough context that the WaitingBubble docblock still stands alone.
- **`src/ui/AppShell.tsx:2923`** — comment reference. EDIT.
- **`src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx:215`** — comment reference. EDIT.
- **`src/ui/features/pretty-view/use-auto-scroll.ts:341`** — comment reference. EDIT.
- **`src/backend/database/routes/pretty-view-fetch-host-file.ts:116,118,119,246`** — references to plan-file-fetch.ts as pattern precedent. EDIT to `WeakMap pattern used elsewhere in codebase` or similar; the ROUTE stays.
- **`src/backend/matrix/matrix-admin-narrow.ts:7`** — reference to `plan-file-fetch.ts:297` as inline-cast precedent. EDIT to point at an alternative precedent — `pretty-view-fetch-host-file.ts` is now the SFTP-wrapper precedent.

### 3f. Frontend wire-type file `src/ui/api/claude-session-api.ts`

- **L148-L156:** `PlanPendingEvent` docblock → DELETE.
- **L156-L165:** `export type PlanPendingEvent = { type: "plan_pending"; pending: { planFilePath: ...; planContent: ...; contentError: ... } | null };` → DELETE the whole type.
- **L174:** comment listing preserved-verbatim WS frames (plan_pending among them) → EDIT (drop plan_pending).
- **L395:** `| PlanPendingEvent` in a discriminated-union → DELETE (drops one member from the union).
- **L480-L483:** raw_keystrokes docblock referring to PlanPendingBubble Approve/Feedback → DELETE.
- **L491:** `type: "raw_keystrokes";` in a message type union → DELETE (raw_keystrokes wire type entirely — the only client-side sender was PlanPendingBubble; no other component sends `raw_keystrokes`).

### 3g. `parseContextPct` fallback drop — safety trace

**Verified:** dropping `parseContextPct` is safe because:
- The frontend consumes `context_pct` via `useSessionContextPct(hostId, tmuxSession)` from the fleet-status shared map (PrettyView.tsx L600-L610). The `context_pct` WS frame is a **no-op on the frontend** post-Phase-90 D-03 waiver (PrettyView.tsx L2448-L2459 comment: "NO-OP. fleet-status is now the single source of truth").
- `setContextPct(_, _, null)` is explicitly supported by the fleet-status contextpct-store (verified: `null is a valid stored value (dormant sentinel semantic)`).
- `useSessionContextPct` returns `null` for both never-written and explicit-null. Frontend renders a loading placeholder.
- **UX regression accepted 2026-09-09:** for the first ~few seconds of a fresh session (before an assistant turn writes `usage` into the JSONL), the pct is null → meter shows loading state. Today's `parseContextPct(pane)` fallback catches this case via the Ink statusline. Alice agreed to accept this per CONTEXT.md § Verification.

### 3h. Tests to prune (deletion, not migration)

| Test file | Fate | Reason |
|-----------|------|--------|
| `src/backend/claude-session/plan-pending-parser.test.ts` | DELETE | Module being deleted. |
| `src/backend/ssh/plan-file-fetch.test.ts` | DELETE | Module being deleted. |
| `src/backend/claude-session/context-pct-parser.test.ts` | DELETE | Module being deleted. |
| `src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` | DELETE | Tests the `planPendingActive` prop which is being deleted. |

### 3i. Tests that MUST stay green

- `src/backend/claude-session/claude-session-server.contextpct-dual-write.test.ts` — grep-verifies the `context_pct` emission sites. Update its assertions to match the simplified L7620-L7635 emit shape (or keep them if the byte pattern is preserved).
- `src/backend/claude-session/context-pct-from-jsonl.test.ts` — tests `readContextPctFromJsonl` in isolation. ZERO impact from Phase 95 — the function is still called on the primary path.
- `src/backend/claude-session/dormant-poll.test.ts` — tests `__applyDormantPollTickForTests` seam. ZERO impact.
- `src/backend/fleet-status/contextpct-store.test.ts` — tests the shared map. ZERO impact.
- Distributor tests (`catalog.test.ts`, `run-sweep.test.ts`, etc.) — Part C bumps assertion counts; Part A does NOT (no new catalog entries — Part A rides `installStopHook`).

---

## 4. Context-pct batch pattern (Part C — condensed)

Same as pre-pivot research. Two material simplifications:

### 4a. Sweep script emission shape (simplified)

```json
{"line_kind":"identity","identity":"tabitha","schema_version":1,"context_pct":24,"jsonl_path":"/home/ubuntu/.claude/projects/-home-.../abc.jsonl"}
```

Fields:
- `line_kind: "identity"` — mirrors Phase 92's line-kind classification pattern.
- `identity` — the tmux session name / identity name (safe-char regex `[a-zA-Z0-9_-]+`).
- `schema_version: 1` — every line.
- `context_pct: number | null` — from `readContextPctFromJsonl` port.
- `jsonl_path: string` — resolved current JSONL path (server-side discovery ports Phase 32's byte-pattern classifier, OR sweep reads a pre-computed cache; planner decides).

No `plan_pending`. No `pane_tail`. No `plan_file_path`. Wire size drops from pre-pivot ~5KB to ~500 bytes per sweep — plan-pending fields dominated the pre-pivot wire.

### 4b. Server-side capture-pane in the sweep

**GONE.** Pre-pivot research recommended running `tmux capture-pane` inside the sweep script as a workaround for plan-pending detection. Post-pivot, plan-pending is dead — the sweep script does ZERO tmux calls. It reads only the JSONL. This eliminates a subtle correctness concern the pre-pivot version had (per-identity capture-pane on the sweep's SSH channel could theoretically fail if tmux isn't running on the target box).

### 4c. Caller-side dispatch (unchanged from pre-pivot)

Same three architectural options as pre-pivot for the SSH-topology decision (per-host coordinator vs. elected WS vs. per-WS). Recommendation stands: **Option 1 (per-host coordinator)** — matches CONTEXT.md's "one exec per host per tick" goal and Phase 92's shape.

Presence probe: `test -x ~/.local/bin/pv-context-pct-sweep 2>/dev/null && echo yes || echo no`. Per-SSH-channel-lifetime cache. Null-exec re-probe. Schema-mismatch latch. Byte-identical fallback to `pollContextPctLegacy()` extracted from the current L7580-L7635 code.

### 4d. Sweep learns subscribers via argv (unchanged from pre-pivot)

Caller enumerates `activeViewers` keys (`Map<${hostId}::${tmuxSession}, Set<WebSocket>>` at claude-session-server.ts L1054) for the current host, extracts the tmuxSession portion (which IS the identity name per fleet convention), joins comma-separated, passes as `--identities` argv. Regex-guarded server-side. **Where the per-WS-connection state holds the sweep-related fields:** on a new `PerConnectionPvSweepState` interface (or, for Option 1, on a per-host `PerHostPvSweepState`). Not on fleet-status `PerHostState` — that's a separate subsystem.

### 4e. Exec timeout constant

`SWEEP_EXEC_TIMEOUT_MS = 20000` (20s). Same reasoning as pre-pivot: N × `readContextPctFromJsonl` (each up to 4 tail execs on cold cache 512KB) on a 15-identity host CAN exceed 8s. Recommend parallelization inside the sweep via `concurrent.futures.ThreadPoolExecutor(max_workers=8)`.

### 4f. Simplified contextPctTimer callback body post-Part-B

The callback that survives is dramatically smaller — from ~370 lines (L7574-L7943) to ~40 lines. Its state per tick:

1. Read `sessionFileSnapshot = currentSessionFile;`
2. Call `readContextPctFromJsonl(connSnapshot, sessionFileSnapshot)` → `pct` (number or null).
3. Guard `stopped || ws.readyState !== WebSocket.OPEN`.
4. Emit `setContextPct(activeHostId, activeTmuxSession, pct)`.
5. Emit `ws.send(JSON.stringify({ type: "context_pct", pct }))` (post-Part-B: null pct also emits, no `if (pct !== null)` guard).
6. Preserve D1/D2 sidechannel probes (dormancy stat at L7796+, sentinel probe at L7892+, aside timer at L8014). Unchanged.

Even before Part C's batch collapse, this is a straight win — one exec per WS per tick (the tail) instead of three (tail + capture-pane + parse fallback).

---

## 5. Wave ordering + safety (the hard-dependency question)

### 5a. The failure mode

If Part B ships in prod (Skynet backend deletes plan-pending code) BEFORE Part A ships in prod (fleet peer's `~/.claude/settings.json` still allows plan mode), the following sequence is possible:

1. A user or the agent invokes plan mode on a peer box (`EnterPlanMode` tool_use fires).
2. Claude Code's Ink UI opens the plan-approval prompt.
3. Skynet backend (Part B live) has no code path to detect the pending state. No `plan_pending` frame emits.
4. Frontend (Part B live) has no `plan_pending` case handler. No PlanPendingBubble renders.
5. User sees Claude "stuck" — pane shows a plan prompt, but ComposeBox is enabled (no `planPendingActive` gating anymore) so any input goes to a pane that's waiting on a "1"/"2" plan keystroke response, not a normal prompt. **This is the "users would get stuck" case CONTEXT.md § Specifics warns about.**

### 5b. Wave-ordering hard-dependency is achievable

The GSD phase execution model supports wave gates. Recommended plan shape:

- **Wave 1 (Part A only):** the settings-patch code changes ship. `installStopHook` gains the two new deny entries. Regression tests for the merge helper pass. **UAT gate:** Alice ships to prod. Distributor sweep runs on the next Skynet container restart (or 30s after restart, depending on the sweep cadence — Task 1 confirms). Verify via SSH into each peer box: `grep "EnterPlanMode\|ExitPlanMode" ~/.claude/settings.json` returns two hits. **Wave 1 done state:** every fleet peer's settings.json contains both deny entries.
- **Wave 2 (Part B + Part C, sequentially in separate commits):** Part B deletion commits (one commit per file group: parser + fetch + frontend + tests). Part C additions (schema module, Python sweep script, catalog row, caller rewire, regression tests). **UAT gate:** Alice verifies SFTP file-fetch reliability + container-log exec collapse.

The wave-ordering hard-dependency lives in the plan's wave-completion criteria — Wave 2 does not start until Wave 1's UAT gate closes.

### 5c. Failure mode if Part A settings-patch fails to land on some peer boxes but Part B ships

**Blast radius: users on the un-patched peer box lose usable ComposeBox during plan-mode invocations.** The pane is stuck at the plan-approval prompt. No visible affordance in Skynet. The user can either (a) SSH-attach and manually press "1"/"2" at the tmux pane, OR (b) type "1"+enter into ComposeBox (which routes through the normal typing path — Claude Code's Ink UI likely accepts it since a "1\n" keystroke is what the current Approve button sends). Option (b) is a viable manual workaround but requires user awareness.

**Blast radius mitigation the plan should include:**
- Structured logging: at settings-patch install completion, log `plan_mode_deny_applied: {enter: true, exit: true}` per host so the container log gives operators a fleet-wide inventory of who is patched and who isn't.
- A start-up verification script (or existing fleet-status collector — a follow-up phase, not Phase 95) that periodically confirms every peer's settings.json has both deny entries. Silent failure to patch a box could go undetected for weeks otherwise.
- Alice's "revert path" documented in CONTEXT.md: remove the two entries from settings.json — no Skynet code change needed to restore plan mode on a per-box basis. If Part B has already shipped, the box's Skynet UI won't detect plan mode, but the peer box's Claude Code will still allow it (usable via SSH-attach).

### 5d. Can Part A land as a separate deploy commit before Part B?

**Yes** — and it MUST. The plan should structure commits such that the settings-patch code is a single atomic commit (Wave 1's only shipped code), separate from every Part B deletion commit and every Part C addition commit. This gives Alice a clean git-log-per-shipped-thing story for the atomic-per-task-commits rule in CLAUDE.md.

Suggested commit shape (planner refines):
- `feat(fleet-status): deny EnterPlanMode/ExitPlanMode via distributor settings-patch (Phase 95 Part A)` — Wave 1's single commit.
- `refactor(claude-session): delete plan-pending JSONL scanner (Phase 95 Part B-1)` — Wave 2's first commit.
- `refactor(claude-session): delete plan-pending pane-scrape + fetch (Phase 95 Part B-2)` — Wave 2's second commit.
- `refactor(ui): remove PlanPendingBubble + planPendingActive prop chain (Phase 95 Part B-3)` — Wave 2's third commit.
- `refactor(claude-session): drop context-pct-parser pane-scrape fallback (Phase 95 Part B-4)` — Wave 2's fourth commit.
- `feat(claude-session): pv-context-pct-sweep schema module (Phase 95 Part C-1)` — Wave 2's fifth commit. (Mirrors Phase 92-01.)
- `feat(fleet-substrate): pv-context-pct-sweep.py Python sweep script (Phase 95 Part C-2)` — Wave 2's sixth commit.
- `feat(distributor): register pv-context-pct-sweep catalog row (Phase 95 Part C-3)` — Wave 2's seventh commit.
- `feat(claude-session): rewire contextPctTimer to batch sweep with legacy fallback (Phase 95 Part C-4)` — Wave 2's eighth commit.
- `test(claude-session): regression tests for pv-context-pct-sweep dispatch (Phase 95 Part C-5)` — Wave 2's ninth commit.

Each commit is atomic; each is reversible via `git revert` without loss of intermediate state. Phase 92's plan shape mirrors this exactly.

---

## 6. Backward-compat for Part C sweep script (per-connection state placement)

Where the per-WS-connection state lives depends on the SSH-topology decision:

- **Option 1 (per-host coordinator):** state on `PerHostPvSweepState` (new module-scope Map keyed by hostId). Fields: `sweepScriptPresent: boolean | null`, `sweepSchemaMismatchThisConnection: boolean`, `lastProbeChannelRef: WeakRef<SshChannel> | null`, `sweepInFlight: boolean`, `coordinatorClient: SSHClientType | null`, `subscribers: Set<WebSocket>`. Reset on coordinator client teardown.

- **Option 2 (elected WS):** state on the elected WS's closure — a new `let sweepState = { present: null, mismatch: false, inFlight: false }` at the top of the claude-session-server per-WS closure. Election logic: first WS to bind to a `(hostId, tmuxSession)` pair wins; non-elected WSs skip their per-tick sweep exec entirely and receive results via fan-out.

- **Option 3 (per-WS):** state on the WS closure (`let sweepScriptPresent: boolean | null = null; let sweepSchemaMismatch = false; let sweepInFlight = false;`). Each WS independently runs one sweep exec per tick — simpler, but doesn't collapse to O(hosts). Achieves the plan-pending deletion win (Part B) and the parseContextPct drop win (Part B) but NOT the "one exec per host per tick" win.

**Task 1 must lock this before Task 2 writes the schema.** The choice doesn't affect the Part A settings-patch or the Part B deletions — those are independent.

---

## 7. Test patterns

### 7a. Regression tests to author (Part A)

`src/backend/fleet-status/remote-hook-install.test.ts` — extend the existing test suite:

1. **New merge helper unit tests:** `readAndMergePermissionDeny(currentSettings, "EnterPlanMode")` — empty settings, settings with no `permissions` key, settings with `permissions` but no `deny`, settings with `deny` already containing the entry (`alreadyInstalled: true`), settings with `deny` containing other entries (append preserves them).
2. **Integration test:** `installStopHook` completes with all 8 merges (6 hook + 2 permission deny), `settingsUpdated: true` on first run, `false` on second run (idempotency).
3. **Startup warning verification (defer / manual):** Claude Code emits a startup warning if a deny rule names an unknown tool. The test can't validate this end-to-end (would need to spawn Claude Code); Task 1 should include a manual UAT check that spawning Claude Code on a patched box does NOT emit a warning for the two names.

### 7b. Regression tests to prune (Part B)

Enumerated in 3h above.

### 7c. Regression tests to author (Part C — mirrors Phase 92-05)

Author in `src/backend/claude-session/claude-session-server.pv-sweep.test.ts` (new file) OR extend `claude-session-server.contextpct-dual-write.test.ts` if the seam pattern extends cleanly. Test cases:

1. Batch path fires exactly ONE sweep exec per host per poll + zero per-WS `tail -c` fan-out.
2. Legacy fallback path fires today's per-WS `tail -c` when the presence probe returns "no".
3. Presence probe fires once per SSH-channel-lifetime; three ticks → probe count = 1.
4. Null sweep-exec → this-tick legacy fallback + re-probe next tick.
5. Schema-version mismatch → this-tick legacy + connection-lifetime latch (stays latched until channel reconnect).
6. Parity assertion: build sweep-present and sweep-absent registries from the SAME input state; assert `setContextPct.mock.calls.toEqual(...)` and `ws.send.mock.calls.filter(f => f.type === "context_pct").toEqual(...)`.
7. Grep-verify (source-level): the `tmux capture-pane -p -t '${activeTmuxSession}'` string at L7573 is DELETED. Assert `body.match(/tmux capture-pane -p -t '\$\{activeTmuxSession\}'/)` returns null. **Aside subsystem's `capture-pane -p -S -200` calls at L7982 + L8013 are OUT of scope and stay** — the assertion must be precise to the L7573 shape.

### 7d. Test framework confirmed

`vitest ^4.1.8`, config at `vitest.config.ts`. `npm test` runs `vitest run`. Co-located `.test.ts` naming. Existing seam pattern (`__applyDormantPollTickForTests`) is the template for new `__applyPvContextPctBatchTickForTests` seam.

Mock patterns to reuse verbatim: logger mock (in every test file), `tmux-helper` mock (`execCommand`), `contextpct-store` mock. `MockSshChannel` from Phase 92's `ssh-poll-orchestrator.test.ts` L84-L118 for exec-call assertions.

---

## 8. Gotchas

### G1 — SSH-connection topology mismatch (unchanged from pre-pivot)

Claude-session-server has NO per-host shared connection — each WS gets its own via `connectOneShot`. Phase 92's `pollOneHost` pattern doesn't map directly. Task 1 MUST lock the coordinator-vs-elected-vs-per-WS decision before any Part C code is written.

### G2 — Plan-mode-enabled-but-Skynet-blind window (see Section 5)

The wave-ordering hard-dependency between Part A and Part B is the single biggest risk in Phase 95. Blast-radius asymmetric per CLAUDE.md.

### G3 — `raw_keystrokes` WS handler goes dead

Post-Part-B, the raw_keystrokes handler at L7059-L7097 has NO client sender — PlanPendingBubble was the only source. Delete it. **Do not** leave the handler behind as dormant surface area (documented policy for false-positive handler-ready-for-payload attack surface — a leftover handler with no sender is a T-attack surface for anyone crafting a raw ws.send). If a future feature needs a similar "one-shot PTY write" primitive, revive it purpose-built.

### G4 — `parseContextPct` fresh-session UX regression

Accepted by Alice 2026-09-09. First few seconds of a fresh session show a null meter until the first assistant `usage` turn lands in JSONL. Frontend renders loading placeholder.

### G5 — `pretty-view-fetch-host-file.ts` copies SFTP wrapper from `plan-file-fetch.ts`

**File:** `src/backend/database/routes/pretty-view-fetch-host-file.ts` L116-L119 comment: "SFTP promise wrappers (mirrors plan-file-fetch.ts L122-163 verbatim). Copied locally rather than exported from plan-file-fetch.ts because the plan-file-fetch SftpLike type is module-private." When plan-file-fetch.ts deletes, the reference-comment goes stale. Options: (a) edit the comment to point at the sibling file itself as the pattern precedent going forward; (b) actually delete the reference. **Recommendation: (a).** The wrappers stay in `pretty-view-fetch-host-file.ts` because they're used by an unrelated feature (host-file fetch — the OTHER SFTP consumer in the codebase).

### G6 — `matrix-admin-narrow.ts:7` references `plan-file-fetch.ts:297`

Same class as G5. `matrix-admin-narrow.ts` L7 comment: "See `plan-file-fetch.ts:297` for the inline-cast precedent." Delete the reference and cite a different precedent — many files use the inline-cast pattern (`pretty-view-fetch-host-file.ts` is the natural sibling replacement).

### G7 — `PlanPendingBubble.tsx` docblock at L14-L21 is a CRITICAL lesson

The Phase 24 lesson "Ink Plan Mode does NOT recognize split-send as a keystroke selection" is preserved in code comments across at least 6 sites. When the code deletes, the lesson goes with it. **Recommendation:** the plan MUST include a decision on where to preserve this lesson. Options: (a) move to `.planning/lessons-learned/2026-plan-mode-split-send.md` for future re-implementations; (b) accept the loss — plan mode is dead fleet-wide, the lesson is null and void. Alice's call.

### G8 — Aside subsystem's `tmux capture-pane` at L7982 + L8013 stays

Reminder — Phase 95's scope is ONLY the context-pct-timer's capture-pane at L7573 (invoked at L7607). The aside subsystem's independent capture-pane calls at L7982 (probe) + L8013 (poller) are OUT of scope and unchanged. Verification queries must be precise — `docker logs skynet-backend | grep "capture-pane -p -S -200"` will still show non-zero counts after Phase 95 ships (that's the aside shape). The Phase-95 collapse target is `capture-pane -p -t '<session>'` without `-S`.

### G9 — `context-pct-parser.ts` uses no imports; test file may have hidden dependencies

The parser is 125 lines, zero imports. Safe to delete. But: its test file may exercise fixture patterns other tests reuse. **Sanity check before rm:** grep the test file for exported helpers, then grep the codebase for those exports.

### G10 — The two `context_pct` emission sites (`{type: "context_pct", pct}` primary at L7631 + `{type: "context_pct", pct, dormant: true}` dormant branch at L3711) are grep-verified by `contextpct-dual-write.test.ts` Test 8

Preserve the byte pattern OR update the test regex. Part B's simplification (drop the `if (pct !== null)` guard so null pct also emits) may break Test 8's exact assertion. Task 5 should update or verify.

### G11 — `PlanPending` string is NOT the only occurrence of "plan"

Grep for `plan` broadly hits false positives — the harness "planner" role name, the phase-planning docs, adverbs. When deleting comment references (3e), search for `PlanPending`, `plan-pending`, `plan_pending`, `planPending`, `planFilePath`, `planContent` explicitly. **Do not run `sed -i s/plan/foo/g` — the blast radius is enormous.**

### G12 — Wire type + backend WS-frame docblock (claude-session-server.ts L153-L165) is the wire contract

L163 documents the `plan_pending` frame verbatim. Deleting L163 alone is the mechanical change; the surrounding lines document the wire contract as a whole. The WS-frame contract docblock is a canonical reference — the plan-checker will read it looking for the surviving frames. Keep the docblock clean and coherent; don't just delete L163 and leave a hole in the numbered list.

### G13 — `deferred_tools_delta` continues to fire post-Part-A

Even after `permissions.deny` removes plan-mode tools, Claude Code's session-boot `deferred_tools_delta` attachment still LISTS `EnterPlanMode` + `ExitPlanMode` in `addedNames` (verified in the sample JSONL). This is a schema-registration side effect — it does NOT mean the tools are actually usable. Grep on JSONL files for `deferred_tools_delta` will continue to show plan mode entries. **Do not use this as the Part A verification signal.** Use `permissions.deny` presence in `~/.claude/settings.json` OR direct `tool_use` grep count → zero.

### G14 — `Cd` deny-rule sample in docs — cross-reference sanity

The permissions docs reference `Cd` deny as a use case. Sanity: `EnterPlanMode` and `ExitPlanMode` are documented tools with defined semantics. They match the "canonical tool name" list. The startup-warning-for-unknown-tool safety net will NOT fire. Confirmed via tools-reference.

### G15 — Fleet-wide search of settings.json fingerprints — deferred verification tooling

CONTEXT.md § Verification includes: "Every managed box's `~/.claude/settings.json` contains `ExitPlanModeV2` in `disallowedTools`" — but the CORRECT key is `permissions.deny`, and the CORRECT name is `ExitPlanMode` (not `ExitPlanModeV2Tool`). Alice's phrasing conflated the internal Ink implementation name (`ExitPlanModeV2Tool`) with the canonical tool name (`ExitPlanMode`). **The plan's verification task must grep for `"ExitPlanMode"` and `"EnterPlanMode"` (both as bare strings) inside `permissions.deny` arrays**, NOT `"ExitPlanModeV2"` and NOT `disallowedTools` key.

---

## 9. Recommended reading list for the planner

Order matters — start with (1) to lock the SSH-topology decision AND wave-ordering before anything else.

1. **`.planning/phases/95-.../95-CONTEXT.md`** — the LOCKED three-part scope. Re-read after this research.
2. **`src/backend/fleet-status/remote-hook-install.ts`** — the settings-patch pattern to extend (Part A). Especially L339-L393 (`readAndMergeHookSettings`) and L452-L716 (`installStopHook`).
3. **`src/backend/claude-session/claude-session-server.ts`** L49-L50 (imports), L153-L165 (WS-frame docblock), L4311-L4366 (declarations), L4509-L4519 + L5353-L5359 (teardown resets), L4796-L4897 (JSONL scanner), L7046-L7098 (raw_keystrokes handler), L7569-L7793 (contextPctTimer callback), L7407-L7417 (closure-state summary docblock). **The single largest deletion inventory in the phase.**
4. **`src/backend/claude-session/plan-pending-parser.ts`** — DELETE (135 lines, reads in one pass).
5. **`src/backend/ssh/plan-file-fetch.ts`** — DELETE (315 lines).
6. **`src/backend/claude-session/context-pct-parser.ts`** — DELETE (125 lines).
7. **`src/ui/features/pretty-view/PlanPendingBubble.tsx`** — DELETE (~210 lines).
8. **`src/ui/features/pretty-view/ComposeBox.tsx`** — the `planPendingActive` prop OR-in chain across 14 sites (see 3d).
9. **`src/ui/features/pretty-view/PrettyView.tsx`** L35, L184, L632-L659, L1878, L2125, L2491-L2494, L2554, L2596, L2646, L2942, L3646, L3740-L3747, L3751-L3756, L3972-L3982 — the 15 frontend sites.
10. **`src/ui/api/claude-session-api.ts`** L148-L165 (PlanPendingEvent type), L174, L395, L480-L491 — wire-type file.
11. **`substrate/scripts/fleet-status-sweep.py`** — Phase 92's sweep script. Structure to mirror. Especially the safe-char regex + always-exit-0 discipline + JSONL emission.
12. **`src/backend/fleet-status/sweep-schema.ts`** — Phase 92's schema module. Sibling design for `src/backend/claude-session/pv-sweep-schema.ts` (or similar).
13. **`src/backend/distributor/catalog.ts`** L240-L255 + **`catalog.test.ts`** L34-L200 — where the new Part C sweep script row lands.
14. **`.planning/phases/92-.../92-CONTEXT.md`, `92-RESEARCH.md`, `92-01-PLAN.md`..`92-05-PLAN.md`** — reference precedent for plan shape.
15. **`src/backend/claude-session/context-pct-from-jsonl.ts`** — the `TAIL_EXPANSION_STEPS` + `reverseScanForAssistantUsageSum` that Part C's Python sweep script ports verbatim.
16. **`src/backend/claude-session/dormant-poll.test.ts`** — test seam pattern (`__applyDormantPollTickForTests`) for Part C's `__applyPvContextPctBatchTickForTests`.
17. **`src/backend/claude-session/claude-session-server.contextpct-dual-write.test.ts`** — Test 7 + Test 8 grep-verify emissions still exist. Confirm Phase 95's rewrite preserves the byte patterns OR update the regexes.

---

## 10. Package Legitimacy Audit

Phase 95 installs **zero** new npm/PyPI packages. Python sweep script is stdlib-only (`glob`, `json`, `os`, `re`, `subprocess`, `sys`, `concurrent.futures` — all stdlib). No new TypeScript imports beyond a new `pv-sweep-schema.ts` (project-internal, mirrors Phase 92-01's schema module). Part A's settings-patch reuses `readAndMergeHookSettings`'s pattern — no new deps.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | Nothing new installed |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## 11. Project Constraints (from CLAUDE.md)

1. **Tech stack:** Node/Express + Drizzle + ssh2 + React/TypeScript. **Phase 95 compliance:** uses only existing infrastructure (`execCommand`, `connectOneShot`, `readAndMergeHookSettings` pattern). No new subsystem.
2. **Commit hygiene:** Atomic per-task commits, no squashes. **Phase 95 compliance:** Section 5d proposes 9 atomic commits.
3. **Blast radius:** A bad deploy loses Alice access to her whole fleet. **Phase 95 compliance:** wave-ordering hard-dependency between Parts A and B (Section 5); backward-compat fallback in Part C; regression tests before merge; UAT gate before ship.
4. **Encryption:** No DB changes.
5. **Access model:** No new SSH-connection classes; reuses existing Tailscale-reachable channels.
6. **Nginx caveat:** No new backend HTTP routes.
7. **GSD workflow enforcement:** Executed via `/gsd-execute-phase`.

---

## 12. Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.6+ stdlib | Part C sweep script | ✓ (fleet convention) | 3.6+ | Legacy per-WS path if script absent |
| Claude Code with `permissions.deny` support | Part A | ✓ | 2.1.150+ (verified in sampled JSONL) | — |
| ssh2 (Node client) | Backend `execCommand` path | ✓ (already in use) | package.json | N/A |
| vitest 4.1.8 | Regression tests | ✓ | 4.1.8 | N/A |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** the sweep script itself (backward-compat via legacy path is designed-in).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Modifying `installStopHook` in-place to add two permission-deny merges is architecturally acceptable. | 2d | Low — matches existing merge-plan pattern, adds ~40 lines to `remote-hook-install.ts`. If Task 1 insists on a separate module, ~40 lines + one extra SSH round-trip. |
| A2 | The distributor's re-invocation of `installStopHook` fires at least on Skynet container restart, giving Part A a reliable rollout mechanism to every peer box. | 2e | Medium — the docblock says "one-time-per-host per Skynet lifetime." Task 1 MUST confirm by reading starter.ts L560-L692 and the host-discovery loop. If it's actually one-shot per Skynet process, re-shipping requires bouncing the Skynet container after the deploy. |
| A3 | `permissions.deny` with `EnterPlanMode` + `ExitPlanMode` bare-name entries strips those tools from Claude's context entirely across the fleet's Claude Code versions (2.1.150 verified; 2.1.263 assumed compatible via same schema). | 1a | Low — verified via official docs at code.claude.com/docs/en/permissions § "Bare-name removal." Schema has not changed since introduction. |
| A4 | ComposeBox's `planPendingActive` OR-in chain has no non-plan-pending callers — deleting the prop and all its OR-in references is safe. | 3d | Low — grep confirmed the only setter for `planPendingActive` is `planPending !== null` at PrettyView.tsx L3981; deleting that state kills every consumer. |
| A5 | The raw_keystrokes WS handler at L7059-L7097 has zero callers other than PlanPendingBubble. | G3 | Low — grep confirmed the only sender is PlanPendingBubble's onApprove/onFeedback. Delete safely. |
| A6 | `context-pct-parser.ts` has no callers besides claude-session-server.ts L7618. | 3a, G9 | Low — grep confirmed 4 non-test refs, all in claude-session-server. Delete safely. |
| A7 | The Phase 95 wave-ordering hard-dependency is achievable within GSD phase execution (Wave 1 of Phase 95 ships alone; Wave 2 waits on Wave 1's UAT gate). | Section 5 | Medium — the mechanism is standard; the risk is operational discipline. The plan MUST make the wait-condition explicit and Alice MUST enforce it. |
| A8 | Peer boxes have similar-to-zero plan-mode usage — verified only on t1000 as of 2026-09-09. | CONTEXT.md § Locked Decisions | Medium — CONTEXT.md accepts this risk with an explicit revert path. If a peer box has heavy plan-mode usage, Part A causes an unnoticed UX regression until Alice or that user notices and requests a per-box exception. |
| A9 | The `deferred_tools_delta` JSONL noise post-Part-A is harmless. | G13 | Low — verified: the tool NAMES appearing in that attachment do not mean the tool is usable. Runtime `tool_use` blocks are what count, and those are gated by `permissions.deny`. |
| A10 | The current `~/.claude/settings.json` on the Skynet host has `permissions.deny: ["AskUserQuestion"]` and Claude Code honors it, proving the exact JSON shape works in production. | 1c | Low — read directly from `/home/ubuntu/.claude/settings.json`. |

---

## Open Questions (blocking Task 1)

1. **SSH-topology decision (unchanged from pre-pivot).** Per-host coordinator (Option 1) vs. elected WS (Option 2) vs. per-WS (Option 3). Recommendation Option 1 stands.
2. **`installStopHook` re-invocation cadence.** Is it one-shot per Skynet lifetime, or does it re-fire on the 30s distributor sweep? Read `starter.ts` L560-L692 to confirm. Affects the deploy story for Part A: container-restart-only vs. self-healing-30s.
3. **Preserve the Phase 24 PlanPendingBubble split-send lesson?** (G7) — move to `.planning/lessons-learned/` or accept the loss. Alice's call.
4. **Sweep exec timeout** — 20s (recommended) or higher. Task 2 detail.
5. **Sweep filename** — `pv-context-pct-sweep` (matches phase directory) or `pv-sweep` (shorter). Task 1 detail.
6. **`readAndMergePermissionDeny` helper location** — inline in `remote-hook-install.ts` (recommended) or new module `remote-permissions-install.ts`.

---

## Sources

### Primary (HIGH confidence)

- `/home/ubuntu/skynet-tina/src/backend/claude-session/claude-session-server.ts` — full deletion inventory read (imports L49-L50, declarations L4311-L4366, JSONL scanner L4796-L4897, capture-pane block L7569-L7793, raw_keystrokes L7046-L7098, docblock L153-L165).
- `/home/ubuntu/skynet-tina/src/backend/claude-session/plan-pending-parser.ts` — full read (135 lines).
- `/home/ubuntu/skynet-tina/src/backend/ssh/plan-file-fetch.ts` — full read (315 lines).
- `/home/ubuntu/skynet-tina/src/backend/claude-session/context-pct-parser.ts` — full read (125 lines).
- `/home/ubuntu/skynet-tina/src/backend/fleet-status/remote-hook-install.ts` — full read (864 lines); confirmed the merge-helper pattern for Part A.
- `/home/ubuntu/skynet-tina/src/ui/features/pretty-view/PrettyView.tsx` — grep + section reads L625-L660, L2470-L2650, L3640-L3985.
- `/home/ubuntu/skynet-tina/src/ui/features/pretty-view/ComposeBox.tsx` — grep-based enumeration of the 14 planPendingActive sites.
- `/home/ubuntu/skynet-tina/src/ui/api/claude-session-api.ts` — grep-based enumeration of the PlanPendingEvent + raw_keystrokes wire types.
- `/home/ubuntu/skynet-tina/src/backend/database/routes/pretty-view-fetch-host-file.ts` — plan-file-fetch reference-comments.
- `/home/ubuntu/skynet-tina/src/backend/matrix/matrix-admin-narrow.ts` — plan-file-fetch inline-cast precedent reference.
- `/home/ubuntu/.claude/settings.json` — live example of `permissions.deny: ["AskUserQuestion"]` shape in production.
- `/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tabitha/8417e06d-7146-4dc4-883c-4450d113ba1c.jsonl` — sample confirming `deferred_tools_delta.addedNames` shape + tool-name strings.
- `https://code.claude.com/docs/en/permissions` — the LIVE authority for the `permissions.deny` schema + bare-name removal semantics. Verified 2026-09-09.
- `https://code.claude.com/docs/en/settings-reference` — cross-verified: `disallowedTools` is a CLI flag, `permissions.deny` is the settings-file key.
- `https://code.claude.com/docs/en/tools-reference` — canonical tool names `EnterPlanMode` + `ExitPlanMode` confirmed.
- `.planning/phases/92-...` — full phase directory (CONTEXT, RESEARCH, plans 01-05) as reference precedent.
- `.planning/phases/95-.../95-CONTEXT.md` — the LOCKED three-part scope.
- `/home/ubuntu/skynet-tina/CLAUDE.md` — project constraints.

### Secondary (verified via cross-reference)

- Phase 92 sweep script (`substrate/scripts/fleet-status-sweep.py`) — Python 3 stdlib-only structure.
- Prior 95-RESEARCH.md — the pre-pivot inventory of the L7569-L7943 exec sites and the readContextPctFromJsonl internals; carries forward unchanged for Part C.
- `/home/ubuntu/.claude/roles/box-maintainer/bounties/harness-upgrade-investigation-2026-09-08/RESEARCH-FINDINGS.md` — inspected; the harness-upgrade experiments touched Claude Code SDK behavior but NOT the `permissions.deny` schema. Cited for completeness. No direct Part A evidence.

### Tertiary (LOW confidence — none)

No LOW-confidence sources. All findings anchored to source reads OR live docs.

---

## Confidence breakdown

| Area | Level | Reason |
|------|-------|--------|
| `permissions.deny` schema shape | HIGH | Verified against docs.claude.com AND a live production example (`~/.claude/settings.json` at repo root). |
| Canonical tool names `EnterPlanMode` + `ExitPlanMode` | HIGH | Verified against docs.claude.com tools-reference. Sample JSONL cross-verifies via `deferred_tools_delta`. |
| `remote-hook-install.ts` pattern extension surface | HIGH | Full source read of the 864-line file; the merge helper reuse is mechanical. |
| Plan-pending code deletion inventory (95 backend + 15 frontend sites) | HIGH | Line-precise `grep -n` at HEAD 0a8b5a6f. Every line number in Section 3 is currently valid. |
| `parseContextPct` fallback drop is safe | HIGH | Verified by reading contextpct-store.ts (null is stored value; reader collapses to null) and PrettyView.tsx (WS frame is no-op post-Phase-90). |
| Wave-ordering hard-dependency achievability | MEDIUM | The mechanism is standard GSD wave-gating; risk is operational discipline. |
| `installStopHook` re-invocation cadence (once vs. 30s) | MEDIUM | Docblock says one-time; Task 1 must confirm by reading starter.ts. |
| Peer-box plan-mode usage (assumed near-zero) | MEDIUM | Verified on t1000 only; peer-box grep deferred due to DNS. CONTEXT.md accepts this. |
| SSH-topology decision for Part C | MEDIUM | Three viable options; Task 1 locks. Same as pre-pivot. |
| Backward-compat mechanics (Part C) | HIGH | Verbatim reuse of Phase 92's proven pattern. |
| Existing test patterns | HIGH | Read of `dormant-poll.test.ts`, `contextpct-dual-write.test.ts`, Phase 92 test files. |

**Research date:** 2026-09-09 (re-research after Alice's late-2026-09-09 scope pivot).
**Valid until:** ~30 days for the code inventory; indefinite for the pattern-reference material and the `permissions.deny` schema (live-docs authority).
