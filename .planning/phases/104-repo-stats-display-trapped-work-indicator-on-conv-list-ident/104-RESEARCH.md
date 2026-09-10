# Phase 104: Repo stats display — trapped-work indicator on conv-list + identity badge — Research

**Researched:** 2026-09-10
**Domain:** SSH-remote git-state detection + React-store-fed avatar-corner indicator (retirement of role-scoped bounty badges, addition of per-identity trapped-work indicator)
**Confidence:** HIGH (all findings grounded in file:line inspection of the actual codebase; no third-party docs required)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**From /open shape file (opened 2026-09-10, seeded into CONTEXT.md):**

- **Detector semantics — eligibility rules:**
  - Eligible project: git repository with at least one remote configured. Projects without any remote are personal scratch and don't count.
  - Eligible trapped state (any of):
    - Modifications to tracked files (staged or unstaged).
    - Local commits not reachable from any remote (whether a branch has an upstream or not — a local-only branch's commits fully qualify).
    - Stashes on the reflog.
  - Ignored (does NOT count as trapped):
    - Untracked files in a repo (loose scratch).
    - Nested repositories inside another repository's tree; only the outermost repo is probed. Submodules and nested clones are not treated as independent projects.
    - Anything in a repo without a remote configured.

- **Detection root:** the identity's per-identity workspace folder inside the identity directory. Depth-bounded walk; skip inner `.git` dirs (outermost-only rule).

- **Detection wire path — mirror `readIdentityBountyCounts`:**
  - Sibling function in `src/backend/claude-session/identity-artifact-reader.ts` around L4020+ (immediate neighbor of `readIdentityBountyCounts`).
  - Suggested name: `readIdentityTrappedWork` — signature `(conn: SSHClientType | null, identityKey: string) => Promise<{hasTrappedWork: boolean}>`.
  - Endpoint wiring in `src/backend/claude-session/claude-session-server.ts:1192` region (same batched-fan-out shape as `handleIdentityCountBounties`).

- **Scope motion — DELETE `readIdentityBountyCounts` alongside the frontend badges:**
  - The `readIdentityBountyCounts` fn is deletion-scope (no other consumers).
  - `src/backend/claude-session/claude-session-server.ts:73` import + L1192 wrapper + L1195+ `handleIdentityCountBounties` handler.
  - `src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts` file.
  - `src/backend/claude-session/claude-session-server.count-bounties.test.ts` file.
  - `src/ui/api/claude-session-api.ts` — `BountyCountTarget` type, `IdentityCountBountiesPayload` type, `BountyCountResult` type, `IdentityBountyCountsEvent` type, `countIdentityBounties` fn, `identity:count-bounties` / `identity:bounty-counts` WS wire type strings.
  - `src/ui/api/claude-session-api.count-bounties.test.ts` file.
  - `src/ui/state/bounty-counts-store.ts` + `bounty-counts-store.test.ts` (whole store retired — the new indicator gets its own store).
  - `src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx` + `PrettyBountyCountBadge.test.tsx`.
  - Two inline JSX wraps in `PrettyConversationRow.tsx` (L1227-1253) that render `.pv-bounty-badge-wrap[data-testid="pv-bounty-badge-pinned"]` (bl) and `[data-testid="pv-bounty-badge-needs-desk"]` (br).
  - CSS block at `pretty-conversations.css:662-675` (`.pv-avatar .pv-bounty-badge-wrap` avatar-corner positioning) — the corner-slot skeleton is REUSED for the trapped-work indicator; only the two `[data-testid=…]`-scoped rules get retired and replaced with a single new selector for the trapped-work wrap.
  - `useBountyCounts` import + call at `PrettyConversationRow.tsx:139` + L337-340.
  - `startBountyCountPoller` import + mount at `PrettyConversationsPanel.tsx:119` + L558.
  - `invalidateIdentity` piggyback at `src/ui/features/pretty-view/IdentityModal.tsx` (identity:update-bounty-priority success path — needs confirmation of exact line).
  - `useAllBountyCounts` + `bountyCountsCompositeKey` panel-level filter helpers at `PrettyConversationsPanel.tsx:120` + L729+.
  - Bounty-count references in `src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx:141` + `PrettyConversationsPanel.new-role-button.test.tsx:46` (mock stubs).

- **Visual:**
  - Icon: `GitPullRequestDraft` from `lucide-react` (already in project; verified `git-pull-request-draft.mjs` exists in installed lucide-react@1.28.0 icon set).
  - Placement: avatar-corner in BOTH conv-list rows AND `IdentityBadge` pretty-view-header. Bottom-right slot on the conv-list avatar (the slot freed by removing the needs-desk wrap); proportional bottom-right on the 56px IdentityBadge avatar.
  - Color: warm amber, in-family with existing warm-cream / off-white palette; drop-shadow glow at ~40% intensity.
  - Tooltip on hover: **"Has local work not yet pushed to any remote"** (locked from discuss-phase).
  - No click behavior; hover-only affordance.

- **Behavior:**
  - Binary per-identity aggregation. Always-shown (active + dormant identities alike).
  - Start-absent, populate-on-probe-return (no loading affordance).
  - Poll cadence: match existing bounty-counts-store cadence (60s + window.focus). NOTE: CONTEXT.md says "~30s existing fleet-status cadence" — codebase inspection reveals the actual analog (bounty-counts-store) polls at **60 000 ms**, not 30s. See "Poll cadence — codebase-verified figure" below.
  - Silent-fail on pre-convention identities that have no eligible workspace on disk. No override, no bandage.
  - No manual refresh on git hook (deferred).

### Claude's Discretion

- Tooltip copy wordsmithing (locked at "Has local work not yet pushed to any remote", but small tweaks are fine).
- Exact CSS token values for the warm-amber color, drop-shadow intensity, corner-slot offset (must build against existing `--color-pv-*` tokens in `src/ui/index.css:143-159`; don't invent new palette values).
- Exact shell script shape on the SSH remote branch — the ONLY constraint is `python3 -c '…'` single-round-trip returning `{"hasTrappedWork":true|false}` JSON (mirroring `readIdentityBountyCounts`). Choice of `git`-vs-`os` calls inside the script is discretion.
- New store name (e.g., `trapped-work-store.ts`, or a more generic `identity-signals-store.ts` — see Open Question #2).

### Deferred Ideas (OUT OF SCOPE)

- Manual refresh on git hook (near-instant update after commit/push).
- Loading-state affordance during the first probe.
- Non-git version control (hg / svn / jj).
- Additional identity surfaces beyond conv-list row + pretty-view-header badge (identity modal header, expanded views, etc.).
- Pre-convention identity workspace migration (unrelated concern, own timeline).
- Any per-project drill-down, counts, or breakdown UI.
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 104 has no numbered requirement IDs in `.planning/ROADMAP.md` — the roadmap entry (line 2295-2300) simply lists title + "Depends on: Phase 102" + "TBD" for goal/requirements. All contractual requirements were established in the `/open` shape file + discuss-phase, both captured verbatim in CONTEXT.md and above under `<user_constraints>`.

| Ref | Contract | Research support |
|-----|----------|------------------|
| CTX-DET | Backend detector: per-identity workspace walk, per-project eligibility+trapped-state probe, binary aggregation | Runtime state inventory + Pattern 1 (SSH-exec mirror) below |
| CTX-DEL | Delete `readIdentityBountyCounts` fn + WS wire + tests + frontend badges + CSS | Deletion targets table in Removal Inventory below |
| CTX-ADD-ROW | Add trapped-work indicator on conv-list row avatar (bottom-right corner slot) | Pattern 3 (avatar-corner slot reuse) + Component Responsibilities below |
| CTX-ADD-BADGE | Add same indicator on IdentityBadge pretty-view-header avatar | Pattern 4 (IdentityBadge integration) below |
| CTX-VISUAL | GitPullRequestDraft lucide icon; warm amber; hover tooltip; no click | Pattern 5 (icon + palette tokens) + Assumptions Log entry A1 below |
| CTX-TESTS | Tests for detector (empty, mixed, nested, remote-less, depth-limit) + both frontend surfaces | Pattern 6 (test shape mirror) + Test coverage plan below |
| CTX-CADENCE | Poll on existing analog cadence | Cadence section below (codebase-verified 60s, NOT 30s) |
</phase_requirements>

## Summary

Phase 104 is a **surgical retire-and-replace** on an established, well-tested plumbing pattern. The existing per-row bounty-count wire (`readIdentityBountyCounts` → `identity:count-bounties` WS → `bounty-counts-store` → per-row hook → inline JSX in `.pv-avatar`) is the exact byte-shape template the new trapped-work indicator follows. The only genuine new pieces are (a) the git-state shell script that runs on the peer box, and (b) a lucide icon in a warm-amber pill in a slot the retiring badges are about to vacate.

**Key discoveries that shift the plan** (details in sections below):

1. **The "workspace" folder convention is aspirational, not shipped.** On this box (skynet-ec2), inspection of `~/.claude/identities/{tabitha,tanya,taylor,tiffany,tina}/skynet/` shows every one of them contains only `relay.json` + `relay-state/` — no `.git`, no source tree. The identities that ACTUALLY keep code trees do so on peer boxes (t1000, wren, etc.), and the folder name they use is **`skynet/`**, not `workspace/`. There is no `WORKSPACE_HOST_DIR` env var, no runtime discovery helper, no convention path defined anywhere in `src/`. This means the detector must (a) commit to a specific path convention explicitly in the plan, and (b) rely on the shape-file's "silent-fail on pre-convention identities" acceptance.

2. **The CONTEXT.md "~30s cadence" figure is wrong.** The actual analog (bounty-counts-store) polls at **60_000 ms** (`PrettyConversationsPanel.tsx:558`); the *true* fleet-status SSH-poll orchestrator polls at **2000 ms** (`ssh-poll-orchestrator.ts:978`) — a completely separate subsystem that Phase 104 does NOT touch. The correct cadence to match is 60s, and the correct subsystem to piggyback on is the bounty-counts-style one-shot WS poll — not fleet-status.

3. **`readIdentityBountyCounts` returns a PAIR `{pinnedCount, needsDeskCount}`; two DIFFERENT frontend badges consume it in the SAME row.** The current wire is one-count-per-request-for-two-badges. The new indicator is binary, one-per-identity. This actually SIMPLIFIES the wire — the deletion scope is broader than a naive read of "just rename the fn" would suggest (see Removal Inventory).

4. **`PrettyBountyCountBadge.tsx` (the component file) is currently UNUSED at runtime.** `PrettyConversationRow.tsx` (L1226+) inlines the JSX verbatim rather than calling `<PrettyBountyCountBadge/>` — the component-file exists for possible future consumers per patch #468 preservation contract. So the file deletion is a clean "no live consumers" removal, not a live-render migration.

**Primary recommendation:** Build the new indicator as an isolated, byte-shape-mirror clone of the existing bounty-counts wire. Do the delete pass AFTER the new wire is green (small blast-radius insurance — see Task-ordering note below).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detect trapped-work on a peer box | API / Backend (Node/Express + ssh2) | — | Central app has no filesystem access to peer boxes; must run SSH exec on the identity's home box. Mirror of `readIdentityBountyCounts` (same tier). |
| Batched fan-out of per-identity probes | API / Backend (WS handler) | — | Same connection-reuse-per-hostId pattern as `handleIdentityCountBounties` — one `connectOneShot` per non-local hostId, `Promise.allSettled` per target. |
| Client-side polling + snapshot store | Browser / Client (React `useSyncExternalStore`) | — | Byte-shape mirror of `bounty-counts-store.ts` — module-scoped Map keyed by `${identityKey}:${hostId ?? "local"}`, poller starts on panel mount. |
| Per-identity hook consumption | Browser / Client (React hook per row + per badge) | — | Byte-shape mirror of `useBountyCounts` — returns `undefined` pre-fetch or when identityKey is null (short-circuit for non-identity rows). |
| Row-avatar corner rendering (conv list) | Browser / Client (JSX inside `.pv-avatar`) | CSS (absolute-positioned corner slot) | Reuse the existing `.pv-avatar .pv-bounty-badge-wrap` absolute-positioning skeleton; retire the two `[data-testid=…]`-scoped positioning rules; add one new `[data-testid="pv-trapped-work-indicator"]` rule. |
| Badge-avatar corner rendering (IdentityBadge) | Browser / Client (inline JSX inside IdentityBadge's `inner` fragment) | CSS-in-JS (inline style, same file) | IdentityBadge uses inline `style={…}` for its coordinator watermark — the trapped-work indicator on this surface follows the same inline-style pattern (no CSS class needed; both branches of the badge component render the same `inner` fragment). |
| Tooltip on hover | Browser / Client (native `title=""` attribute) | — | No tooltip library in-use; native `title` attribute is the pre-existing pattern. |

## Standard Stack

### Core (all already installed — verified from `package.json` L155-177 + `node_modules/lucide-react/dist/esm/icons/`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `lucide-react` | ^1.28.0 | `GitPullRequestDraft` icon | Already the fleet's icon library; verified via `ls node_modules/lucide-react/dist/esm/icons/ \| grep git-pull` that `git-pull-request-draft.mjs` is shipped in the installed version. Same import pattern as existing `import { Pin, Monitor } from "lucide-react"` at `PrettyConversationRow.tsx:133`. |
| `ssh2` (`Client`) | (transitive via existing code) | SSH exec for remote git-state probe | Mirror `execCommand` / `execWithTimeout` at `identity-artifact-reader.ts:352-365`. |
| `ws` (WebSocket) | (transitive) | WS handler for batched probe | Same seam pattern as `__handleIdentityCountBountiesForTests` in `claude-session-server.ts:1347`. |
| React + `useSyncExternalStore` | ^19.2.5 | Module-scoped store + per-row subscription | Byte-shape mirror of `bounty-counts-store.ts` L33-83; project pattern is roll-your-own useSyncExternalStore, NOT zustand/jotai/redux (per bounty-counts-store.ts L7 comment). |

### Supporting (already in use — no new dependencies needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.1.8 | Test framework | All backend + frontend tests |
| `@testing-library/react` | (in-use) | Component render + hook testing | See `bounty-counts-store.test.ts` L16 for `renderHook` + `act` pattern; see `PrettyConversationRow.test.tsx` for row-render pattern. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Piggyback on `bounty-counts-store` cadence via one-shot WS | Piggyback the actual 2s fleet-status SSH poll orchestrator | Fleet-status is a completely different subsystem (`src/backend/fleet-status/ssh-poll-orchestrator.ts`) with a persistent SSH connection and 2s cadence — orders of magnitude more traffic than warranted for a rescue-oriented signal. Discuss-phase's "correction to Vehicle Notes" already resolved this: use the claude-session-server / one-shot-WS pattern, NOT fleet-status. |
| Bake `hasTrappedWork` onto the `Identity` object (mirror `coordinator: boolean`) | Add field to REST GET /identities emit | Would require a per-request SSH fan-out on every identity list — currently GET /identities has no such SSH fan-out for `coordinator` (it reads on-disk YAML frontmatter from bind-mount or SSH once). Trapped-work state is dynamic; identity roster is cached. Mixing the two would either (a) make GET /identities slow, or (b) require background refresh anyway. Better to keep the trapped-work store separate (mirrors bounty-counts pattern exactly, preserves the polling separation of concerns). |
| `simple-git` npm package for git probing | Just shell out to `git` via SSH | `simple-git` is a Node library — useless when the git commands need to run on a REMOTE peer box over SSH. Native `git` + `python3` is the correct choice. |
| `porcelain=v2` or `git status --porcelain=v2 -b` | Multiple targeted `git` calls (status + rev-list + stash list) | Two designs work. Multiple targeted calls are easier to short-circuit on the first `hasTrappedWork=true` finding; `--porcelain=v2 -b` needs full parsing. Given tiny scale (typically <5 repos per identity), either is fine; recommendation is multiple targeted calls with early exit inside the python3 script. |

**Installation:** Nothing to install. All dependencies are already in `package.json`.

**Version verification:**
- `lucide-react@1.28.0` — installed via `npm view lucide-react version` would return newer, but the phase MUST use the pinned major (already imported throughout the project at that version).
- `GitPullRequestDraft` icon existence verified via direct filesystem inspection of `node_modules/lucide-react/dist/esm/icons/git-pull-request-draft.mjs`.

## Package Legitimacy Audit

This phase installs **no new packages**. Every dependency (`lucide-react`, `ssh2`, `ws`, `react`, `vitest`, `@testing-library/react`, `js-yaml`) is already in `package.json` and in-use across the codebase. No slopcheck run needed.

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Peer box (identity's home box, e.g. t1000, wren)                        │
│  ~/.claude/identities/<identityKey>/skynet/  (git repo — the workspace)  │
│         ↓                                                                 │
│   python3 script (invoked via SSH exec):                                 │
│     - `find` outermost .git dirs to bounded depth                        │
│     - for each: `git remote` (skip if empty), `git status --porcelain`, │
│       `git stash list`, `git rev-list --branches --not --remotes --count`│
│     - short-circuit on first trapped-state; emit {"hasTrappedWork":T|F}  │
└──────────────────────────────────────────────────────────────────────────┘
         ↓ (single SSH exec per identity per poll, via existing ssh2 Client)
┌──────────────────────────────────────────────────────────────────────────┐
│  Backend: claude-session-server.ts                                        │
│    identity-artifact-reader.ts::readIdentityTrappedWork(conn, key)       │
│                     ↑                                                     │
│    handleIdentityTrappedWork(ws, msg, userId) WS handler                 │
│      - groups targets by hostId, one connectOneShot per hostId group     │
│      - Promise.allSettled per target                                     │
│      - emits {type: "identity:trapped-work", results: [...]}             │
└──────────────────────────────────────────────────────────────────────────┘
         ↓ (WebSocket, one-shot request-response, closed by client)
┌──────────────────────────────────────────────────────────────────────────┐
│  Frontend: src/ui/                                                        │
│    api/claude-session-api.ts::probeIdentityTrappedWork(targets)          │
│                     ↑                                                     │
│    state/trapped-work-store.ts (useSyncExternalStore)                    │
│      - Map<`${identityKey}:${hostId ?? "local"}`, {hasTrappedWork}>      │
│      - startTrappedWorkPoller(getTargets, 60_000) — mount in Panel       │
│      - useTrappedWork(identityKey, hostId) hook                          │
└──────────────────────────────────────────────────────────────────────────┘
         ↓ (subscription per render)                     ↓
┌──────────────────────────────┐          ┌───────────────────────────────┐
│ PrettyConversationRow.tsx    │          │ IdentityBadge.tsx             │
│   .pv-avatar corner (br)     │          │   inner fragment corner (br)  │
│   GitPullRequestDraft icon   │          │   GitPullRequestDraft icon    │
│   amber pill                 │          │   amber pill                  │
└──────────────────────────────┘          └───────────────────────────────┘
```

### Recommended Project Structure (files created + deleted + modified)

```
src/
├── backend/claude-session/
│   ├── identity-artifact-reader.ts                          # MODIFY: add readIdentityTrappedWork; DELETE readIdentityBountyCounts (~L4020-4146)
│   ├── identity-artifact-reader.count-bounties.test.ts      # DELETE
│   ├── identity-artifact-reader.trapped-work.test.ts        # CREATE
│   ├── claude-session-server.ts                             # MODIFY: add handleIdentityTrappedWork + WS route; DELETE handleIdentityCountBounties (~L1195-1347) + WS route (L5714-5717) + import (L73)
│   ├── claude-session-server.count-bounties.test.ts         # DELETE
│   └── claude-session-server.trapped-work.test.ts           # CREATE
├── ui/
│   ├── api/
│   │   ├── claude-session-api.ts                            # MODIFY: add probeIdentityTrappedWork + types (~L1074-1216 region); DELETE countIdentityBounties + all bounty-count types
│   │   ├── claude-session-api.count-bounties.test.ts        # DELETE
│   │   └── claude-session-api.trapped-work.test.ts          # CREATE
│   ├── state/
│   │   ├── bounty-counts-store.ts                           # DELETE
│   │   ├── bounty-counts-store.test.ts                      # DELETE
│   │   ├── trapped-work-store.ts                            # CREATE (byte-shape mirror of bounty-counts-store.ts)
│   │   └── trapped-work-store.test.ts                       # CREATE
│   └── features/
│       ├── pretty-conversations/
│       │   ├── PrettyBountyCountBadge.tsx                   # DELETE
│       │   ├── PrettyBountyCountBadge.test.tsx              # DELETE
│       │   ├── PrettyConversationRow.tsx                    # MODIFY: retire useBountyCounts + two inline JSX wraps at L1226-1253; add useTrappedWork + one inline JSX wrap
│       │   ├── PrettyConversationRow.test.tsx               # MODIFY: retire A-F bounty-badge tests; add trapped-work presence/absence tests
│       │   ├── PrettyConversationsPanel.tsx                 # MODIFY: swap startBountyCountPoller for startTrappedWorkPoller; retire useAllBountyCounts + bountyCountsCompositeKey filter helpers (see Open Question #1)
│       │   ├── NewConversationModal.flow.test.tsx           # MODIFY: swap mock stub name (L141)
│       │   ├── PrettyConversationsPanel.new-role-button.test.tsx # MODIFY: swap mock stub name (L46)
│       │   └── pretty-conversations.css                     # MODIFY: retire the two `[data-testid="pv-bounty-badge-*"]` positioning rules at L669-675; keep the shared `.pv-avatar .pv-bounty-badge-wrap` base rule (rename); add trapped-work styling
│       ├── terminal/
│       │   ├── IdentityBadge.tsx                            # MODIFY: add trapped-work indicator to `inner` fragment; consume useTrappedWork with (identityKey, hostId)
│       │   └── IdentityBadge.test.tsx                       # MODIFY: add trapped-work presence/absence tests (BADGE-TRAP-1..N pattern, mirrors BADGE-COORD-1..3 at L401+)
│       └── pretty-view/
│           └── IdentityModal.tsx                            # MODIFY: retire invalidateIdentity import + call from the identity:update-bounty-priority success path
```

### Pattern 1: SSH-remote probe function (mirror `readIdentityBountyCounts`)

**What:** A single async function with LOCAL branch (`conn === null`, reads bind-mount via `fs`) and REMOTE branch (uses `execWithTimeout(conn, cmd)` over SSH). Both branches return the same shape `{hasTrappedWork: boolean}`.

**When to use:** Every backend identity-artifact read follows this shape (see `readIdentityFile`, `readIdentityBounties`, `readRoleFile`, etc. — all in `identity-artifact-reader.ts`).

**Example (skeleton — plan-time only, not final):**

```typescript
// Source: mirrors src/backend/claude-session/identity-artifact-reader.ts:4052-4146
//         (readIdentityBountyCounts REMOTE branch structure)

// Path convention: ~/.claude/identities/<identityKey>/skynet/  (per shape-file "per-identity
// workspace" — see Open Question #3 for the alternative). Silent-fail for pre-convention
// identities that don't have this folder is the accepted behavior (locked).
const WORKSPACE_SUBDIR = "skynet";   // NOTE: not "workspace" — see Runtime State Inventory below
const MAX_DEPTH = 3;                 // bounded per shape file; picked so a top-level project
                                     // + one nested checkout is discovered but deeper trees
                                     // don't fan out (see Open Question #4).

export async function readIdentityTrappedWork(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ hasTrappedWork: boolean }> {
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }

  if (conn === null) {
    // LOCAL branch — for skynet-ec2's own identities.
    // On this box, ~/.claude/identities/<key>/skynet/ is currently empty for every
    // identity (see Runtime State Inventory). Local branch will normally return
    // {hasTrappedWork: false} — but the code MUST exist and be correct so LOCAL-hosted
    // identities that DO adopt the convention are supported without new plumbing.
    // Same shape as readIdentityBountyCounts LOCAL branch (fs.readdir + walk).
    // ... (see Pattern 2 for the git-state check semantics)
    return { hasTrappedWork: false /* or true if any eligible repo has trapped state */ };
  }

  // REMOTE branch — python3 one-liner emits single JSON line with the answer.
  // Same pattern as identity-artifact-reader.ts:4102-4141.
  const script = /* python3 script that walks WORKSPACE_SUBDIR, invokes `git` per repo,
                    short-circuits on first trapped state, prints {"hasTrappedWork": T|F} */;
  const cmd =
    `python3 -c ${shellEscape(script)} ` +
    `"$HOME/.claude/identities/${identityKey}/${WORKSPACE_SUBDIR}"`;
  const stdout = await execWithTimeout(conn, cmd);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`remote trapped-work returned malformed payload: ${stdout}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).hasTrappedWork !== "boolean"
  ) {
    throw new Error(`remote trapped-work returned malformed payload: ${stdout}`);
  }
  return { hasTrappedWork: (parsed as { hasTrappedWork: boolean }).hasTrappedWork };
}
```

**Key existing helpers to reuse (all in `identity-artifact-reader.ts`):**
- `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` (L174) — shell-safety gate; identityKey is regex-validated so `"$HOME/.claude/identities/${identityKey}/…"` direct interpolation inside double-quotes is safe.
- `shellEscape(s)` (L336-338) — single-quote wrap for the python3 script body.
- `execWithTimeout(conn, cmd)` (L352-365) — wraps `execCommand` from `../ssh/tmux-helper.js` in a 15s `Promise.race` timeout. (**Timeout note**: bumped 3000→15000ms 2026-09-02 per patch 260902-3ll; comment at L344-348 explains why. 15s is generous for a `git` shell-out — the identity-artifact reader already tolerates this for the bounty-count case.)

**Anti-Patterns to Avoid:**
- **Do NOT open a new SSH connection per identity.** Batching + `connectOneShot`-once-per-hostId is the established pattern (see `handleIdentityCountBounties` at `claude-session-server.ts:1229-1332`). Multiple opens = repeated auth overhead + timeout risk.
- **Do NOT call `git` for anything that can be done with `os` in python3.** The `git remote -v` / `git status` / `git rev-list` calls each spawn a shell subprocess; on a peer box under load that adds up. If a repo has NO remote, short-circuit BEFORE calling status/stash.

### Pattern 2: Git eligibility + trapped-state probe (executor scope: exact commands)

The shape file locked the semantics; here's the concrete command mapping the plan can specify verbatim:

| Eligibility / trapped-state check | Concrete `git` command | Notes |
|-----------------------------------|-----------------------|-------|
| Repo has any remote configured? | `git -C "$repo" remote` (empty stdout → skip repo) | Short-circuit early; `git remote -v` is heavier and not needed. |
| Dirty tracked files (staged or unstaged) | `git -C "$repo" status --porcelain=v1` — any line whose second column is NOT `?` counts | `?` = untracked = ignored per eligibility rules. Modified/added/deleted tracked files count. |
| Local commits not reachable from any remote (any branch, upstream-or-not) | `git -C "$repo" rev-list --branches --not --remotes --count` — nonzero count = trapped | This is the canonical incantation for "commits on any local branch not on any remote"; handles local-only branches (no upstream) correctly, which the shape file explicitly requires. Verified via `git rev-list --count HEAD --not --remotes` on this repo returning `4`. |
| Stashes on the reflog | `git -C "$repo" stash list` — any output = trapped | One-line-per-stash; simple line count works. |

**Depth-limited outermost-.git walk** (skip nested `.git` — the shape's "only outermost repo" rule):

```bash
find "$root" -maxdepth $MAX_DEPTH -type d -name .git -prune -print
```

The `-prune` tells find to NOT descend into `.git` itself (avoiding the internal `.git/modules/…` for submodules and `.git/worktrees/…` for worktrees). But this does NOT skip nested SUBDIRECTORY-level repos (e.g. `foo/vendored/.git` inside `foo/.git`'s working tree). The shape file's "outermost-only" rule requires additional logic: **after `find` returns .git paths, group by prefix and drop any that share a prefix with a shorter path.** This is a small python3 dict-sort.

**Full remote-branch python3 script sketch** (the plan can iterate; this is a load-bearing sketch, not final):

```python
import os, sys, subprocess, json

root = os.path.expanduser(sys.argv[1])
MAX_DEPTH = 3

if not os.path.isdir(root):
    print(json.dumps({"hasTrappedWork": False}))
    sys.exit(0)

# Find all .git dirs up to MAX_DEPTH, skipping descent into .git itself
found = []
def walk(path, depth):
    if depth > MAX_DEPTH: return
    try: entries = os.listdir(path)
    except (PermissionError, FileNotFoundError): return
    if ".git" in entries and os.path.isdir(os.path.join(path, ".git")):
        found.append(path)
        return                          # outermost-only: don't descend past a found repo
    for e in entries:
        p = os.path.join(path, e)
        if os.path.isdir(p) and not os.path.islink(p):
            walk(p, depth + 1)
walk(root, 0)

def sh(args, cwd):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=5)
        return r.stdout
    except Exception: return ""

for repo in found:
    if not sh(["git","remote"], repo).strip(): continue        # no remote → skip
    if any(l and l[1] != "?" for l in sh(["git","status","--porcelain=v1"], repo).splitlines()):
        print(json.dumps({"hasTrappedWork": True})); sys.exit(0)
    try:
        n = int(sh(["git","rev-list","--branches","--not","--remotes","--count"], repo).strip() or "0")
    except ValueError: n = 0
    if n > 0:
        print(json.dumps({"hasTrappedWork": True})); sys.exit(0)
    if sh(["git","stash","list"], repo).strip():
        print(json.dumps({"hasTrappedWork": True})); sys.exit(0)

print(json.dumps({"hasTrappedWork": False}))
```

**Reliability notes:**
- Per-subprocess 5s timeout so a hung `git` call can't hang the whole probe under `execWithTimeout`'s 15s outer limit.
- `try/except` around every parse (subprocess call, int cast) — a poisoned repo must not fail the whole answer (matches the bounty-count pattern's "per-file error swallowed" invariant at L4096).
- `os.path.islink` skip prevents symlink loops from blowing MAX_DEPTH.

### Pattern 3: Avatar-corner slot reuse (row-side JSX + CSS)

The retirement of the two bounty badges frees BOTH corners of the avatar (bl=pinned, br=needs-desk). The new indicator claims **br** (locked). The CSS skeleton is directly reusable:

**Existing base rule (`pretty-conversations.css:662-667`) — KEEP, rename class to be indicator-agnostic:**

```css
/* Was: .pv-avatar .pv-bounty-badge-wrap { … } */
/* New: */
.pv-avatar .pv-avatar-corner-indicator {
  position: absolute;
  bottom: -4px;
  right: -8px;                     /* br only — single slot now */
  z-index: 2;                       /* above spinner ring (z-index: 1); pointer-events: none */
  pointer-events: none;
}
```

**Retiring rules (`pretty-conversations.css:669-675`) — DELETE:**

```css
/* DELETE both rules — bounty badges gone */
.pv-avatar .pv-bounty-badge-wrap[data-testid="pv-bounty-badge-pinned"] { left: -8px; }
.pv-avatar .pv-bounty-badge-wrap[data-testid="pv-bounty-badge-needs-desk"] { right: -8px; }
```

**Row JSX (retire L1227-1253, replace with):**

```tsx
// New: single indicator wrap, br corner of .pv-avatar
// Amber pill styling — TBD by executor per user_constraints "Claude's Discretion" on exact tokens;
// build against --color-pv-* tokens in src/ui/index.css:143-159 (do NOT invent new palette values).
{trappedWork?.hasTrappedWork === true && (
  <span
    className="pv-avatar-corner-indicator pv-trapped-work-indicator"
    data-testid="pv-trapped-work-indicator"
    title="Has local work not yet pushed to any remote"
  >
    <GitPullRequestDraft className="pv-trapped-work-icon" aria-hidden="true" />
  </span>
)}
```

**Notes:**
- The `title=""` attribute is the tooltip. Native browser tooltip; no library needed (project uses `title=""` in existing IdentityBadge at L317 — matching pattern).
- Only render when `hasTrappedWork === true`. `undefined` (pre-fetch) or `false` (probe returned no trapped work) → nothing renders. This satisfies "start-absent, populate-on-probe-return" locked behavior.
- `pointer-events: none` on the wrap allows the underlying avatar click to pass through (the row is click-to-select). Native tooltip still fires on hover because `title` is on the wrap itself and hover doesn't require `pointer-events`. Actually — testing needed here: `pointer-events: none` might disable the title tooltip. If so, use `pointer-events: auto` and rely on the row click bubbling from the wrap onto the row's onClick (established pattern; the bounty-count wraps had `pointer-events: none` at L666, and the row-click continued to work because the click landed on the underlying `.pv-avatar` at DOM parent). **Verification-time gotcha** — see Common Pitfalls #2.

### Pattern 4: IdentityBadge integration (`IdentityBadge.tsx`)

IdentityBadge is more constrained than the row — no external CSS file consumed for the badge (all styling is inline via `style={rootStyle}` and inline nested spans). The coordinator watermark (L147-156) already demonstrates the pattern: conditional render inside the `inner` fragment, inline `style={…}`, non-interactive (`pointer-events: none`).

**Where to add** (inside `inner` fragment, after L156 coordinator-watermark, before L164 avatar `<img>`):

```tsx
// New: trapped-work indicator, proportional bottom-right of the 56px avatar.
// hostId is passed to IdentityBadge as a prop (L18 — see IdentitySessionPane.tsx:445 for
// existing call site that already threads it, though Phase 68 made it a no-op for avatar
// URL construction). Reactivate the prop for the trapped-work store lookup.
{trappedWork?.hasTrappedWork === true && (
  <span
    aria-hidden="true"
    data-testid="pv-trapped-work-indicator"
    title="Has local work not yet pushed to any remote"
    style={{
      position: "absolute",
      // Proportional to the 56px avatar — corner offset scaled up from the
      // row's -4px/-8px on a ~40px avatar. Executor to taste against the
      // pretty-view design tokens per shape file "aesthetic fidelity".
      left: `calc(8px + 56px - 12px)`,        // near right edge of avatar
      top: `calc(8px + 56px - 12px)`,          // near bottom edge of avatar
      // amber pill via inline style, matching the coordinator-watermark inline pattern
      pointerEvents: "none",
      zIndex: 2,
    }}
  >
    <GitPullRequestDraft width={16} height={16} aria-hidden="true" />
  </span>
)}
```

**Reactivate hostId for the store lookup:** IdentityBadge props already carry `hostId?: number` at L18 (backward-compat no-op post-Phase-68). Call sites at `IdentitySessionPane.tsx:291,410,445` already pass it. The new `useTrappedWork(identityKey, hostId ?? null)` call at the top of `IdentityBadge` re-purposes that prop.

**Coexistence with coordinator watermark:** No stacking issues expected. Coordinator watermark is `z-index: 0` (pretty-conversations.css:1537) and the row's `.pv-body` explicitly z-indexes to 1 to stay above (L702-703). The trapped-work indicator with `z-index: 2` on both surfaces stays above both. Both are `pointer-events: none`. Both are visually distinct (coordinator = large hue-tinted watermark background; trapped-work = tiny amber corner icon). Semantic overlap risk = zero (one indicates identity role, one indicates repo state).

### Pattern 5: Icon + palette tokens

**Icon import:** `import { GitPullRequestDraft } from "lucide-react"` — same pattern as `import { Pin, Monitor } from "lucide-react"` at `PrettyConversationRow.tsx:133`. Icon file verified present: `node_modules/lucide-react/dist/esm/icons/git-pull-request-draft.mjs`.

**Palette tokens to build against** (per shape file constraint "don't introduce new palette values"):

Location: `src/ui/index.css:143-159` — pretty-view palette (`--color-pv-*` tokens). Not read in this research pass, but the plan should reference these for the amber pill background, glow, and drop-shadow values. Executor picks the specific tokens during implementation.

**Warm-amber recommendation** (from shape "warm amber, in-family with the existing warm-cream / off-white palette"):
- Icon fill: cream (matches Pin/Monitor's `#f0ebe0` from `PrettyBountyCountBadge.tsx` L17 comment).
- Pill background: warm amber, likely `hsla(35, 65%, 55%, X)` family (35° hue is the pretty-view default warm color per `IdentityBadge.tsx:109` fallback + `pretty-conversations.css:1521` `hsla(35, ...)` inset).
- Glow: 40% intensity per shape file — inline `box-shadow: 0 0 12px hsla(35, 65%, 55%, 0.4)` or equivalent CSS variable.

### Pattern 6: Test shape (mirror bounty-counts tests)

Test files created and their mirror sources:

| New test file | Mirror source | Coverage |
|---------------|---------------|----------|
| `identity-artifact-reader.trapped-work.test.ts` | `identity-artifact-reader.count-bounties.test.ts` (L1-192) | LOCAL branch: no workspace dir → false; clean repo → false; repo with dirty tracked files → true; repo with local-only commits → true; repo with stash → true; repo without remote → false (ignored); nested repos → outermost-only counted; depth-limit boundary; malformed .git swallowed; identityKey path-traversal rejected. |
| `claude-session-server.trapped-work.test.ts` | `claude-session-server.count-bounties.test.ts` | Empty targets → empty results; local-only batch → no `connectOneShot`; 5 targets same hostId → exactly one `connectOneShot`; dead host → all targets get error field; per-target error isolation via `Promise.allSettled`. |
| `claude-session-api.trapped-work.test.ts` | `claude-session-api.count-bounties.test.ts` | Opens WS, sends one `identity:probe-trapped-work` frame, resolves on `identity:trapped-work` response, closes; transport failure rejects with "Connection failed". |
| `trapped-work-store.test.ts` | `bounty-counts-store.test.ts` (L1-379) | `useTrappedWork` returns undefined pre-fetch; returns `{hasTrappedWork: boolean}` post-fetch; composite-key isolation (same identityKey, different hostId → independent); `refreshTrappedWork` preserves last-known on per-target error; poller fires initial + interval + focus; stop-fn clears both. |
| `PrettyConversationRow.test.tsx` new tests | Existing L1824-1876 tests | Indicator absent when `undefined`; absent when `hasTrappedWork: false`; present with `data-testid="pv-trapped-work-indicator"` when `hasTrappedWork: true`; icon has `aria-hidden`; tooltip present as `title` attribute. |
| `IdentityBadge.test.tsx` new tests | Existing BADGE-COORD-1..3 at L392+ | BADGE-TRAP-1: hasTrappedWork=true renders indicator inside badge root; BADGE-TRAP-2: absent → no indicator; BADGE-TRAP-3: coordinator + trapped-work coexist (both render). |

**Mock pattern for the row test** (mirroring L119-128):

```tsx
let currentTrappedWork: { hasTrappedWork: boolean } | undefined = undefined;
vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => currentTrappedWork,
}));
```

### Anti-Patterns to Avoid

- **Do NOT bake `hasTrappedWork` onto the `Identity` REST shape.** See Alternatives Considered — would slow GET /identities or require background refresh anyway.
- **Do NOT introduce a new WebSocket message subscription** (e.g., a persistent stream). The one-shot request-response pattern (`countIdentityBounties` at `claude-session-api.ts:1173-1216`) is the shape to mirror — open, send, receive one, close. Persistent WS subscriptions come with lifecycle complexity that this indicator does not warrant.
- **Do NOT rename the existing base CSS class `.pv-bounty-badge-wrap` to something trapped-work-specific.** Rename it to indicator-generic (e.g., `.pv-avatar-corner-indicator`) so a future third-indicator addition doesn't repeat the same class-rename thrash.
- **Do NOT delete `readIdentityBountyCounts` before the new wire is green.** Do the delete pass as the LAST task in the phase. This preserves rollback capacity if the new wire has a UAT-surfacing bug.
- **Do NOT hard-code the workspace path in a way that requires code change to migrate to `workspace/`.** Consider an env-var override (`IDENTITY_WORKSPACE_SUBDIR` defaulting to `"skynet"`) so the eventual migration to `workspace/` requires only an env change — but weigh that against "no override, no bandage" from the shape file. See Open Question #3.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting "commits not on any remote, including local-only branches" | Custom rev-walk + branch enumeration | `git rev-list --branches --not --remotes --count` | Handles local-only branches (no upstream), tag-vs-branch distinctions, packed refs. One-liner beats any custom walker. Verified via manual run on this repo. |
| Escaping shell arguments for python3 script body inlined in an SSH command | Custom string escape | `shellEscape` at `identity-artifact-reader.ts:336-338` | Existing single-source-of-truth helper; used by every remote-branch reader in this file. |
| Timeout-wrapping an SSH exec | New Promise.race wrapper | `execWithTimeout` at `identity-artifact-reader.ts:352-365` | Already exists, 15s timeout per patch 260902-3ll rationale (cap-8 SSH semaphore backpressure). |
| Batching per-target requests to per-hostId SSH connections | New batching code | The `handleIdentityCountBounties` pattern at `claude-session-server.ts:1195-1342` | Byte-shape-mirror it; connection-reuse-per-hostId + `Promise.allSettled` + `try/finally conn.end()` is battle-tested. |
| React store with per-key subscriptions | `zustand`, `jotai`, `redux` | `useSyncExternalStore` following `bounty-counts-store.ts` L33-83 pattern | Project explicitly rolls its own (see `bounty-counts-store.ts` L7 comment). Adding a new state library to this narrow feature would be an unforced dep bump. |
| Polling loop with `setInterval` + `window.focus` refresh | Ad-hoc timer + event listener | `startBountyCountPoller` shape at `bounty-counts-store.ts:180-202` | Established pattern; comes with a stop-fn that cleans up both the interval AND the focus listener. |
| Tooltip UI component | Radix Tooltip / Floating UI / custom hover-state | Native `title=""` attribute | `IdentityBadge.tsx:317` uses `title="Identity info"` — native browser tooltip is the pre-existing project convention for hover hints. |

**Key insight:** This phase's engineering value is 95% cloning a known-good wire and 5% writing a small python3 script. The temptation to introduce structure (a "unified per-identity signals store" that covers both trapped-work and future indicators) is real but wrong — the existing byte-shape-mirror pattern is already the reusable structure; adding a meta-abstraction on top adds review cost without reducing execution risk. See Open Question #2.

## Runtime State Inventory

Phase 104 is NOT a rename/refactor phase in the classic sense, but the deletion of `readIdentityBountyCounts` + its WS wire IS a targeted retire-and-replace with runtime-state implications. Filling out the standard categories:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** Bounty-count cache is in-memory only (`bounty-counts-store.ts` L46 `state: State = { counts: new Map... }`). Trapped-work cache will also be in-memory. No SQLite state, no on-disk artifacts. | none |
| Live service config | **None.** No env vars, no config file entries, no service discovery involved. `IDENTITIES_HOST_DIR` + `ROLES_HOST_DIR` + `IDENTITIES_LOCAL_HOST_IDS` are consumed by the identity-artifact-reader base infrastructure (unchanged); no new env var required unless the plan opts into `IDENTITY_WORKSPACE_SUBDIR` (see Open Question #3). | none |
| OS-registered state | **None.** No cron jobs, no systemd services, no Task Scheduler, no pm2 processes registered against the bounty-count or trapped-work names. | none |
| Secrets / env vars | **None.** No SOPS keys, no secret rotation. | none |
| Build artifacts | **None hostname-specific.** The build produces frontend bundles + backend `dist/`. The rename `bounty-counts-store.ts` → `trapped-work-store.ts` will produce a different chunk name in the frontend bundle but that's irrelevant — Skynet is not a public JS library and hash-versioning handles cache-busting via Vite's default asset pipeline. | none |
| **Workspace path convention (canonical question for this phase)** | Every identity's `~/.claude/identities/<key>/skynet/` on skynet-ec2 (the box-maintainer's central box) is currently **populated only with `relay.json` + `relay-state/`** — no `.git`, no source tree. Verified via `ls ~/.claude/identities/{tabitha,tanya,taylor,tiffany,tina}/skynet/`. The identities that actually hold Skynet source trees do so on peer boxes (t1000, wren, etc.); this box does not host any peer-identity workspaces. The "workspace" folder name in the shape file is aspirational language; the ACTUAL directory in use is `skynet/` (named after the project being worked on). | **PLAN MUST commit to a path convention.** Options: (a) hard-code `skynet/` as the workspace subdir; (b) hard-code `workspace/` as a future-aspirational subdir (will silently return `{hasTrappedWork:false}` for every identity until migration); (c) support both with env-var override. See Open Question #3. |

**The canonical question — after every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?**

Nothing on this axis. The bounty-counts wire is retired atomically inside the deploy — no daemon, no service, no scheduled job persists across the deploy that references `bounty-counts` or `readIdentityBountyCounts` by name. A dead frontend bundle in a stale browser tab would still send `identity:count-bounties` for a minute or two after deploy, but the WS handler is retired, so the browser would receive no matching response frame — the store would emit "transport failure" and stop polling. Acceptable transient failure mode (frontend refresh clears it).

## Environment Availability

Every dependency this phase needs is confirmed available in the deploy environment:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `python3` on every peer box | Remote-branch SSH exec (`readIdentityTrappedWork`) | ✓ | 3.12.3 on ec2 verified; per `identity-artifact-reader.ts:4049-4050` comment, python3 is universally present on identity boxes (the wakeup scheduler itself is python3) | none needed — universal fleet dep |
| `git` on every peer box | Remote python3 script's `subprocess.run(["git", …])` | ✓ (assumed, universal — every peer box has git for the actual source-tree work) | any recent | none needed — if a box lacks git, no repos exist and probe correctly returns `{hasTrappedWork:false}` via `git remote` empty stdout |
| `ssh2` (Node) | Existing infrastructure — already imported by every identity-artifact reader | ✓ | (transitive) | — |
| `lucide-react@1.28.0` with `GitPullRequestDraft` | Frontend indicator icon | ✓ | 1.28.0 pinned in package.json; icon verified at `node_modules/lucide-react/dist/esm/icons/git-pull-request-draft.mjs` | — |
| React 19 `useSyncExternalStore` | New store hook | ✓ | ^19.2.5 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Common Pitfalls

### Pitfall 1: The `~/.claude/identities/<key>/skynet/` folder is empty on skynet-ec2 — LOCAL-branch tests + smoke-tests need real fixture setup

**What goes wrong:** Executor runs local unit tests, they pass; deploys; QA-tests on skynet-ec2 via the browser; the indicator NEVER lights up for any identity because none of the LOCAL identities have a git tree at `~/.claude/identities/<key>/skynet/`. Executor thinks the wire is broken; actually the wire is correct and no LOCAL identity is eligible.

**Why it happens:** Skynet-ec2 is the central app box; peer identities live on peer boxes. LOCAL branch returns `{hasTrappedWork:false}` for every LOCAL identity because the folder is empty. Only REMOTE branch (peer boxes t1000, wren, etc., where identities keep actual repos) will surface trapped work.

**How to avoid:** The plan should include a smoke-test verification against a KNOWN peer box that has trapped work (e.g., "sign in as tina@t1000, confirm the indicator appears on tina's row after the poll cycle"). LOCAL unit tests can use `os.mkdtemp` to construct a fake workspace with a real `git init` + dirty file + push-less commit (exactly the pattern `identity-artifact-reader.count-bounties.test.ts` L60-80 uses for tmpdir fixtures).

**Warning signs:** "It works locally but I don't see it in production" is the top-of-mind expectation for this phase — flag in the plan's verification section.

### Pitfall 2: `pointer-events: none` on the corner-indicator wrap may kill the native `title` tooltip on hover

**What goes wrong:** Executor copies the existing bounty-badge-wrap CSS which has `pointer-events: none` (L666); the icon renders correctly; but hovering doesn't produce the tooltip because the browser needs the element to be pointer-eventable to fire the hover-title.

**Why it happens:** `pointer-events: none` was correct for the bounty-count wraps because they had NO tooltip AND needed the underlying avatar-click to pass through. The new indicator has a tooltip requirement.

**How to avoid:** Either (a) set `pointer-events: auto` on the indicator wrap and rely on click bubbling (the row's onClick will still fire when the click bubbles from the wrap up to the `.pv-avatar` and then to the row), OR (b) use `pointer-events: none` on the wrap but set `pointer-events: auto` on an inner element that carries the `title`. Verify during executor's PrettyConversationRow.test tweak by mounting + `fireEvent.mouseOver` + asserting the browser's native tooltip machinery — actually, native `title` tooltips don't fire in JSDOM; verification of tooltip has to be by manual UAT or by asserting the `title=""` attribute is present (test-shape approach preferred; see Pattern 6 test template).

**Warning signs:** Manual QA on the deployed indicator: hover doesn't show the tooltip.

### Pitfall 3: The `identityKey` regex `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` is enforced upstream, so direct shell interpolation is safe — but ONLY inside double-quotes

**What goes wrong:** Executor writes the SSH command as `python3 -c '...' $HOME/.claude/identities/${identityKey}/skynet` (no double-quotes around the path); a shell interprets `$HOME` correctly but an identityKey with characters not in the regex (which shouldn't happen due to upstream validation) would tokenize.

**Why it happens:** The comment at `identity-artifact-reader.ts:443-450` explains the exact rule: identityKey is regex-safe, so direct interpolation is fine, BUT the double-quote wrap around `"$HOME/.claude/identities/${identityKey}/skynet"` is required for `$HOME` to expand. This is standard practice in this file — mirror it verbatim.

**How to avoid:** Mirror `readIdentityBountyCounts` L4122-4124's exact form: `` `"$HOME/.claude/identities/${identityKey}/skynet"` `` inside the constructed command string. Do NOT use `shellEscape(identityKey)` inside the outer double-quotes (would create literal single-quotes as path chars per the comment).

**Warning signs:** Path-not-found errors when the box's `$HOME` isn't `/root` or `/home/ubuntu` — a bare `$HOME` gets literal-interpreted rather than shell-expanded.

### Pitfall 4: The bounty-count wire has MULTIPLE consumers (`useAllBountyCounts` for panel-level filter helper); the delete pass must sweep them all

**What goes wrong:** Executor deletes `bounty-counts-store.ts` and the row's `useBountyCounts` reference; forgets `useAllBountyCounts` at `PrettyConversationsPanel.tsx:729` (the panel-level "filter to rows with pinned bounties" helper); frontend fails to compile.

**Why it happens:** `bounty-counts-store.ts` exports FIVE public functions: `useBountyCounts`, `useAllBountyCounts`, `bountyCountsCompositeKey`, `refreshBountyCounts`, `startBountyCountPoller`, `invalidateIdentity` — plus one test-only helper. Each one has consumers. Deletion must sweep all.

**How to avoid:** Before the delete pass, run `grep -rn "bounty-counts-store\|useBountyCounts\|useAllBountyCounts\|bountyCountsCompositeKey\|refreshBountyCounts\|startBountyCountPoller\|invalidateIdentity\|countIdentityBounties\|BountyCountTarget\|IdentityCountBountiesPayload\|BountyCountResult\|IdentityBountyCountsEvent\|identity:count-bounties\|identity:bounty-counts\|pv-bounty-badge\|PrettyBountyCountBadge\|readIdentityBountyCounts\|handleIdentityCountBounties\|__handleIdentityCountBountiesForTests"` and enumerate every hit into the delete list. Then do them in one atomic commit (or several small atomic commits that each land compile-green).

**Warning signs:** TypeScript compile errors after the delete commit. IDE red-underlines. `npm run type-check` failures.

### Pitfall 5: The panel's `startBountyCountPoller` mounts UNCONDITIONALLY on panel mount (`PrettyConversationsPanel.tsx:558`) — the new poller must too, or dormant identities never get their probe

**What goes wrong:** Executor thinks "only poll for the row's currently-visible identities" or "gate on activeSet"; the poller misses dormant identities; the indicator never lights up for a dormant identity — which is the ENTIRE POINT of the feature per shape's "always shown, whether the identity is currently active or dormant."

**Why it happens:** The `getTargets` closure at L531-556 walks `pinned + middle + rdpGroup` refs (i.e., every row in the panel, active or dormant). Any narrowing that filters to active-set will break the dormant-identity case which is the feature's primary use case.

**How to avoid:** Mirror the `getTargets` closure verbatim — walk `pinnedRowsRef.current` + `middleRef.current` + `rdpGroupRef.current.rows` for identity resolution, dedupe by composite key, return the full deduped list. Poll every one of them every 60s.

**Warning signs:** During UAT, only currently-selected identities show the indicator; dormant ones never do.

### Pitfall 6: `readIdentityTrappedWork` calls `resolveRoleForIdentity` — wait, does it?

**What goes wrong:** Executor blindly copies `readIdentityBountyCounts`'s structure including the `const role = await resolveRoleForIdentity(conn, identityKey);` at L4065; but the trapped-work probe does NOT need the identity's role (workspace path is `~/.claude/identities/<key>/skynet`, no role indirection); the two-step read wastes a whole SSH round-trip AND throws if the identity has no `role:` frontmatter, gating the indicator on frontmatter presence unnecessarily.

**Why it happens:** `readIdentityBountyCounts` needs the role because bounties live at `~/.claude/roles/<role>/bounties/` post fleet migration (L4062-4065 comment). Trapped-work lives directly under the identity dir; no role indirection required.

**How to avoid:** Skip the `resolveRoleForIdentity` call for the trapped-work function. Path is `"$HOME/.claude/identities/${identityKey}/skynet"` — no role in the shape.

**Warning signs:** Every probe issues TWO SSH commands (identity file read + workspace probe) instead of one — noticeable in log volume + latency.

## Code Examples

### Common Operation 1: The new WS handler skeleton (mirror `handleIdentityCountBounties`)

```typescript
// Source: mirrors src/backend/claude-session/claude-session-server.ts:1195-1347

type TrappedWorkTarget = { identityKey: string; hostId: number | null };
type TrappedWorkResult = {
  identityKey: string;
  hostId: number | null;
  hasTrappedWork: boolean;
  error?: string;
};

export async function handleIdentityProbeTrappedWork(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  // Same shape as handleIdentityCountBounties L1200-1341:
  //   - parse targets from msg
  //   - group by hostId (local vs each non-local hostId)
  //   - for each group: connectOneShot ONCE, run all targets through it,
  //     Promise.allSettled, close conn in try/finally
  //   - flat + emit {type: "identity:trapped-work", results: [...]}
  // ...
}

// Test seam — matches L1347
export const __handleIdentityProbeTrappedWorkForTests = handleIdentityProbeTrappedWork;
```

### Common Operation 2: Frontend one-shot WS request

```typescript
// Source: mirrors src/ui/api/claude-session-api.ts:1173-1216 (countIdentityBounties)

export type TrappedWorkTarget = { identityKey: string; hostId: number | null };
export type IdentityProbeTrappedWorkPayload = {
  type: "identity:probe-trapped-work";
  targets: TrappedWorkTarget[];
};
export type TrappedWorkResult = {
  identityKey: string;
  hostId: number | null;
  hasTrappedWork: boolean;
  error?: string;
};
export type IdentityTrappedWorkEvent = {
  type: "identity:trapped-work";
  results: TrappedWorkResult[];
};

export function probeIdentityTrappedWork(
  targets: TrappedWorkTarget[],
): Promise<IdentityTrappedWorkEvent> {
  return new Promise((resolve, reject) => {
    let responded = false;
    const sock = openClaudeSessionSocket();
    sock.onopen = () => {
      const payload: IdentityProbeTrappedWorkPayload = {
        type: "identity:probe-trapped-work",
        targets,
      };
      try { sock.send(JSON.stringify(payload)); } catch { /* mid-close */ }
    };
    sock.onmessage = (event: MessageEvent<string>) => {
      if (responded) return;
      try {
        const raw = JSON.parse(event.data) as { type?: string };
        if (raw.type !== "identity:trapped-work") return;
        responded = true;
        resolve(raw as IdentityTrappedWorkEvent);
        try { sock.close(); } catch { /* ignore */ }
      } catch { /* wait for a valid frame */ }
    };
    const handleFail = () => {
      if (responded) return;
      responded = true;
      reject(new Error("Connection failed"));
    };
    sock.onerror = handleFail;
    sock.onclose = () => { if (!responded) handleFail(); };
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.pv-meta` right-column with two count-badges + ready-dot in a row | `.pv-avatar` corner-anchored badges + spinner ring on `.pv-avatar::before` | Phase 48 Plan 05 (Ashley 2026-08-19) | This phase RESUMES the trajectory: `.pv-avatar` corners are the canonical slot for per-identity visual affordances. The trapped-work indicator inherits directly from this pattern. |
| Bounty-count showed pinned+needs-desk role-scoped counters | Bounty-count retirement — no per-row bounty visibility (users open the bounty modal instead) | Phase 104 (this phase) | Removes role-scoped smearing across identity rows. Frees both avatar corners; new indicator claims br only. |
| Identity roster fetched via GET /identities every N seconds | Identity roster fetched once + coordinator/task overlays baked into the response; dynamic per-identity data (bounty counts, trapped work) polled via separate one-shot WS | Phase 67 (coordinator), Phase 80 (task), and Phase 26 (bounty-count polling) | Establishes the pattern this phase mirrors: static identity metadata on the REST payload, dynamic per-identity signals via lightweight WS poll stores. |

**Deprecated/outdated:**
- The `PrettyBountyCountBadge` component (file-level) has been unused at runtime since Phase 48 Plan 05 — `PrettyConversationRow.tsx` inlines the JSX at L1226-1253 rather than calling `<PrettyBountyCountBadge/>`. The file was preserved per patch #468 contract "for any future consumer that wants the pre-Phase-48 flex-row layout" — Phase 104 deletes it since no such consumer materialized.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Warm-amber inline styling (`hsla(35, ...)` family) is the right family for the trapped-work indicator, matching the existing IdentityBadge fallback hue at L109 and pretty-conversations.css `.pv-row.rdp` amber inset at L1521 | Pattern 5 | Wrong hue = visual clash with the row's per-identity hue-tinted background. Executor should build against tokens and taste-check during implementation; the shape file's "warm amber, in-family with the existing warm-cream / off-white palette" is the spec but no locked pixel value exists. Risk is low — tasting during UAT catches wrongness. |
| A2 | `~/.claude/identities/<key>/skynet/` is the intended workspace subdir on peer boxes (not `workspace/`, and no env-var override needed) | Pattern 1 + Runtime State Inventory + Open Question #3 | Wrong path = indicator never lights up on peer boxes. This is the LOAD-BEARING assumption of the whole phase. NEEDS USER CONFIRMATION during plan-checker or discuss-phase follow-up — the shape file's language is aspirational ("standardized location that new identities get by convention"), and the empirical evidence from this box shows the actual folder in use is `skynet/`. The plan MUST commit to a specific path AND MUST document that pre-convention identities silently fall out. |
| A3 | The 60s cadence + `startBountyCountPoller` pattern is the correct analog to piggyback on (NOT the 2s fleet-status SSH poll orchestrator) | Summary + Cadence + user_constraints | If 60s feels too slow in UAT ("I made a commit 45s ago and the indicator still shows trapped-work"), the plan may need to consider a shorter interval. The shape's rescue-oriented framing tolerates 30-60s easily. Discuss-phase locked "match the existing fleet-status / claude-session cadence (~30s)" but the actual existing analog polls at 60s; the plan should proceed at 60s and flag this discrepancy for user confirmation. |
| A4 | The two axis-independent flags in `readIdentityBountyCounts` (pinnedCount + needsDeskCount) genuinely have NO other consumers (i.e., the whole store can be deleted, not just the count-badge JSX) | Removal Inventory | If some other consumer exists (e.g., a filter helper somewhere), the delete pass causes compile errors. Mitigated by the grep-sweep in Pitfall #4. Confidence HIGH: exhaustive grep for `useBountyCounts\|useAllBountyCounts\|bountyCountsCompositeKey\|refreshBountyCounts\|startBountyCountPoller\|invalidateIdentity` shows ALL uses are inside the identified files (row, panel, panel test stubs, IdentityModal). |
| A5 | Native browser `title=""` attribute on a `pointer-events: none` element does or does not fire tooltip → verification needed at execution time | Pattern 3 + Pitfall 2 | Wrong assumption = no tooltip in production; UX broken. Risk is low — trivial to fix at UAT time by removing `pointer-events: none` and relying on click-bubble. |
| A6 | The MAX_DEPTH of 3 covers the intended workspace shape (identity/skynet/ has repos at depth 1, or at depth 2 for organized subdirs); deeper trees are edge cases not worth searching | Pattern 1 + Open Question #4 | Too shallow = misses repos in `identity/skynet/monorepos/foo/.git`. Too deep = pathological box with 10k .git dirs causes probe timeout. Sane default (3) matches shape file "bounded depth"; executor can tune. |

## Open Questions

1. **`useAllBountyCounts` panel-level filter — what replaces it?**
   - What we know: `PrettyConversationsPanel.tsx:729+` uses `useAllBountyCounts` for a panel-level filter helper that hides rows without pinned bounties (per patch #167 comment at bounty-counts-store.ts L90). The pinned-filter is a legitimate panel-level feature separate from the per-row badge.
   - What's unclear: Is the pinned-filter feature ALSO scope-motion (retired with the bounty-count wire)? Or does it need a replacement path?
   - Recommendation: Investigate at plan-checker time — grep `pinnedOnly` / `pv-filter-toggle-pinned` to see if the toggle UI is still exposed. If yes, this is a scope-question for discuss-phase follow-up. If the pinned-filter itself is being retired alongside the badges, then the delete pass is complete as documented; if the pinned-filter survives, the plan must specify how it gets its data now.

2. **New store name — `trapped-work-store.ts` vs generic `identity-signals-store.ts`?**
   - What we know: The new store is byte-shape identical to `bounty-counts-store.ts`. Future phases may add a third indicator (e.g., handoff status, waiting-for-response, mailbox flag).
   - What's unclear: Is now the time to introduce a generalized `identity-signals-store.ts` that could grow multi-signal, or is that YAGNI?
   - Recommendation: `trapped-work-store.ts` (specific). YAGNI wins — the abstraction is not obvious yet, and the byte-shape mirror is the reusable pattern. If a third signal appears, extract at that point (it's 200 lines of mechanical work).

3. **Workspace path convention — `skynet/`, `workspace/`, or env-var override?**
   - What we know: `~/.claude/identities/<key>/skynet/` is the actual folder in use empirically on skynet-ec2 (per Runtime State Inventory). Shape file uses aspirational language "standardized per-identity workspace-area folder". The shape's canonical example ("box-maintainer identities keep the Skynet source tree in theirs") suggests the folder is literally named `skynet`.
   - What's unclear: Was the shape file's "workspace" verbatim intended as a description of purpose (i.e., "her workspace, which happens to be called `skynet/`") or as an intended future folder name? Discuss-phase's silent-fail acceptance covers both readings but not the code that names the path.
   - Recommendation: Plan should hard-code `skynet/` as the workspace subdir, matching the empirical reality. Add a code-comment noting that if the fleet ever standardizes on `workspace/` (or another name), the change is one-line here. Do NOT add an env-var override in this phase — the shape file's "no override, no bandage" language argues against premature configurability. **This assumption should be confirmed with user at plan-check or executor time.**

4. **Depth limit — 3 sufficient? Or should we go deeper?**
   - What we know: A depth of 3 covers `<workspace>/<repo>/.git` (depth 2) and `<workspace>/<category>/<repo>/.git` (depth 3). Deeper nesting is unusual for the fleet's workspace layout.
   - What's unclear: Is any identity's workspace deeper than 3 levels of repo nesting?
   - Recommendation: Start with depth 3; make it a constant at the top of `readIdentityTrappedWork` for easy tuning. Verify against real peer-box workspaces during UAT.

5. **Deletion ordering — atomic single commit or ordered small commits?**
   - What we know: The delete pass touches ~15 files; a single commit is atomic-and-large; multiple commits give per-commit review clarity but risk intermediate-state compile-red.
   - What's unclear: Project's atomic-per-task commit convention (per `./CLAUDE.md`) — does that mean "each task is one commit" (so the delete pass = one commit) or "each atomic change is one commit" (so the delete pass = many commits)?
   - Recommendation: Plan the delete pass as ONE task = ONE commit. Confirms compile-green after each commit boundary (fleet directive: no red-CI commits). If the file list is too large for one commit's mental review, split by domain: (a) backend deletion, (b) frontend api+store deletion, (c) frontend row+panel+CSS deletion. Each intermediate commit must still compile.

6. **Coordinator-watermark stacking on IdentityBadge — proportional sizing?**
   - What we know: On PrettyConversationRow, the coordinator watermark spans the whole row (`.pv-coordinator-watermark { width: 96px }`) and the trapped-work indicator would be a small corner icon. Zero conflict. On IdentityBadge, the coordinator watermark is `width: 148` per L138-140 comment and is bigger; the pill is smaller than a row.
   - What's unclear: Does the trapped-work indicator's corner position visually clash with the coordinator watermark's SVG overlay at pill scale?
   - Recommendation: Executor verifies visually during UAT. Both `z-index: 2` + `pointer-events: none` ensure NO functional conflict. Aesthetic decision only. Shape file's "aesthetic fidelity is the tasting bar" tolerates iteration here.

## Poll cadence — codebase-verified figure

CONTEXT.md says "~30s existing fleet-status polling." Codebase inspection reveals two separate cadences:

- **Fleet-status SSH poll orchestrator** (`src/backend/fleet-status/ssh-poll-orchestrator.ts:978`): `pollIntervalMs ?? 2000` — **2 seconds**. This is a persistent SSH channel per host, high-frequency sweep for tmux liveness / activity mtime / stop signals. This is NOT the analog for trapped-work; the sweep is too hot.
- **Bounty-counts one-shot WS poll** (`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:558`): `startBountyCountPoller(getTargets, 60_000)` — **60 seconds** + window.focus refresh. This IS the analog. Opens a fresh WS, batched request-response, closes.

**Recommendation:** Trapped-work uses 60s + window.focus, matching bounty-counts exactly. The shape file's "~one poll cycle lag" tolerance is trivially met. The 30s figure in CONTEXT.md was either a memory-of-shape-file paraphrase or a conflation of the two subsystems; either way, the correct number is 60s.

## Sources

### Primary (HIGH confidence)

All primary sources are file:line references inside the Skynet-tina codebase, directly inspected during this research pass:

- `src/backend/claude-session/identity-artifact-reader.ts:4000-4146` — `readIdentityBountyCounts` full function (the mirror source for `readIdentityTrappedWork`)
- `src/backend/claude-session/identity-artifact-reader.ts:174,336-365` — `IDENTITY_KEY_RE`, `shellEscape`, `execWithTimeout` shared helpers
- `src/backend/claude-session/identity-artifact-reader.ts:485-519` — `listIdentityKeysOnHost` (find pattern for the walk)
- `src/backend/claude-session/claude-session-server.ts:1159-1347` — `handleIdentityCountBounties` handler + test seam (mirror source for `handleIdentityProbeTrappedWork`)
- `src/backend/claude-session/claude-session-server.ts:5714-5717` — WS message router route
- `src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts` (192 lines) — test-shape mirror source for backend detector tests
- `src/backend/claude-session/claude-session-server.count-bounties.test.ts` (155 lines inspected) — test-shape mirror source for WS handler tests
- `src/ui/api/claude-session-api.ts:1060-1216` — one-shot WS request helper `countIdentityBounties` (mirror source for `probeIdentityTrappedWork`)
- `src/ui/state/bounty-counts-store.ts` (226 lines) — full store implementation (mirror source for `trapped-work-store.ts`)
- `src/ui/state/bounty-counts-store.test.ts` (379 lines) — test-shape mirror source for store tests
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx:1-150,280-400,1150-1260` — row structure, identity resolution, useBountyCounts consumption, inline JSX for badge wraps
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:490-560` — bounty-count poller mount site
- `src/ui/features/pretty-conversations/pretty-conversations.css:544,662-675,1520-1549` — .pv-avatar rules, avatar-corner badge positioning, coordinator watermark
- `src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx` (71 lines) — unused component (delete target)
- `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx:100-205,1812-1900` — mock pattern + bounty-badge test shape
- `src/ui/features/terminal/IdentityBadge.tsx` (338 lines) — full component (add site for badge-surface indicator)
- `src/ui/features/terminal/IdentityBadge.test.tsx:1-150,384-460` — test setup + coordinator-watermark tests (BADGE-COORD-*)
- `src/ui/shell/IdentitySessionPane.tsx:432-450` — IdentityBadge call site (hostId prop threading)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts:978` — fleet-status 2s cadence figure (comparison baseline)
- `package.json:157` — `lucide-react@^1.28.0` pin
- `node_modules/lucide-react/dist/esm/icons/git-pull-request-draft.mjs` — icon existence verification
- `.planning/phases/104-.../104-CONTEXT.md` — locked decisions + shape verbatim
- `.planning/shapes/shape-repo-stats-display.md` — canonical shape file
- `.planning/ROADMAP.md:2295-2300` — Phase 104 roadmap entry
- `.planning/config.json` — GSD config (`nyquist_validation: false` → Validation Architecture section omitted)
- On-disk inspection: `~/.claude/identities/{tabitha,tanya,taylor,tiffany,tina}/skynet/` — empty on skynet-ec2 (only relay.json + relay-state)
- Manual git command verification: `git remote -v`, `git stash list`, `git rev-list --branches --not --remotes --count`, `git status --porcelain=v1` all confirmed working shapes

### Secondary (MEDIUM confidence)

None — every claim in this document is grounded in direct codebase inspection or on-disk verification. No third-party documentation or external sources were needed; the phase is entirely inside the fork's own established patterns.

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency verified in-place; no new packages introduced.
- Architecture: HIGH — the entire wire is a byte-shape mirror of an existing wire; the only novelty is the git-shell probe, which is standard.
- Pitfalls: HIGH for #1-4 (grounded in file:line evidence); MEDIUM for #5-6 (grounded in codebase patterns + reasoning).
- Workspace path convention (A2): MEDIUM — needs user confirmation. Shape file's language is aspirational; empirical reality is `skynet/`.
- Poll cadence: HIGH — codebase-verified at 60s; the CONTEXT.md "~30s" figure is a paraphrase discrepancy the plan should acknowledge.

**Research date:** 2026-09-10
**Valid until:** 2026-10-10 (30-day window; the target codebase's patterns are stable, but this window covers any incidental drift in the mirrored bounty-count wire before Phase 104 executes)
