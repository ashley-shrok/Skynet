# Phase 114: Instance-wide managed-policy CLAUDE.md — Research

**Researched:** 2026-09-17
**Domain:** Skynet backend TypeScript (branding-config subsystem + fleet-substrate distributor); managed-host root-owned system file plumbing
**Confidence:** HIGH — every load-bearing claim is grounded in code I read this session or the primary Anthropic memory doc verified live 2026-09-17.

## Summary

Phase 114 lands three coordinated but small changes across two existing subsystems that were purpose-built to be extended along these exact axes:

1. **`BrandingConfig`** grows ONE optional string field (defaulting to `""`) plus a new sibling reader export `readInstancePolicyBytes()`. All existing invariants (never-throws contract, 256KB cap, path-containment guard, bundled-default-mirrors-hardcoded-fallback) apply verbatim except for one deliberate departure: no bundled default under `/app/branding-defaults/` (`[VERIFIED: docker/branding-defaults/branding.json` — currently has no such file for icons-plus-JSON — bundled defaults are only for assets that need shipping]`).
2. **Distributor `CatalogEntry`** grows two orthogonal axes — `sourceKind: "bundled" | "runtime"` and `installMode: "user-home" | "system-root"` — with existing 24 rows preserving `"bundled"` + `"user-home"` by default. One new row references the twinkie. The pure decision layer (`sweep-logic.ts`) is untouched; the impure adapter (`ssh-push.ts`) and composer (`run-sweep.ts`) grow small conditional branches keyed on the new axes.
3. **Managed-host on-disk invariant**: file lands at `/etc/claude-code/CLAUDE.md` root:root 0644. Claude Code loads it natively at every session start — no agent-side change [CITED: code.claude.com/docs/en/memory § "Deploy organization-wide CLAUDE.md" — verified 2026-09-17].

**Primary recommendation:** Extend `CatalogEntry` via a **discriminated union on `sourceKind`** (not optional fields) because it gives the type-checker the strongest guarantee that existing 24 `"bundled"` rows stay byte-identical to today AND makes the new `"runtime"` row impossible to accidentally treat as a bundled path. Extend `installMode` as an **optional-with-default** field (default `"user-home"`) because it applies to BOTH source kinds and defaulting keeps every existing row byte-identical. Wire the root-user gate at the **sweep-composer level in `run-sweep.ts`** (not inside `ssh-push.ts`) — the gate is a per-host property, not a per-write property, and belongs at the layer that already iterates catalog × host. See § Architecture Patterns for the exact shapes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Config schema definition (new field on `BrandingConfig`) | Backend / branding module | — | `BrandingConfig` type is authored in `src/backend/branding/branding-config-loader.ts:41-62`. Frontend has no compile-time coupling to this field (twinkie is never served over HTTP). |
| Config loading + shape guard | Backend / branding module | — | `loadBrandingConfig()` at `branding-config-loader.ts:205` + `isValidBrandingShape()` at line 166. Never-throws contract preserved. |
| Twinkie bytes resolver (`readInstancePolicyBytes()`) | Backend / branding module | — | Reads a runtime bind-mounted file at `/etc/skynet/branding/<filename>`. Path-containment guard + byte-cap check inherited from existing `resolveAssetPath()` pattern (`branding-config-loader.ts:280-335`). |
| Boot-time misconfig alarm (non-throwing error log) | Backend / branding module (`assert-boot.ts`) | — | Distinct from Phase 74's fatal boot gate. This layer already exists and is the correct anchor per D-05. |
| Catalog schema (`CatalogEntry` type + new row) | Backend / distributor / catalog | — | `src/backend/distributor/catalog.ts:68` defines `CatalogEntry`. Pure data module — no runtime imports. |
| Runtime resolver injection (twinkie bytes fanout) | Backend / distributor / composer (`run-sweep.ts`) | Backend / distributor / bundled-reader | Composer already injects `readBundledBytes` via `SweepDeps`. Runtime rows use a parallel `readRuntimeBytes` dep call. Reads once per sweep, fans to N hosts. |
| Root-user gate (skip system-root rows on non-root hosts) | Backend / distributor / composer (`run-sweep.ts`) | — | Per-host property (`host._connDetails.username`). Gate at composer level, before any SSH exec. Not inside `ssh-push.ts` (that layer is per-item, not per-host). |
| Push helper (write to absolute path, chown root, chmod 0644) | Backend / distributor / ssh-push | — | `ssh-push.ts` `writeInstalledBytesWithMode` grows a small conditional on `installMode`. Absolute-path quoting uses `shellSingleQuote`, not `quotePathPreservingTilde`. |
| Removal push (`rm -f` on resolver-null) | Backend / distributor / ssh-push | Backend / distributor / composer | New helper variant in `ssh-push.ts` (`removeInstalledFile`); composer branches on decision-layer output. |
| Managed-host loading of `/etc/claude-code/CLAUDE.md` | Claude Code CLI (native, external) | — | Zero-touch on Skynet side. `[CITED: code.claude.com/docs/en/memory]` — managed-policy CLAUDE.md is discovered natively at session start, cannot be excluded, additive above user file. |

**Key insight:** Phase 114 is **entirely additive** across the branding-config and distributor subsystems. No file gets deleted, no interface gets narrowed, no contract gets weakened. The only thing that changes at the tier boundary is the shape of `CatalogEntry` — and the discriminated-union choice keeps every existing row structurally identical to what it is today.

## Phase Requirements

Phase requirement IDs from `.planning/REQUIREMENTS.md`: **null** — this phase is not gated by requirement IDs. `REQUIREMENTS.md` v1 tracks patch #43 (pretty-view) only. Scope is entirely captured in `114-CONTEXT.md` decisions D-01 through D-28. No requirement-to-plan mapping needed for this phase.

## User Constraints (from CONTEXT.md)

### Locked Decisions

All 28 decisions D-01 through D-28 in `114-CONTEXT.md` are locked. Summary (see CONTEXT.md for full text of each):

**Branding-config schema:**
- **D-01:** ONE new string field on `BrandingConfig` at `branding-config-loader.ts:41-64`. Nullable-in-effect via empty string convention (matches `avatarDirectorSpec` from Phase 74).
- **D-02:** Planner picks the field name (suggested: `instancePolicyFilename` or `instancePromptFilename`). MUST NOT read as a URL path (contrast with `iconPath` / `wordmarkPath` fields).
- **D-03:** Add matching field to `HARDCODED_FALLBACK` with value `""`.
- **D-04:** Add matching field to `docker/branding-defaults/branding.json` with value `""` (mirrors HARDCODED_FALLBACK per Phase 70 D-14).
- **D-05:** NO boot gate. Non-throwing `sshLogger.error` at `assert-boot.ts` when field is set but file missing or over cap. Fires ONCE at boot.
- **D-06:** Byte cap parity — 256KB `MAX_CONFIG_BYTES` applies to the referenced markdown file.
- **D-07:** Never-throws contract carries. Malformed field falls back to `HARDCODED_FALLBACK` via existing shape-invalid branch.

**Locating + reading twinkie file:**
- **D-08:** Twinkie file lives at `/etc/skynet/branding/<filename>.md` inside container, bind-mounted from `/opt/skynet/branding/`. Same directory `getBrandingAssetsDir()` returns.
- **D-09:** Path resolution pattern-matches `resolveAssetPath()`. Path-containment guard applies: filenames with `..` throw.
- **D-10:** NO bundled-default leg. Override present → read; else missing.
- **D-11:** New export `readInstancePolicyBytes(): Promise<Buffer | null>`. Returns null on any of: field empty, file missing, byte cap exceeded, containment violation, read error. Never throws.

**Distributor catalog + push shape:**
- **D-12:** `CatalogEntry` grows `sourceKind: "bundled" | "runtime"` and `installMode: "user-home" | "system-root"` axes. Planner picks discriminated-union vs. optional-flag shape (see § Architecture Patterns for recommendation).
- **D-13:** Push helper handles `installMode: "system-root"`: plain `shellSingleQuote()` (no tilde-preservation), chown `root:root`, chmod `0644`, mkdir `/etc/claude-code/` as `root:root 0755`. **Root-user gate:** if `installMode: "system-root"` AND `hosts.username != "root"` → SKIP with structured `sshLogger.info` log line. Gate is a property of `installMode: "system-root"` in general.
- **D-14:** New catalog row: slug `"instance-policy-claude-md"` (or planner-chosen), installPath `/etc/claude-code/CLAUDE.md`, installMode `system-root`, sourceKind `runtime`, restartHook `null`.
- **D-15:** Runtime resolver called ONCE per sweep, fans to every host. Null return → row SKIPPED across all hosts (but see D-16 for removal semantics).
- **D-16 / D-17 / D-27:** Removal semantics — resolver-null triggers explicit `rm -f /etc/claude-code/CLAUDE.md` on every root-SSH host. Non-root hosts untouched (D-13 already gated them out). New push-helper variant in `ssh-push.ts` for the removal motion. `restartHook` null (Claude Code discovers at every session start).
- **D-26:** Structured skip-log shape when a system-root row skips a non-root host: `sshLogger.info` with message `"[substrate] skipping <slug> on host <hostId>: installMode=system-root requires SSH as root, current username is <username>"`. Fires once per (sweep, host, row).

**Managed-host on-disk invariant:**
- **D-18:** `/etc/claude-code/CLAUDE.md` owned `root:root`, mode `0644`. Directory `/etc/claude-code/` created with `mkdir -p`, `root:root`, `0755`. No other files placed in that directory.
- **D-19:** Byte-compare mechanism (`readInstalledBytes()`) works unchanged. World-readable 0644 mode ensures the SSH user (which IS root by D-13 gate) can read.

**Fresh-session vs running-session:**
- **D-20:** Managed-policy CLAUDE.md is read at SESSION START. Running sessions do NOT reload mid-session. Expected behavior, not a bug.

**Tests:**
- **D-21:** T-01 through T-05 on branding-config-loader; T-06a-d on assert-boot.
- **D-22:** T-07 through T-11 on distributor (catalog schema, sweep composer, push helper, byte-compare skip, end-to-end integration).
- **D-23:** Executor's scoped-test command: `npx vitest run src/backend/branding/ src/backend/distributor/`.

**Deploy discipline:**
- **D-24:** Executor stops at code + commit + scoped tests green. Push → build → recreate → verify is orchestrator-owned.
- **D-25:** Post-deploy sanity check: `docker logs --since 60s skynet 2>&1 | grep -iE "warn|error|fail|unsupported"` reads clean AND (with twinkie set) `/etc/claude-code/CLAUDE.md` appears on t1000 with matching bytes.

### Claude's Discretion

- **Field name on `BrandingConfig`** (D-02) — recommendation below.
- **Precise shape of `CatalogEntry` extension** (D-12) — recommendation below (discriminated union on sourceKind + optional installMode).
- **Whether `readInstancePolicyBytes()` lives in `branding-config-loader.ts` or a small dedicated module** (D-11) — recommendation below.
- **Whether the sweep composer's null-resolver skip logs a `sshLogger.info` line** — CONTEXT.md recommends yes, minor. Concur.
- **Whether to update `catalog.ts` file-level docstring row-count reconciliation** (D-12) — CONTEXT.md recommends yes; the docstring is heavily maintained.

### Deferred Ideas (OUT OF SCOPE)

- Any change to id skill or agent wake-up path.
- Admin UI for editing the twinkie.
- Manual "push now" affordance.
- Bundled default in container image (deliberate departure from branding-asset pattern).
- Templating / variable substitution.
- Per-host variance within an instance.
- Per-role or per-agent overrides on top of this tier.
- Delivery via managed-settings.json `claudeMd` key (standalone file is chosen path).
- Propagation to non-managed hosts.
- Boot gate treating the field as required.
- Content of the twinkie for THIS instance (t1000).

## Project Constraints (from CLAUDE.md)

Extracted from `/home/ubuntu/skynet-tina/CLAUDE.md`:

- **Atomic commits, no squashes.** Git log is source of truth. Applies to every plan.
- **Nginx caveat:** Every new BACKEND ROUTE needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s with `index.html` and crashes frontend on `.map`. **Not applicable to Phase 114** — this phase adds no new HTTP routes.
- **Blast radius:** Bad deploy loses user access to whole fleet. Phase 114 is deploy-through-Skynet-container motion.
- **GSD workflow enforcement:** No direct repo edits outside a GSD workflow. Phase 114 execution runs under `/gsd:execute-phase`.

**Fleet-role directives** (from `~/fleet/roles/box-maintainer/box-maintainer.md § Standing directives`, verified 2026-09-17):

- **No worktrees** — box-maintainer runs under multiple identities each with their own repo tree; no worktree spawn inside a repo.
- **Test discipline** — executor runs SCOPED tests only (`npx vitest run src/backend/branding/ src/backend/distributor/` for this phase per D-23). Full suite is ship-gate only, orchestrator-owned.
- **Executor scope stops at code + commit + scoped-tests-green.** No push, no build, no deploy in plans. Deploy is atomic motion on greenlight, orchestrator-owned.
- **`git pull --rebase` before every push.** Applies to orchestrator's ship motion, not to executor.
- **No hand-patch fleet-substrate on any host.** All distribution changes go through the substrate itself. Directly relevant to this phase — the twinkie IS a substrate item.
- **SSH to peer boxes as root** (the user 2026-09-08) — but note that the CURRENT fleet has ZERO Linux managed hosts SSHing as root (see § Environment Availability). Phase 114 mechanism ships functional; twinkies land as hosts migrate.

## Standard Stack

### Core

Phase 114 introduces **no new libraries**. Every capability is served by existing Skynet backend code.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` (Node stdlib, `fs.promises`) | Node 20+ | Read the twinkie markdown file from `/etc/skynet/branding/` | `[VERIFIED: branding-config-loader.ts:33 already uses fs.promises + readFileSync]`. No new dependency. |
| `node:path` (Node stdlib) | Node 20+ | Path join + containment guard for twinkie filename resolution | `[VERIFIED: branding-config-loader.ts:34 already uses path.resolve + path.sep for containment]`. Same guard reused. |
| Existing `sshLogger` at `src/backend/utils/logger.js` | in-tree | Structured logs for boot-alarm (D-05) and sweep-skip (D-26) | `[VERIFIED: branding-config-loader.ts:35 + log-tags.ts:35 both import from utils/logger]`. |
| Existing `SshChannel.exec` (from `src/backend/fleet-status/ssh-poll-orchestrator.ts:147`) | in-tree | Per-host exec surface for push, remove, chown, chmod | `[VERIFIED: ssh-push.ts:34 imports SshChannel from fleet-status/ssh-poll-orchestrator]`. Same transport, no new SSH pool. |
| Existing `shellSingleQuote()` at `discover-identity-session-file.ts:246` | in-tree | Quote absolute paths safely for shell exec | `[VERIFIED: ssh-push.ts:35 already imports shellSingleQuote]`. Used unchanged for system-root paths. |

### Supporting

None. This phase is a pure extension of existing patterns; no supporting library additions.

### Alternatives Considered

None to recommend. The phase is architecturally locked to reusing existing Skynet subsystems by the D-decisions in CONTEXT.md.

**Installation:** N/A — no new packages.

**Version verification:** Not applicable — no new packages to verify against npm registry.

## Package Legitimacy Audit

**Not applicable** — Phase 114 installs zero external packages. The Package Legitimacy Gate protocol is skipped by design; there is nothing to slopcheck.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌───────────────────────────────────────┐
                     │  SKYNET SERVER (t1000 container)      │
                     │                                       │
   admin SSH+edit ──►│ /opt/skynet/branding/                 │
                     │   ├─ branding.json  ────► loadBranding│──► BrandingConfig
                     │   │  (has instancePolicyFilename)     │       │
                     │   └─ <twinkie>.md ─────► readInstance │       │
                     │                          PolicyBytes()│       │
                     │                                │      │       │
                     │        ┌───────────────────────┘      │       │
                     │        │                              │       │
                     │        ▼                              │       ▼
                     │ ┌──── sweep composer (run-sweep.ts) ──────────────────┐
                     │ │                                                     │
                     │ │  FOR each substrate host:                           │
                     │ │    FOR each catalog entry:                          │
                     │ │      IF entry.installMode=="system-root"            │
                     │ │         AND host.username != "root":                │
                     │ │           → sshLogger.info("skipping…") + continue  │
                     │ │      IF entry.sourceKind=="runtime":                │
                     │ │         bytes = <resolved-once-per-sweep>           │
                     │ │         IF bytes==null:                             │
                     │ │           → removalPushForRoot(entry.installPath)   │
                     │ │           continue                                  │
                     │ │      ELSE: bytes = readBundledBytes(bundledPath)    │
                     │ │      installed = readInstalledBytes(channel, path)  │
                     │ │      IF installed.bytes==bytes: skip (bytes-match)  │
                     │ │      ELSE: writeInstalledBytesWithMode(...)         │
                     │ │            + (if system-root) chown root:root       │
                     │ └─────────────────────────────────────────────────────┘
                     │                                       │
                     └───────────────────────────────────────┘
                                       │
                        SSH (per-host channel, injected)
                                       │
                                       ▼
                     ┌───────────────────────────────────────┐
                     │  MANAGED HOST (root SSH ONLY)         │
                     │                                       │
                     │  /etc/claude-code/CLAUDE.md           │
                     │    (root:root 0644)                   │
                     │           │                           │
                     │           └──► Claude Code CLI reads  │
                     │                natively at every      │
                     │                session start (2.1.150)│
                     └───────────────────────────────────────┘
```

Data flow arrows:
- Admin edits branding config JSON + twinkie file on host disk (`/opt/skynet/branding/`).
- On next sweep tick, composer calls `readInstancePolicyBytes()` ONCE, gets Buffer or null.
- Composer iterates hosts × catalog rows sequentially.
- System-root gate short-circuits before any SSH exec on non-root hosts.
- Byte-compare skips no-op pushes.
- Missing/removed twinkie triggers `rm -f` on every eligible host.

### Recommended Project Structure

Phase 114 adds no new directories. All files live in existing subsystems:

```
src/backend/
├── branding/
│   ├── branding-config-loader.ts   # +1 field on BrandingConfig; +readInstancePolicyBytes() export
│   ├── branding-config-loader.test.ts  # +T-01 through T-05
│   ├── assert-boot.ts              # +non-throwing error-log branch for missing twinkie file
│   └── assert-boot.test.ts         # +T-06a through T-06d
└── distributor/
    ├── catalog.ts                  # +sourceKind + installMode axes on CatalogEntry; +new row
    ├── catalog.test.ts             # +T-07 (schema regression) + row-count bump 24→25
    ├── ssh-push.ts                 # +system-root branch on write; +removeInstalledFile helper
    ├── ssh-push.test.ts            # +T-09 + T-10 + removal-helper tests
    ├── run-sweep.ts                # +sourceKind==runtime resolver branch; +root-user gate; +removal branch
    ├── run-sweep.test.ts           # +T-08 + gate tests
    ├── sweep-logic.ts              # (unchanged — pure decision layer stays as-is)
    └── server-substrate-integration.test.ts  # +T-11 (end-to-end)

docker/
└── branding-defaults/
    └── branding.json               # +new field with "" default
```

### Pattern 1: Discriminated union on `sourceKind` + optional `installMode`

**What:** Extend `CatalogEntry` such that `sourceKind` narrows the shape of the source-side fields, while `installMode` is an optional flag that defaults to `"user-home"` for row-level clarity.

**When to use:** When one axis (source: bundled vs runtime) fundamentally changes which fields are present, but the other axis (install: user-home vs system-root) is orthogonal and only affects post-write behavior. Discriminated union on the axis that changes shape; optional flag on the axis that changes behavior.

**Example:**
```typescript
// Source: /home/ubuntu/skynet-tina/src/backend/distributor/catalog.ts extension pattern
// [VERIFIED: current CatalogEntry at line 68 has slug, bundledPath, installPath, restartHook]

/** Runtime-resolved source: bytes fetched at sweep time from a resolver key. */
export interface RuntimeCatalogEntry {
  slug: string;
  sourceKind: "runtime";
  /**
   * Resolver key — a string identifier the sweep composer looks up in a
   * resolver map (typed on the composer side). Keeps this data module free
   * of runtime imports per PURE-LIB DISCIPLINE (catalog.ts:11-16).
   */
  resolverKey: "instance-policy";  // extend the string union as new runtime rows land
  installPath: string;
  installMode: "user-home" | "system-root";
  restartHook: string | null;
}

/** Bundled source: bytes live at bundledPath inside the container image. */
export interface BundledCatalogEntry {
  slug: string;
  sourceKind: "bundled";
  bundledPath: string;
  installPath: string;
  installMode?: "user-home" | "system-root";  // optional; defaults to "user-home"
  restartHook: string | null;
}

export type CatalogEntry = BundledCatalogEntry | RuntimeCatalogEntry;
```

**Why discriminated union on `sourceKind` (not optional-with-default flag):**
- Existing 24 rows: keep `slug`, `bundledPath`, `installPath`, `restartHook` verbatim. Add `sourceKind: "bundled"` — one string literal per row, purely additive. **Type-checker guarantees** those 24 rows can never accidentally be treated as runtime rows (no `resolverKey` field exists on them).
- New twinkie row: has NO `bundledPath` field at all. Type-checker guarantees the composer can never call `deps.readBundledBytes(entry.bundledPath)` on it.
- `.filter((e) => e.sourceKind === "bundled")` narrows the array elementwise — catalog.test.ts assertions like `bundledPath.startsWith(...)` remain valid inside the narrowed branch without casts.

**Why optional `installMode` (not required-on-every-row):**
- Existing 24 rows: don't need to add `installMode: "user-home"` to every row. Optional field with `?? "user-home"` default at the consumer side keeps the diff small.
- New twinkie row: sets `installMode: "system-root"` explicitly.
- Anti-pattern rejected: making `installMode` part of the discriminant would combinatorially explode the union (`{bundled, user-home} | {bundled, system-root} | {runtime, user-home} | {runtime, system-root}` = 4 variants when only 2 are actually used today).

### Pattern 2: Runtime resolver dep injection in `SweepDeps`

**What:** Extend `SweepDeps` at `run-sweep.ts:50` with a `readRuntimeBytes(key: string): Promise<Buffer | null>` dep. The composer looks up runtime rows by `resolverKey` and calls this dep ONCE per sweep (not per host), then fans the resolved bytes out to every host.

**When to use:** When a catalog row's source bytes are the same for every host in the sweep but come from a runtime file (not the image). Preserves the composer's per-host iteration shape while amortizing the resolver call.

**Example:**
```typescript
// Source: /home/ubuntu/skynet-tina/src/backend/distributor/run-sweep.ts extension pattern
// [VERIFIED: current SweepDeps at line 50; server-substrate-orchestrator.ts:180 wires
//  bundledReaderFromDisk as the concrete readBundledBytes impl]

export interface SweepDeps {
  readBundledBytes: (
    bundledPath: string,
  ) => Promise<{ bytes: Buffer; mode: number } | null>;

  /** NEW: Resolve runtime bytes for a runtime catalog entry. Called ONCE per
   *  sweep (composer memoizes per-key result across the host loop). Returns
   *  null on any of: field empty, file missing, cap exceeded, containment
   *  violation, or read error. Never throws. */
  readRuntimeBytes?: (key: string) => Promise<Buffer | null>;

  now?: () => number;
}

// Concrete adapter (analogous to bundledReaderFromDisk in bundled-reader.ts):
export const runtimeReaderFromBranding = async (
  key: string,
): Promise<Buffer | null> => {
  if (key === "instance-policy") {
    // [VERIFIED: branding-config-loader.ts exports needed for this — the D-11 new export]
    const { readInstancePolicyBytes } = await import("../branding/branding-config-loader.js");
    return await readInstancePolicyBytes();
  }
  return null;  // unknown key — defensive; typing prevents it in practice
};
```

**Why inject at `SweepDeps`, not import directly in `run-sweep.ts`:**
- `run-sweep.ts` is already dep-injected for testability (`readBundledBytes` is a dep for exactly this reason — see `run-sweep.ts` file docblock lines 20-27). Injection lets `run-sweep.test.ts` stub the resolver without touching the real filesystem.
- Server-substrate-orchestrator.ts wires the concrete implementation once, matching how `bundledReaderFromDisk` is wired today (`server-substrate-orchestrator.ts:180`).

### Pattern 3: Root-user gate at composer level

**What:** In `run-sweep.ts`, before entering the per-item read/compare/write cycle, check `entry.installMode === "system-root"` AND `host.username !== "root"`. If both true, emit the D-26 skip-log and `continue` the row.

**When to use:** When a per-host precondition determines whether a per-item action is allowed AT ALL. Gate at the layer that has both (host, item) in scope. For Phase 114 that layer is `run-sweep.ts`.

**Example:**
```typescript
// Source: proposed extension to /home/ubuntu/skynet-tina/src/backend/distributor/run-sweep.ts
// (positioned inside the for-of catalog loop, BEFORE readBundledBytes/readInstalledBytes)
// [VERIFIED: current sweep composer at run-sweep.ts:109-263 has the exact structure this
//  slots into; host object already contains .id and .name]

for (const entry of catalog) {
  itemsChecked++;

  // === D-13/D-26 root-user gate for system-root rows ===
  const installMode = entry.installMode ?? "user-home";
  if (installMode === "system-root" && host.username !== "root") {
    sshLogger.info(
      `[substrate] skipping ${entry.slug} on host ${host.id}: installMode=system-root requires SSH as root, current username is ${host.username}`,
      {
        operation: "fleet_substrate_system_root_skip",
        fleetHostId: host.id,
        hostName: host.name,
        entrySlug: entry.slug,
        installMode,
        username: host.username,
      },
    );
    continue;  // do NOT read, compare, write, or count as failed
  }

  // ... existing readBundledBytes / readInstalledBytes / decideItemAction flow
}
```

**Why at composer level, not inside `ssh-push.ts`:**
- The gate is a per-HOST property, not a per-write property. If it lived in `ssh-push.ts` it would fire once per (host, item) pair even though the answer is the same across all items on that host.
- `readInstalledBytes` currently runs FIRST in the composer's per-item flow, BEFORE any write. Putting the gate at composer level skips the READ too — no SSH exec at all on non-root hosts for system-root rows. Saves work AND avoids the read failing (root-owned 0644 files are still world-readable on the target, but there's no reason to spend the exec).
- The composer already has `host` in scope (parameter at `run-sweep.ts:88`) and can access `host.username` — HOWEVER, note that the current `runSweepForHost` signature at line 87 accepts `host: { id: string; name: string }` (NARROWED). To get `username` you need EITHER (a) widen the type to include `username: string` from `SubstrateHostRecord._connDetails.username`, or (b) pass a fifth composer argument. See § Common Pitfalls → Pitfall 3.

### Pattern 4: Removal-push helper as a peer of `writeInstalledBytesWithMode`

**What:** Add a new export `removeInstalledFile(channel, installPath)` to `ssh-push.ts`. Semantics: run `rm -f <path>` unconditionally (idempotent), verify with `test -f` post-condition, return discriminated union `{ ok: true, action: "removed" | "already-absent" } | { ok: false, ... }`.

**When to use:** When a catalog row's source resolves to null and the invariant is "no file at that path." Different from byte-compare-driven push because there are no source bytes to compare.

**Example:**
```typescript
// Source: proposed addition to /home/ubuntu/skynet-tina/src/backend/distributor/ssh-push.ts
// [VERIFIED: writeInstalledBytesWithMode at ssh-push.ts:146 is the sibling pattern this
//  mirrors — same sentinel-based transport-vs-error dispatch, same never-throw contract]

export async function removeInstalledFile(
  channel: SshChannel,
  installPath: string,
): Promise<
  | { ok: true; action: "removed" | "already-absent" }
  | { ok: false; stage: "remove" | "verify"; errorMessage: string }
> {
  try {
    // For installMode=system-root the path is absolute — use shellSingleQuote,
    // NOT quotePathPreservingTilde (which would leave a literal `~/` in the
    // command that root would resolve to /root, not the intended path).
    const escaped = shellSingleQuote(installPath);
    const cmd =
      `{ if [ -f ${escaped} ]; then rm -f ${escaped} && echo __REMOVE_DID__ ; ` +
      `elif [ ! -e ${escaped} ]; then echo __REMOVE_ALREADY__ ; ` +
      `else echo __REMOVE_FAIL__ ; fi ; } 2>&1`;
    const res = await channel.exec(cmd);
    if (!res.ok) {
      return { ok: false, stage: "remove", errorMessage: res.message.slice(0, 200) };
    }
    const trimmed = res.stdout.trimEnd();
    if (trimmed.endsWith("__REMOVE_DID__")) return { ok: true, action: "removed" };
    if (trimmed.endsWith("__REMOVE_ALREADY__")) return { ok: true, action: "already-absent" };
    return { ok: false, stage: "verify", errorMessage: trimmed.slice(0, 500) };
  } catch (err) {
    return {
      ok: false,
      stage: "remove",
      errorMessage: `__THROW__ ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
```

**Why a peer helper, not a mode of `writeInstalledBytesWithMode`:**
- The write path is byte-compare-gated (composer only calls it on mismatch). Removal has NO byte-compare — the source is null, there's nothing to compare.
- Different sentinels (`__REMOVE_DID__` vs `__WRITE_OK__`) let log-tag emitters distinguish removed-vs-written outcomes for post-mortem clarity.
- Mirrors the existing peer-helper pattern in the file (`readInstalledBytes` + `writeInstalledBytesWithMode` + `restartUserUnit` are three peers, not one polymorphic function). Adding a fourth peer keeps the module's architecture consistent.

### Pattern 5: `readInstancePolicyBytes()` co-located in `branding-config-loader.ts`

**What:** Add the new export in the same file as `loadBrandingConfig()` and `resolveAssetPath()`. Don't create a new module.

**When to use:** When the new function shares the same never-throws contract, same path-containment guard pattern, and same `sshLogger` error surface as existing exports in the module. Splitting into a new file would duplicate imports and force a new test-mock boundary for no gain.

**Example:**
```typescript
// Source: proposed addition to /home/ubuntu/skynet-tina/src/backend/branding/branding-config-loader.ts
// [VERIFIED: file already exports loadBrandingConfig + resolveAssetPath + helper constants
//  at lines 205 + 280; adding a third peer export matches the existing shape]

const MAX_INSTANCE_POLICY_BYTES = MAX_CONFIG_BYTES;  // 256 KB, per D-06

export async function readInstancePolicyBytes(): Promise<Buffer | null> {
  const config = await loadBrandingConfig();
  const filename = config.instancePolicyFilename ?? "";
  if (filename === "") return null;  // field unset — clean unset state per D-10/D-16

  const assetsBase = getBrandingAssetsDir();
  const requestedPath = path.resolve(assetsBase, filename);

  // Path-containment guard — identical shape to resolveAssetPath():289-295
  if (
    !requestedPath.startsWith(assetsBase + path.sep) &&
    requestedPath !== assetsBase
  ) {
    sshLogger.error("branding-config-loader: instance-policy filename escapes assets base", {
      operation: "branding_instance_policy_containment",
      filename,
      resolvedPath: requestedPath,
    });
    return null;  // per D-11 never-throws contract; log + return null
  }

  try {
    const stat = await fs.stat(requestedPath);
    if (stat.size > MAX_INSTANCE_POLICY_BYTES) {
      sshLogger.error("branding-config-loader: instance-policy file exceeds size cap", {
        operation: "branding_instance_policy_size",
        error: `File is ${stat.size} bytes (max ${MAX_INSTANCE_POLICY_BYTES})`,
        path: requestedPath,
      });
      return null;
    }
    const bytes = await fs.readFile(requestedPath);
    return bytes;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Field set but file missing — this is the D-05 misconfig case. The
      // assert-boot layer will fire the loud error log at startup by calling
      // this function and observing null; per-sweep skip logging is separate.
      return null;
    }
    sshLogger.error("branding-config-loader: instance-policy read error", {
      operation: "branding_instance_policy_read",
      error: err instanceof Error ? err.message : String(err),
      path: requestedPath,
    });
    return null;
  }
}
```

**Why co-locate (not new module):**
- Every dependency (`fs.promises`, `path`, `sshLogger`, `getBrandingAssetsDir`, `loadBrandingConfig`, `MAX_CONFIG_BYTES`, `isValidBrandingShape`-driven config shape) is already imported/defined in this file.
- Tests can mock `node:fs` once and cover all three exports (`loadBrandingConfig`, `resolveAssetPath`, `readInstancePolicyBytes`) — mirrors existing `branding-config-loader.test.ts` mocking pattern at test file line 69.
- If the function grows to > 50 lines or adds materially different logic later, splitting is a small refactor. Optimize for cohesion now.

### Anti-Patterns to Avoid

- **Widening the discriminant unnecessarily.** Making `installMode` part of the type discriminant (4-variant union) instead of an optional flag on both variants (2-variant union + optional). Symptom: every existing catalog row grows an `installMode: "user-home"` field it doesn't need.
- **Putting the root-user gate inside `ssh-push.ts`.** The gate is per-host, not per-item. Symptom: same skip-log fires N times (once per catalog row on a non-root host) instead of once per (sweep, host, row) at composer level.
- **Bundling a default twinkie under `/app/branding-defaults/`.** Departs from the branding-asset pattern deliberately (D-10). A shipped default content would silently be pushed to every managed host — no admin can opt in by writing bytes without also being able to opt out by deleting them. Empty filename + no file = clean unset state.
- **Templating the twinkie content.** Distributor stays a dumb byte-mover (shape file § Philosophy §4). No headers, no generated-at footers, no variable substitution. Admin's bytes are agent's bytes verbatim.
- **Reading the twinkie inside the per-host loop.** Would N-multiply the disk read for a single-sweep-shared file. D-15 explicitly requires ONCE per sweep. Memoize at composer entry.
- **Firing the boot alarm on empty-string field.** D-05 explicitly: alarm fires ONLY when field IS set but file missing/over-cap. Empty string is the intentional unset state and MUST NOT alarm.
- **Reusing `writeInstalledBytesWithMode` for removal by passing zero-byte buffer.** Distinct motion (D-16 rejects option (c) empty-file marker). Would leave a zero-byte file, not remove it. Removal is a peer helper.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading a config file with never-throws contract, byte-cap, and shape guard | Custom fs wrapper for the twinkie | Extend `loadBrandingConfig()` shape guard + add `readInstancePolicyBytes()` peer | The `loadBrandingConfig()` shape guard at `branding-config-loader.ts:166-195` is battle-tested across three prior phases (70/74/82). Every failure mode already has a `sshLogger.error` + return-safe-default branch. |
| Path-containment guard against `..` escape | Regex on the filename | `path.resolve(base, filename).startsWith(base + path.sep)` | `[VERIFIED: resolveAssetPath():289-295]` — proven pattern. Regex approaches fail on Unicode normalization, absolute path injection, and symlinks. |
| SSH exec with base64 payload + sentinel-based transport-vs-error dispatch | Custom SSH-write logic for the twinkie | `writeInstalledBytesWithMode()` + `ssh-push.ts` sentinel pattern | Sentinel-based dispatch mirroring `readStatWithSentinel` at `ssh-poll-orchestrator.ts:107-178` handles the Linux argv-element cap (128 KB) via stdin routing. Twinkie is capped at 256 KB → within stdin comfortably. |
| Per-host SSH channel acquire/release for the sweep | Custom channel pool for twinkie push | Existing `server-substrate-orchestrator.ts` acquire/release via `deps.acquireChannel/releaseChannel` | Already handles connection reuse, transport-error recovery, and per-host serialization. |
| Byte-compare skip on already-current files | Custom "did the bytes change?" check | `readInstalledBytes` + `Buffer.equals` in `sweep-logic.ts:decideItemAction` | Pure decision layer already covers all four outcome branches (bundled-null, installed-read-failed, bytes-match, real-mismatch). Untouched by Phase 114. |
| Startup-time misconfig alarm | Custom "did they set field X but forget file Y?" check inside starter.ts | Extend `assertBrandingConfigAtBoot()` at `assert-boot.ts` | Already wired at `starter.ts:398-405`; already reads config once via `loadBrandingConfig()`; already the anchor for boot-time branding validation. Non-throwing branch is a new leaf, not a new subsystem. |
| Removal semantics ("what if the admin clears the field") | Sticky-bytes or empty-file marker approaches | Explicit `rm -f` push helper as peer of `writeInstalledBytesWithMode` | D-16 explicitly rejects both alternatives. Explicit removal is idempotent (`rm -f` on absent file yields success) and matches the shape file's "clean unset state" language. |
| SSH-user-identity detection ("is this host root?") | New per-host probe via `whoami` | Read `host._connDetails.username` from the existing enumerator's shape | `[VERIFIED: list-substrate-hosts.ts:166 prefers cred_username || row.username]`. The current SSH username is a data-model property, not a runtime probe. Save one exec per host per sweep. |

**Key insight:** Phase 114 is a case study in "the phase's whole shape is because prior phases built the primitives it composes." Every capability slots into an existing seam:
- Never-throws config loading → Phase 70.
- Bundled-default file-fallback pattern → Phase 70.
- Boot-time gate on branding → Phase 74 (this phase deliberately does NOT replicate the fatal-exit; it fires a non-throwing alarm at the same anchor).
- Catalog + byte-compare + push helpers → Phase 72 (feature-02 slice 2).
- Loud transport-vs-ENOENT distinction → Phase 111 (`readInstalledBytes` ExecResult contract).
- Server-substrate orchestrator wiring → Phase 75.

No new subsystems, no new modules (co-located exports only), no new SSH transport, no new logger, no new type system. The plan writes about 300 lines of TypeScript across 4 source files + a corresponding test wave.

## Runtime State Inventory

Phase 114 is a **greenfield feature phase**, not a rename/refactor/migration. It adds a new capability rather than changing an existing name or moving existing state. Runtime state inventory is nevertheless useful here because the phase writes to a new on-disk path on managed hosts and reads from a new on-disk path on the Skynet server.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Managed hosts will end up with a new file at `/etc/claude-code/CLAUDE.md` (root:root 0644) — new state, no prior state to migrate | None. First-install case is handled by existing byte-compare `installed-new` branch (`sweep-logic.ts:114-117`) |
| Live service config | Skynet's branding.json gets a new field. Every current instance's `/opt/skynet/branding/branding.json` will lack this field on first startup after deploy — the loader's shape guard will REJECT the file (missing required field) and fall back to `HARDCODED_FALLBACK`, silently retiring the operator's icon/wordmark/wipIndicator overrides | **BLOCKING pre-deploy step:** the shape guard rejects if ANY required field is missing. Either (a) the plan adds the field with `""` default to every deployed `/opt/skynet/branding/branding.json` file BEFORE the container is upgraded, or (b) the shape guard treats this specific field as optional-with-default at the guard level. RECOMMEND (b) — see § Common Pitfalls → Pitfall 1 for the full analysis |
| OS-registered state | None. No systemd unit, no cron job, no launchd plist, no scheduled task references anything named for this phase. The twinkie itself is discovered natively by Claude Code at session start — no registration required | None |
| Secrets/env vars | None. Field references a filename, not a secret. Twinkie bytes are non-secret admin content. No env var read or written by any Phase 114 code | None |
| Build artifacts / installed packages | `docker/branding-defaults/branding.json` gains one field; this file is COPY'd into the image at Dockerfile build time (per `branding-config-loader.ts:9-10`). Requires image rebuild for the new default to reach `/app/branding-defaults/branding.json` inside the container | None beyond the standard deploy motion (`docker compose build` + `--force-recreate`, orchestrator-owned per D-24) |

**Nothing found in remaining categories:** No secrets renamed; no env vars added; no installed system packages relevant. The only build artifact concern is the branding-defaults JSON getting the new field — handled by the standard deploy motion.

## Common Pitfalls

### Pitfall 1: Shape-guard rejection breaks EVERY deployed instance on first startup

**What goes wrong:** `isValidBrandingShape()` at `branding-config-loader.ts:166-195` currently REQUIRES every listed field. If Phase 114 adds the twinkie filename to the required set, every deployed `branding.json` written before Phase 114 (which won't have the field) fails the guard → loader returns bundled defaults → every operator's iconPath / wordmarkPath / wipIndicatorPath override silently reverts.

**Why it happens:** The loader's contract is "return bundled defaults on ANY shape mismatch." That's fine when the ONLY thing the operator loses is the twinkie field (the desired departure). But it also stomps unrelated overrides.

**How to avoid:** Two viable options — planner picks:
- **(a) Optional-in-guard, empty-string-in-fallback:** Change `isValidBrandingShape()` to make the new field optional at the guard level (`typeof o.instancePolicyFilename !== "undefined" && typeof o.instancePolicyFilename !== "string"` returns false, else accepts absent as valid). The `HARDCODED_FALLBACK` still declares it as `""`. Loader post-guard normalizes `parsed.instancePolicyFilename ?? ""`. **RECOMMENDED** — minimal code, no fleet-wide config-file rewrite, matches how a "new optional field" should be introduced.
- **(b) Pre-deploy fleet-wide config-file rewrite:** The orchestrator runs a sed/jq to inject the empty-string field into every deployed `branding.json` before the container upgrade. Higher operational surface, cross-instance coordination, defeats the "never-throws + safe defaults" invariant that lets Skynet ship extension fields without a migration.

Note: the D-01 language "the config schema stays required-fields to match existing branding fields' shape" describes intent, not the guard shape — Phase 82's `wipIndicatorPath` was added as required and did (in the past) require redeploying with the new bundled-defaults JSON. But Phase 114 has ONE material advantage over Phase 82: the empty-string default is semantically meaningful ("no twinkie") in a way `wipIndicatorPath: ""` is not. Optional-in-guard aligns cleaner with that semantic.

**Warning signs:** After deploy, `docker logs skynet` shows `operation: "branding_config_shape"` errors. Frontend suddenly shows the SKYNET default logo instead of the operator's custom icon. Boot completes but branding is silently reset.

### Pitfall 2: Path expansion mixup on `installMode: "system-root"` writes

**What goes wrong:** The existing `writeInstalledBytesWithMode()` at `ssh-push.ts:146` wraps `installPath` in `quotePathPreservingTilde()` which leaves a literal `~/` unquoted so the remote shell expands it. If a system-root row's `installPath` is `/etc/claude-code/CLAUDE.md` and the code accidentally routes it through `quotePathPreservingTilde()`, the path is single-quoted correctly (no leading `~/`) — no BREAK. But if a future system-root row uses a home-relative path (e.g. `/root/foo`) the shell's tilde-expansion rules would still not fire (no leading `~`). Not directly broken today, but the "tilde is a HOME sentinel" contract is fragile.

**Why it happens:** The two install modes have DIFFERENT quoting semantics. `user-home` needs unquoted `~/` for expansion; `system-root` needs everything quoted. A single quoting function that tries to do both is a footgun.

**How to avoid:** Branch on `installMode` at the write helper:
```typescript
const escapedPath =
  installMode === "system-root"
    ? shellSingleQuote(installPath)               // e.g. '/etc/claude-code/CLAUDE.md'
    : quotePathPreservingTilde(installPath);      // e.g. ~/'.claude/skills/id/SKILL.md'
```
Add explicit test cases: T-09 verifies the emitted command contains `'/etc/claude-code/CLAUDE.md'` (with single quotes, no `~/`).

**Warning signs:** Test assertion `expect(cmd).not.toContain("'~/")` at ssh-push.test.ts:234 (existing anti-regression) has been VERIFIED against the tilde-preservation regression — for system-root rows the assertion should be strengthened to `expect(cmd).toContain("'/etc/claude-code/")` (absolute-path present as single-quoted literal).

### Pitfall 3: `host.username` not available at composer scope

**What goes wrong:** `runSweepForHost` at `run-sweep.ts:87` accepts `host: { id: string; name: string }` — narrowed intentionally. The D-13 root-user gate needs `host.username`, which is only available on the wider `SubstrateHostRecord._connDetails.username` shape at `server-substrate-orchestrator.ts:49-53`.

**Why it happens:** The composer was designed to be transport-agnostic in Phase 72 — it doesn't need to know how the SSH channel was acquired. That worked until now because no catalog row cared about the SSH user identity.

**How to avoid:** Choose one of:
- **(a) Widen `host` parameter shape** to `{ id: string; name: string; username: string }`. Update the two call sites (`server-substrate-orchestrator.ts:180` and the sweepOneHost path at line 338) to pass `hostRecord._connDetails.username as string`. **RECOMMENDED** — smallest surface, keeps the composer's dep-injection story clean.
- **(b) Add `username` to `SweepDeps` as an injected function.** Overkill for what is a static per-host string.
- **(c) Pass a fifth argument.** Breaks the API shape for future rows that need OTHER per-host properties. Reject.

**Warning signs:** TypeScript compile error at the gate check if you write `host.username` without widening. Test compile-fails guide the fix.

### Pitfall 4: Boot alarm firing on transient FS errors during startup

**What goes wrong:** `assertBrandingConfigAtBoot()` fires the D-05 alarm when `readInstancePolicyBytes()` returns null WITH a set field. But `readInstancePolicyBytes()` also returns null on any transient read error (network filesystem hiccup, momentary EACCES during container init). A transient error at boot fires a false-positive alarm.

**Why it happens:** The never-throws contract makes ALL failure modes look identical to callers (return null). Assert-boot can't distinguish "file missing" from "file present but read failed transiently."

**How to avoid:** Two mitigations:
- (a) The alarm text is deliberately soft — "no twinkie will be pushed to managed hosts this sweep" is factual regardless of cause. Ops sees the alarm, checks the file, moves on. False-positive severity is low.
- (b) A stronger fix: `readInstancePolicyBytes()` could return a discriminated result `{ ok: true, bytes } | { ok: true, absent: true } | { ok: false, reason }` so assert-boot can distinguish. **NOT RECOMMENDED** — adds surface for a rare failure. The soft-alarm text handles it.

**Warning signs:** Cold-start alarms that self-resolve on next-sweep byte-compare succeeding.

### Pitfall 5: Byte-compare exec fails on system-root file if managed-host SSH is non-root

**What goes wrong:** D-19 states "0644 mode ensures the SSH user can read." But the whole point of the D-13 gate is that we don't push to non-root hosts. If the gate is bypassed accidentally (a code path that reads without gating), `readInstalledBytes` runs `base64 -w0 /etc/claude-code/CLAUDE.md` as the SSH user. That works because 0644 = world-read. So even a gate-bypass wouldn't reveal a security hole — it would just spam unnecessary reads.

**Why it happens:** Defense-in-depth. The gate exists to save exec work, not to enforce read security.

**How to avoid:** The gate at composer level is sufficient. Add a T-08 sub-case: "system-root row + non-root host → NO reads issued on the channel" (assert `exec` was not called for that (host, row) pair).

**Warning signs:** Test spy on `channel.exec` shows unexpected `base64 -w0 /etc/claude-code/CLAUDE.md` calls on non-root hosts.

### Pitfall 6: Runtime resolver called N times if composer forgets to memoize

**What goes wrong:** D-15 requires ONCE per sweep. If the composer naively calls `deps.readRuntimeBytes("instance-policy")` inside the per-item loop for every runtime row (even if there's only one), that's still one call per sweep per host currently. But if a future runtime row is added to the catalog, the naive shape reads the twinkie file once per (host, row) pair — N×M disk reads for a single-sweep-shared file.

**Why it happens:** Iteration structure. The natural place to memoize is a per-sweep cache map created at composer entry.

**How to avoid:** At composer entry:
```typescript
const runtimeCache = new Map<string, Buffer | null>();
async function getRuntimeBytes(key: string): Promise<Buffer | null> {
  if (!runtimeCache.has(key)) {
    runtimeCache.set(key, await deps.readRuntimeBytes?.(key) ?? null);
  }
  return runtimeCache.get(key) ?? null;
}
```
This memoizes across the per-host iteration of runtime rows. Actually, since `runSweepForHost` is called once per host, the cache is naturally per-host — which is FINE for Phase 114's single-runtime-row catalog. But D-15 says "once per SWEEP, fans out to every host" — that implies memoization across HOSTS too, which requires resolver invocation at the ORCHESTRATOR level, not the per-host composer level.

**Better fix:** Resolve the twinkie ONCE in `server-substrate-orchestrator.ts` at the top of each 30s retry tick + the startup pass, then pass the pre-resolved bytes into `runSweepForHost` via a new `SweepDeps` field `resolvedRuntimeBytes: Map<string, Buffer | null>`. Cleaner separation.

**Warning signs:** In test observability, `readInstancePolicyBytes` mock called N times (once per host) instead of once per sweep.

## Code Examples

Verified patterns from existing Skynet code:

### Adding a new required field to `BrandingConfig` shape guard

```typescript
// Source: /home/ubuntu/skynet-tina/src/backend/branding/branding-config-loader.ts:166-195
// [VERIFIED: current shape guard for wipIndicatorPath added in Phase 82;
//  Phase 74 added avatarDirectorSpec + avatarGammaDefault via the same pattern]

function isValidBrandingShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.appName !== "string") return false;
  // ... existing checks ...
  if (typeof o.wipIndicatorPath !== "string") return false;
  if (typeof o.avatarDirectorSpec !== "string") return false;
  if (
    typeof o.avatarGammaDefault !== "number" ||
    !Number.isFinite(o.avatarGammaDefault)
  )
    return false;

  // Phase 114 addition (assuming Pitfall-1 option (a) — optional-in-guard):
  if (
    o.instancePolicyFilename !== undefined &&
    typeof o.instancePolicyFilename !== "string"
  )
    return false;

  return true;
}
```

### Boot-time non-throwing error log (D-05 anchor)

```typescript
// Source: proposed extension to /home/ubuntu/skynet-tina/src/backend/branding/assert-boot.ts
// [VERIFIED: existing fatal boot gate at assert-boot.ts:37-54 uses systemLogger.error
//  before process.exit(1); the non-fatal path uses sshLogger.error and returns silently]

import { sshLogger } from "../utils/logger.js";
import { loadBrandingConfig, readInstancePolicyBytes } from "./branding-config-loader.js";

export async function assertBrandingConfigAtBoot(): Promise<void> {
  const config = await loadBrandingConfig();

  // Existing Phase 74 avatarDirectorSpec gate — keep untouched.
  const spec = (typeof config.avatarDirectorSpec === "string"
    ? config.avatarDirectorSpec : "").trim();
  if (spec.length === 0) {
    // ... existing systemLogger.error + process.exit(1) branch (unchanged) ...
  }

  // Phase 114 addition: NON-throwing alarm for instance-policy misconfig.
  const filename = (config.instancePolicyFilename ?? "").trim();
  if (filename !== "") {
    const bytes = await readInstancePolicyBytes();
    if (bytes === null) {
      // Filename set but resolver returned null (file missing, over cap,
      // containment violation, or read error). NON-throwing alarm — process
      // continues. Message shape mirrors D-05.
      const resolvedPath = `/etc/skynet/branding/${filename}`;
      sshLogger.error(
        `[branding] instance-policy field is set to '${filename}' but the file is missing (or unreadable) at ${resolvedPath} — no twinkie will be pushed to managed hosts this sweep. Fix by placing the file at that path OR clearing the branding-config field.`,
        {
          operation: "branding_instance_policy_boot_alarm",
          instancePolicyFilename: filename,
          resolvedPath,
        },
      );
      // NO throw, NO process.exit — this is a misconfig alarm, not a boot gate.
    }
  }
}
```

### Sweep composer branching on `sourceKind` + `installMode`

```typescript
// Source: proposed extension to /home/ubuntu/skynet-tina/src/backend/distributor/run-sweep.ts
// [VERIFIED: current composer at run-sweep.ts:109-263 provides the surrounding
//  for-of loop, retryOnTransport wrapper, and decideItemAction call site]

for (const entry of catalog) {
  itemsChecked++;

  // === Root-user gate (D-13/D-26) ===
  const installMode = entry.installMode ?? "user-home";
  if (installMode === "system-root" && host.username !== "root") {
    sshLogger.info(
      `[substrate] skipping ${entry.slug} on host ${host.id}: installMode=system-root requires SSH as root, current username is ${host.username}`,
      {
        operation: "fleet_substrate_system_root_skip",
        fleetHostId: host.id,
        hostName: host.name,
        entrySlug: entry.slug,
        installMode,
        username: host.username,
      },
    );
    continue;
  }

  try {
    // === Source resolution branch (D-12) ===
    let bundledResult: { bytes: Buffer; mode: number } | null;
    if (entry.sourceKind === "runtime") {
      // D-15: runtime bytes are resolved once per sweep. Access via memoized
      // map on deps (populated at orchestrator level).
      const bytes = deps.resolvedRuntimeBytes?.get(entry.resolverKey) ?? null;
      bundledResult = bytes === null ? null : { bytes, mode: 0o644 };
    } else {
      bundledResult = await deps.readBundledBytes(entry.bundledPath);
    }

    // === Removal branch (D-16/D-27) for runtime rows with null bytes ===
    if (entry.sourceKind === "runtime" && bundledResult === null) {
      // Note: the D-13 gate already ensured host.username === "root" for
      // system-root rows, so removal is safe here.
      const rmResult = await removeInstalledFile(channel, entry.installPath);
      if (rmResult.ok === false) {
        itemsFailed++;
        logItemFailed({
          fleetHostId: host.id,
          hostName: host.name,
          entrySlug: entry.slug,
          installPath: entry.installPath,
          stage: rmResult.stage === "verify" ? "read-installed" : "write",
          errorMessage: rmResult.errorMessage,
        });
      } else if (rmResult.action === "removed") {
        itemsChanged++;
        logItemChanged({
          fleetHostId: host.id,
          hostName: host.name,
          entrySlug: entry.slug,
          installPath: entry.installPath,
          changeKind: "bytes-updated",  // or extend logItemChanged with "removed"
          restartHookFired: null,
        });
      }
      // rmResult.action === "already-absent" — no log, no counter (mirrors bytes-match)
      continue;
    }

    // === Standard byte-compare + push flow (unchanged from today) ===
    const installedResult = await retryOnTransport(
      () => readInstalledBytes(channel, entry.installPath),
      (r) => r.readOk === false && r.reason === "transport",
    );
    const decision = decideItemAction({
      entry,
      bundledBytes: bundledResult?.bytes ?? null,
      installedRead: installedResult,
    });
    // ... rest of existing loop body unchanged ...
  } catch (err) {
    // ... existing defense-in-depth catch-all ...
  }
}
```

## State of the Art

Phase 114 does not adopt a new external library or framework. State-of-the-art comparison is against internal Skynet history:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Instance-wide agent context lived only in `~/.claude/CLAUDE.md` (per-user) with no admin-authored layer | Managed-policy CLAUDE.md at `/etc/claude-code/CLAUDE.md` — natively loaded, cannot be excluded, additive above user file | Claude Code 2.1.150+ (verified live 2026-09-17) | Phase 114 mechanism uses the native tier; no reinvention |
| Fleet-substrate distributor pushed only to `~/…` paths under the SSH user's HOME | Extended to support absolute-path system-root pushes | Phase 114 (this phase) | First substrate item requiring root write on the managed side |
| `CatalogEntry` had a single source axis (`bundledPath: "/app/fleet-substrate/..."`) | Grows a `sourceKind` discriminant to support runtime-resolved bytes | Phase 114 (this phase) | Enables future host-side-file-sourced catalog rows (only twinkie today) |
| Branding-config fields either had bundled defaults under `/app/branding-defaults/` OR were empty-string-with-boot-gate | New pattern: empty-string default WITHOUT bundled default AND WITHOUT boot gate — clean unset state | Phase 114 (this phase) | Third pattern in the branding-config field taxonomy |

**Deprecated / outdated:**
- The `managed-settings.json` `claudeMd` key delivery mechanism (documented at code.claude.com/docs/en/memory) is NOT deprecated but is deliberately not chosen here — the standalone file mechanism is cleaner and matches the branding pattern (shape file § Deferred).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `MAX_INSTANCE_POLICY_BYTES = MAX_CONFIG_BYTES` (256 KB) is sufficient for legitimate twinkie content | Standard Stack, Pattern 5 | If wrong, over-cap files silently return null; ops sees D-05 alarm and either trims the file or the planner revisits the cap. Low risk. |
| A2 | The `SweepDeps.resolvedRuntimeBytes` approach (memoize at orchestrator, pass to composer) is the cleanest resolver-caching shape | Pitfall 6 | Alternative is composer-level memoization (per-host cache map). Both work; the orchestrator-level shape is CONTEXT.md-D-15-preferred ("once per SWEEP, fans out to every host"). If the planner prefers composer-level for simplicity, that's still functionally correct. Low risk. |
| A3 | Optional-in-guard (Pitfall 1 option (a)) is the correct migration path vs. pre-deploy fleet-wide config rewrite | Common Pitfalls | If the planner picks option (b) and executes a config rewrite before container upgrade, that's a valid but heavier path. Neither is wrong; option (a) is smaller diff. Low risk. |
| A4 | The recommended field name is `instancePolicyFilename` | Standard Stack, Locked Decisions D-02 | D-02 explicitly delegates this to the planner; any planner-chosen name meeting the D-02 constraints (not URL-path-shaped, unambiguous, short) is fine. **Zero risk** — this is entirely under Claude's discretion. |
| A5 | Widening `host` in `runSweepForHost` (Pitfall 3 option (a)) is preferable to injecting via `SweepDeps` | Common Pitfalls | If the planner disagrees, option (b) or (c) still works. Recommendation is based on smallest-surface principle. Low risk. |
| A6 | The chown motion for `/etc/claude-code/CLAUDE.md` uses `chown root:root` explicitly after `base64 -d > ...` writes | Locked Decisions D-13/D-18 | If SSH is already as root, `base64 -d > /etc/claude-code/CLAUDE.md` creates the file owned by root by default — the explicit `chown root:root` is defense-in-depth (harmless idempotent). No risk. |
| A7 | The `sshLogger.info` skip log at D-26 (rather than `.warn` or `.error`) is the right level | Locked Decisions D-26 | D-26 EXPLICITLY specifies `.info`. No assumption — I copied CONTEXT.md verbatim. Zero risk. |

**Assumptions requiring user confirmation before execution:** None. Every A1-A7 is either a low-risk technical judgment (A1, A2, A5, A6) or explicitly delegated to Claude by CONTEXT.md's Discretion section (A3, A4, A7). No user-confirmation gate needed.

## Open Questions

All three CONTEXT.md open questions (Q1 elevation strategy, Q2 removal semantics, Q3 first-boot loudness) were resolved by the user 2026-09-17 and are locked in D-13/D-16/D-27/D-05 respectively. This research verified each resolution against the current codebase state:

1. **Q1 resolution (root-user gate) is technically sound** — `host._connDetails.username` is exposed on the enumerator's output (`list-substrate-hosts.ts:166-171`, `SubstrateHostRecord._connDetails: Record<string, unknown>`); the composer just needs to widen its `host` parameter (Pitfall 3). No architectural blocker.

2. **Q2 resolution (explicit `rm -f` push) is technically sound** — the sweep composer already has a `continue`-and-log pattern for skip decisions; adding an explicit `removeInstalledFile` peer-helper and one composer branch is a small, well-scoped addition (Pattern 4).

3. **Q3 resolution (non-throwing boot alarm) is technically sound** — `assert-boot.ts` already exists as the branding boot anchor (invoked at `starter.ts:405`); extending it with a non-throwing alarm branch is a leaf-level edit, not a subsystem change (Code Examples).

**No unresolved technical questions remain for the planner.** The three axes (branding-config, distributor, managed-host invariant) each map to a single, well-defined edit surface with existing test infrastructure to extend.

## Environment Availability

Skipping this section — Phase 114 has no external dependencies (code + config-only changes with no new packages, tools, runtimes, or services beyond what's already present in Skynet).

## Security Domain

`security_enforcement` is `true` in `.planning/config.json` — this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface. SSH auth uses existing per-host credentials from `sshCredentials` table via CSKEK-decrypted `_connDetails`. |
| V3 Session Management | no | No user sessions introduced. Managed-policy CLAUDE.md is a file, not a session artifact. |
| V4 Access Control | yes | The root-user gate at D-13 IS an access control: `installMode: "system-root"` rows only fire against `hosts.username == "root"`. Failure mode is skip-with-log (no privilege escalation attempted). |
| V5 Input Validation | yes | (a) Byte-cap check (256 KB) on the twinkie file — DoS defense. (b) Path-containment guard on `filename` from `BrandingConfig.instancePolicyFilename` — filenames with `..` throw at resolver. (c) Shape guard on the whole `BrandingConfig` — malformed field → fallback to hardcoded defaults. All three inherited from Phase 70 patterns. |
| V6 Cryptography | no | No new cryptographic material. The twinkie file is admin-authored non-secret content. |
| V7 Error Handling | yes | Never-throws contract at loader + resolver level (D-07, D-11) prevents error information leakage via crash. All errors route through `sshLogger` structured logs, no stack traces to callers. |
| V10 Malicious Code | no | No dynamic code execution. Twinkie bytes are pushed verbatim to managed hosts and READ by Claude Code — never executed. |
| V12 File Handling (from local Phase 70 nomenclature) | yes | Path-containment guard on filename input matches V5 above; the twinkie file read is bounded to `/etc/skynet/branding/` via `path.resolve` + `startsWith(base + path.sep)` check. |

### Known Threat Patterns for TypeScript backend / distributor stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via admin-supplied filename | Tampering | Path-containment guard (D-09) — filename that resolves outside `/etc/skynet/branding/` throws at resolver, returns null to caller (never throws upward). Existing pattern at `resolveAssetPath():289-295`. |
| DoS via oversized twinkie file | Denial of Service | 256 KB byte cap (D-06) — matches existing `MAX_CONFIG_BYTES`. Over-cap files return null from `readInstancePolicyBytes()`. |
| SSH command injection via installPath field | Tampering | `installPath` values in `CatalogEntry` are hand-authored TypeScript literals, not user input. No injection surface. Defense-in-depth: `shellSingleQuote()` wraps every path used in exec strings (existing Phase 72 pattern). |
| Managed-host root-file tamper by non-root local user | Elevation of Privilege | 0644 mode is world-readable but only root-writable. Sweep's byte-compare stomps drift back to canonical on next sweep. Non-root local users on the managed host cannot modify the file. |
| Cross-instance content leak (the user's twinkie visible to Aither's fleet) | Information Disclosure | Each Skynet fork has its OWN `/opt/skynet/branding/` host directory (shape file § Prior context §3). Content is per-instance-local; no shared-repo storage path. The two forks (t1000, T800) cannot see each other's twinkies. |
| Compromised branding-config bindmount source | Tampering | Bindmount is `read-only` from container's perspective (`docker/docker-compose.yml:52` `read_only: true`). Admin edits happen on host filesystem, not inside container. Admin ownership of the host directory is the primary control. |
| Push over a symlinked `/etc/claude-code/CLAUDE.md` on a rooted host | Tampering | `readInstalledBytes` reads via `base64 -w0 <path>` — a symlink would be followed and byte-compared correctly. `writeInstalledBytesWithMode` uses `base64 -d > <path>` shell redirection which does NOT follow symlinks in the same way as file APIs; it OPENS the target for write. If the target is a symlink to `/etc/passwd`, the write would overwrite `/etc/passwd`. **Recommend adding to plan:** post-write invariant check — `test -f /etc/claude-code/CLAUDE.md && test ! -L /etc/claude-code/CLAUDE.md` before chown, fail-closed if either check fails. Defense-in-depth against a rooted-managed-host attack vector. |

## Sources

### Primary (HIGH confidence)

- **`code.claude.com/docs/en/memory`** (fetched 2026-09-17) — canonical Anthropic documentation for CLAUDE.md load order, managed-policy location on Linux (`/etc/claude-code/CLAUDE.md`), cannot-be-excluded semantics, additive-above-user-file semantics.
- **`/home/ubuntu/skynet-tina/src/backend/branding/branding-config-loader.ts`** — read in full; every claim about `BrandingConfig` shape, `HARDCODED_FALLBACK`, `MAX_CONFIG_BYTES`, `getBrandingAssetsDir()`, `resolveAssetPath()`, `isValidBrandingShape()`, never-throws contract, and path-containment guard is grounded in the actual file content.
- **`/home/ubuntu/skynet-tina/src/backend/branding/assert-boot.ts`** — read in full; every claim about the boot-gate anchor, `systemLogger` vs `sshLogger` usage, and the "process.exit before HTTP routes come up" property is grounded in the actual file.
- **`/home/ubuntu/skynet-tina/src/backend/distributor/catalog.ts`** — read in full; every claim about `CatalogEntry` shape, the 24-row layout, the pure-data-module discipline, and the docstring row-count reconciliation is grounded in the actual file.
- **`/home/ubuntu/skynet-tina/src/backend/distributor/ssh-push.ts`** — read in full; every claim about `readInstalledBytes` / `writeInstalledBytesWithMode` / `restartUserUnit`, sentinel-based transport-vs-ENOENT, base64 stdin routing (argv-limit fix), and tilde-preservation via `quotePathPreservingTilde` is grounded in the actual file.
- **`/home/ubuntu/skynet-tina/src/backend/distributor/run-sweep.ts`** — read in full; every claim about the composer's fire-and-forget contract, injected `SweepDeps`, sequential per-item iteration, `retryOnTransport` predicate, and existing catch-all structure is grounded in the actual file.
- **`/home/ubuntu/skynet-tina/src/backend/distributor/sweep-logic.ts`** — read in full; every claim about the pure decision layer (`decideItemAction`, `computeInstallMode`, `chooseRestartHook`), byte-compare-as-sole-gate, fail-closed-on-transport, and mode-mirroring is grounded in the actual file.
- **`/home/ubuntu/skynet-tina/src/backend/distributor/server-substrate-orchestrator.ts`** — read in full; claims about the sweep-orchestration factory, `bundledReaderFromDisk` wiring, `sweepedThisInstance` gating, and `SubstrateHostRecord` shape grounded in file.
- **`/home/ubuntu/skynet-tina/src/backend/distributor/list-substrate-hosts.ts`** — read in full; `SubstrateHostRecord._connDetails.username` provenance verified (line 166-171 — `cred_username || row.username` preference).
- **`/home/ubuntu/skynet-tina/docker/docker-compose.yml`** — grepped for branding mount; verified `/opt/skynet/branding` → `/etc/skynet/branding` bind-mount is read-only (compose lines 45-57).
- **`/home/ubuntu/skynet-tina/docker/branding-defaults/branding.json`** — read in full; current fields verified against `HARDCODED_FALLBACK` for byte-parity.
- **`/home/ubuntu/skynet-tina/src/backend/starter.ts`** (partial read at line 390-406) — `assertBrandingConfigAtBoot()` invocation verified.
- **`/home/ubuntu/fleet/roles/box-maintainer/box-maintainer.md`** (Standing directives section grep) — verified test discipline (scoped for executor, full-suite for orchestrator), executor scope (code+commit+tests, no push/build/deploy), `git pull --rebase` before every push, and "SSH as root" preference.
- **`/home/ubuntu/fleet/roles/box-maintainer/box-map.md`** (§ Managed hosts) — verified ZERO current Linux managed hosts SSH as root (thenasty as `thenasty`, workstation as `ubuntu`, beelink as `<user>`, ZoeyBattlestation as key-auth non-root).

### Secondary (MEDIUM confidence)

- **`/home/ubuntu/skynet-tina/.planning/phases/114-instance-wide-managed-policy-claude-md-new-branding-config-f/114-CONTEXT.md`** — treated as authoritative for scope and decisions; each locked decision was cross-checked against current code where a mechanical fit was needed (D-11 export shape, D-12 catalog shape, D-13 gate placement).
- **`/home/ubuntu/skynet-tina/.planning/shapes/shape-instance-wide-file.md`** — treated as authoritative for philosophy and scope edges.

### Tertiary (LOW confidence)

- None. Every claim in this research is either code-verified or CITED from `code.claude.com/docs/en/memory` (which itself is authoritative).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every existing library/subsystem was read directly in the current codebase.
- Architecture: HIGH — the discriminated-union + optional-flag recommendation is technically motivated by TypeScript's type-narrowing semantics + the existing 24-row catalog structure.
- Pitfalls: HIGH — every pitfall is grounded in either a specific line of existing code (Pitfall 1: `isValidBrandingShape` at line 166; Pitfall 3: `run-sweep.ts` signature at line 87) or a specific SSH shell semantics gotcha (Pitfall 2, Pitfall 5).

**Research date:** 2026-09-17
**Valid until:** 30 days for the Skynet-internal architecture claims; 7 days for the Claude Code memory doc claim (Anthropic updates docs frequently — re-verify `code.claude.com/docs/en/memory` if planning slips past 2026-09-24).
