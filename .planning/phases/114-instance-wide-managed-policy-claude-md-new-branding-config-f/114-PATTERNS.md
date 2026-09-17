# Phase 114: Instance-wide managed-policy CLAUDE.md — Pattern Map

**Mapped:** 2026-09-17
**Files analyzed:** 12 (7 source + 5 test/config)
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/branding/branding-config-loader.ts` | config-loader/service | file-I/O + transform | Self (existing exports — `resolveAssetPath()` at L280-335; Phase 82 wipIndicatorPath L48/L86/L184) | exact — additive on same module |
| `src/backend/branding/branding-config-loader.test.ts` | test | file-I/O mock | Self (Phase 74 shape-guard tests L1-200; `vi.mock("node:fs")` at L69-83) | exact |
| `src/backend/branding/assert-boot.ts` | boot-gate service | request-response (startup, one-shot) | Self (Phase 74 `assertBrandingConfigAtBoot()` L37-54 — this phase is DELIBERATE NON-REPLICATION of the throw) | exact analog with intentional divergence |
| `src/backend/branding/assert-boot.test.ts` | test | request-response mock | Self (Phase 74 gate tests L1-202; loader mock at L73-75) | exact |
| `docker/branding-defaults/branding.json` | config data | static | Self (existing file — must byte-mirror `HARDCODED_FALLBACK` per Phase 70 D-14) | exact |
| `src/backend/distributor/catalog.ts` | model/data | static (pure data module) | Self (existing `CatalogEntry` interface L68-97 + 24 rows) | exact — additive extension |
| `src/backend/distributor/catalog.test.ts` | test | static | Self (existing schema-invariant tests L34-205) | exact |
| `src/backend/distributor/ssh-push.ts` | transport helper/adapter | request-response (SSH exec, sentinel-parsed) | Self (`readInstalledBytes` L76-112 + `writeInstalledBytesWithMode` L146-213 — sibling peer helper for `removeInstalledFile`) | exact analog for new helper |
| `src/backend/distributor/ssh-push.test.ts` | test | request-response mock | Self (existing sentinel-parse tests L1-280; `makeChannel` at L31-38) | exact |
| `src/backend/distributor/run-sweep.ts` | composer/service | event-driven (per-sweep iteration) | Self (existing composer L87-276; `SweepDeps` at L50-56; catalog for-of loop L109-264) | exact — additive branches inside existing loop |
| `src/backend/distributor/run-sweep.test.ts` | test | event-driven mock | Self (`makeChannelSequenced` L60-73; `catalogEntry` factory L75-83) | exact |
| `src/backend/distributor/server-substrate-integration.test.ts` | integration test | end-to-end | Self (existing end-to-end integration harness) | exact |

## Pattern Assignments

### `src/backend/branding/branding-config-loader.ts` (config-loader / file-I/O)

**Analogs:** Phase 82 `wipIndicatorPath` (filename-shaped field) + Phase 74 `avatarDirectorSpec` (empty-string default) + existing `resolveAssetPath()` (containment guard + fallback).

**Imports pattern** (`branding-config-loader.ts:33-35`):
```typescript
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { sshLogger } from "../utils/logger.js";
```
Copy verbatim — every dep needed by `readInstancePolicyBytes()` is already imported here.

**BrandingConfig type extension pattern** (`branding-config-loader.ts:41-62`, note L47-48 wipIndicatorPath + L60-61 avatarDirectorSpec / avatarGammaDefault):
```typescript
export type BrandingConfig = {
  appName: string;
  // ...
  wipIndicatorPath: string;               // Phase 82: filename-shaped field
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
  avatarDirectorSpec: string;             // Phase 74: empty-string default convention
  avatarGammaDefault: number;
};
```
Add `instancePolicyFilename: string` inline as a required string, mirroring Phase 74's empty-string convention (per D-01). Do NOT suffix `Path` — D-02 says the field must not read as a URL path.

**HARDCODED_FALLBACK pattern** (`branding-config-loader.ts:78-98`, note L91-97 empty-string comment):
```typescript
const HARDCODED_FALLBACK: BrandingConfig = {
  appName: "SKYNET",
  // ...
  // Phase 74: avatarDirectorSpec MUST be empty string here (INTENTIONAL —
  // per 74-CONTEXT.md § "Tempting-but-no" §1 + 74-RESEARCH.md § Pitfall 1).
  avatarDirectorSpec: "",
  avatarGammaDefault: 0.7,
};
```
Add `instancePolicyFilename: ""` as the new empty-string default. Comment MUST cite Phase 114 D-03 + D-10 (no bundled default leg).

**Shape-guard pattern** (`branding-config-loader.ts:166-195`):
```typescript
function isValidBrandingShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.appName !== "string") return false;
  // ...
  if (typeof o.wipIndicatorPath !== "string") return false;
  if (typeof o.avatarDirectorSpec !== "string") return false;
  if (
    typeof o.avatarGammaDefault !== "number" ||
    !Number.isFinite(o.avatarGammaDefault)
  )
    return false;
  return true;
}
```
Two viable extension shapes (planner picks per RESEARCH.md Pitfall 1):
- **(a) Required, matches wipIndicatorPath:** `if (typeof o.instancePolicyFilename !== "string") return false;` — parallel to Phase 82. Existing deployed configs MUST have the field added before container upgrade.
- **(b) Optional-in-guard (RESEARCH RECOMMENDS):** `if (o.instancePolicyFilename !== undefined && typeof o.instancePolicyFilename !== "string") return false;` — accepts absent as valid. Loader normalizes `parsed.instancePolicyFilename ?? ""` post-guard. No fleet-wide config rewrite needed.

**Path-containment guard pattern** (`branding-config-loader.ts:280-335`, key lines 289-295):
```typescript
const overrideBase = getBrandingAssetsDir();
const overridePath = path.resolve(overrideBase, sanitized);
if (
  !overridePath.startsWith(overrideBase + path.sep) &&
  overridePath !== overrideBase
) {
  throw new Error("branding asset path escapes override base directory");
}
try {
  await fs.access(overridePath);
  return { path: overridePath, source: "override" };
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") { sshLogger.error(/* ... */); }
}
```
For `readInstancePolicyBytes()`: same `path.resolve` + `startsWith(base + path.sep)` guard, BUT per D-11 "never throws" contract, do NOT throw on escape — log `sshLogger.error` and `return null` instead (twinkie is called at sweep time, not at HTTP-route time, so no 400 surface exists).

**Byte-cap pattern** (`branding-config-loader.ts:70-73` + `205-218`):
```typescript
const MAX_CONFIG_BYTES = 256 * 1024;
// ...
const stat = await fs.stat(configPath);
if (stat.size > MAX_CONFIG_BYTES) {
  sshLogger.error("branding-config-loader: config file exceeds size cap", {
    operation: "branding_config_size",
    error: `Config file is ${stat.size} bytes (max ${MAX_CONFIG_BYTES}) — returning defaults`,
    path: configPath,
  });
  return getBundledDefaults();
}
```
For twinkie: reuse `MAX_CONFIG_BYTES` (256 KB) per D-06. Same `stat.size > cap` check; on over-cap emit `sshLogger.error` with `operation: "branding_instance_policy_size"` and `return null` (twinkie has NO bundled fallback).

**ENOENT-graceful read pattern** (`branding-config-loader.ts:220-232`):
```typescript
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    // Missing file is normal for deployments that don't override branding.
    return getBundledDefaults();
  }
  sshLogger.error("branding-config-loader: config file read error", {
    operation: "branding_config_read",
    error: err instanceof Error ? err.message : String(err),
    path: configPath,
  });
  return getBundledDefaults();
}
```
For twinkie: ENOENT is the misconfig alarm state (D-05) — return `null` silently (assert-boot will call and observe null to fire the alarm). Non-ENOENT: `sshLogger.error` with `operation: "branding_instance_policy_read"` then return null.

**Asset-dir helper** (`branding-config-loader.ts:111-113`):
```typescript
export function getBrandingAssetsDir(): string {
  return "/etc/skynet/branding";
}
```
Use unchanged — twinkie file lives here per D-08 (same bind-mount).

---

### `src/backend/branding/assert-boot.ts` (boot gate)

**Analog:** Phase 74's `assertBrandingConfigAtBoot()` — DELIBERATE NON-REPLICATION of the throw. Phase 74 exits process; Phase 114 emits non-throwing `sshLogger.error`.

**Existing fatal-gate pattern** (`assert-boot.ts:34-54`) — reference for what NOT to replicate for the twinkie:
```typescript
import { loadBrandingConfig } from "./branding-config-loader.js";
import { systemLogger } from "../utils/logger.js";

export async function assertBrandingConfigAtBoot(): Promise<void> {
  const config = await loadBrandingConfig();
  const spec = (
    typeof config.avatarDirectorSpec === "string" ? config.avatarDirectorSpec : ""
  ).trim();
  if (spec.length === 0) {
    systemLogger.error(
      "Fatal: branding.json is missing or has empty avatarDirectorSpec — refusing to boot",
      new Error("avatarDirectorSpec missing"),
      { operation: "branding_config_boot_gate" },
    );
    process.exit(1);
  }
}
```

**Phase 114 non-throwing alarm addition** (append after the existing gate, DO NOT modify the Phase 74 gate):
- Import `sshLogger` (Phase 74 uses `systemLogger` for fatal; Phase 114 uses `sshLogger` for non-fatal per D-05).
- Import `readInstancePolicyBytes` from `./branding-config-loader.js` (new export).
- Read the config once (or reuse the same `config` binding from the existing gate).
- If `config.instancePolicyFilename` is set (non-empty after trim) AND `readInstancePolicyBytes()` returns null → emit `sshLogger.error` with D-05 message shape, `operation: "branding_instance_policy_boot_alarm"`. NO `process.exit`, NO throw.

Concrete shape (per RESEARCH.md L676-707):
```typescript
const filename = (config.instancePolicyFilename ?? "").trim();
if (filename !== "") {
  const bytes = await readInstancePolicyBytes();
  if (bytes === null) {
    const resolvedPath = `/etc/skynet/branding/${filename}`;
    sshLogger.error(
      `[branding] instance-policy field is set to '${filename}' but the file is missing (or unreadable) at ${resolvedPath} — no twinkie will be pushed to managed hosts this sweep. Fix by placing the file at that path OR clearing the branding-config field.`,
      {
        operation: "branding_instance_policy_boot_alarm",
        instancePolicyFilename: filename,
        resolvedPath,
      },
    );
    // NO throw, NO process.exit — non-fatal alarm.
  }
}
```

---

### `src/backend/distributor/catalog.ts` (data module)

**Analog:** Existing `CatalogEntry` interface + 24-row `FLEET_SUBSTRATE_CATALOG` array.

**Existing interface** (`catalog.ts:68-97`):
```typescript
export interface CatalogEntry {
  slug: string;
  bundledPath: string;   // /app/fleet-substrate/…
  installPath: string;   // ~/… (tilde-expanded)
  restartHook: string | null;
}
```

**Pure-lib discipline** (`catalog.ts:11-16`):
```
This module contains NO filesystem access, NO SSH, NO child process
execution, NO logger — it is data + type declaration only. Zero runtime
imports.
```
Extension MUST preserve this — no runtime imports, no new function bodies.

**Extension shape (RESEARCH-recommended discriminated union on `sourceKind`)** (per D-12 + RESEARCH Pattern 1):
```typescript
export interface BundledCatalogEntry {
  slug: string;
  sourceKind: "bundled";
  bundledPath: string;
  installPath: string;
  installMode?: "user-home" | "system-root";  // optional; defaults to "user-home"
  restartHook: string | null;
}

export interface RuntimeCatalogEntry {
  slug: string;
  sourceKind: "runtime";
  resolverKey: "instance-policy";  // string-literal union — extend as new runtime rows land
  installPath: string;
  installMode: "user-home" | "system-root";
  restartHook: string | null;
}

export type CatalogEntry = BundledCatalogEntry | RuntimeCatalogEntry;
```

**Existing bundled row shape** (`catalog.ts:108-113`) — MUST stay byte-similar (only gains `sourceKind: "bundled"`):
```typescript
{
  slug: "id-skill",
  sourceKind: "bundled",          // NEW — single literal added to every existing row
  bundledPath: "/app/fleet-substrate/skills/id/SKILL.md",
  installPath: "~/.claude/skills/id/SKILL.md",
  restartHook: null,
},
```

**New twinkie row (D-14)** — append to `FLEET_SUBSTRATE_CATALOG`:
```typescript
{
  slug: "instance-policy-claude-md",
  sourceKind: "runtime",
  resolverKey: "instance-policy",
  installPath: "/etc/claude-code/CLAUDE.md",
  installMode: "system-root",
  restartHook: null,
},
```

**Docstring row-count reconciliation** (`catalog.ts:33-58`) — the docstring explicitly enumerates row count with reasoning. Bump `Total = 24` → `Total = 25` and add a bullet describing the twinkie row + the two new axes. Discretion point D-12 recommended yes; the docstring is heavily maintained.

---

### `src/backend/distributor/ssh-push.ts` (SSH transport helper)

**Analog:** Existing `readInstalledBytes` (L76-112) and `writeInstalledBytesWithMode` (L146-213). New `removeInstalledFile` is a PEER helper, not a mode of the existing writer.

**Sentinel-based ExecResult dispatch pattern** (`ssh-push.ts:76-112`):
```typescript
export async function readInstalledBytes(
  channel: SshChannel,
  installPath: string,
): Promise<InstalledReadResult> {
  try {
    const escaped = quotePathPreservingTilde(installPath);
    const cmd = `base64 -w0 ${escaped} 2>/dev/null && echo __READ_OK__ || echo __READ_ENOENT__`;
    const rawRes = await channel.exec(cmd);
    if (!rawRes.ok) {
      return { readOk: false, reason: "transport" };
    }
    const trimmed = rawRes.stdout.trimEnd();
    if (trimmed.endsWith("__READ_OK__")) { /* ... */ }
    if (trimmed.endsWith("__READ_ENOENT__")) { /* ... */ }
    return { readOk: false, reason: "transport" };
  } catch {
    return { readOk: false, reason: "transport" };
  }
}
```
Copy this shape for `removeInstalledFile`: new sentinels `__REMOVE_DID__` / `__REMOVE_ALREADY__` / `__REMOVE_FAIL__` per D-27.

**Tilde-preserving quoting** (`ssh-push.ts:47-52`) — the discriminant between the two install modes:
```typescript
function quotePathPreservingTilde(path: string): string {
  if (path.startsWith("~/")) {
    return "~/" + shellSingleQuote(path.slice(2));
  }
  return shellSingleQuote(path);
}
```
Absolute paths (system-root) hit the `else` branch — plain `shellSingleQuote` (imported from `discover-identity-session-file.ts:246`). Per Pitfall 2, the writer/remover for `installMode: "system-root"` MUST branch:
```typescript
const escapedPath =
  installMode === "system-root"
    ? shellSingleQuote(installPath)              // '/etc/claude-code/CLAUDE.md'
    : quotePathPreservingTilde(installPath);     // ~/'.claude/skills/id/SKILL.md'
```

**Write + chmod atomic exec pattern** (`ssh-push.ts:146-213`, key command shape L168-169):
```typescript
const cmd =
  `{ mkdir -p ${escapedParent} && base64 -d > ${escapedPath} && chmod ${modeStr} ${escapedPath} && echo __WRITE_OK__ || echo __WRITE_FAIL__ ; } 2>&1`;
const b64 = bytes.toString("base64");
const stdinBody = Buffer.from(b64, "utf-8");
const rawRes = await channel.exec(cmd, stdinBody);
```
For `installMode: "system-root"` writes, the command grows a `chown root:root` step per D-13 + D-18:
```
{ mkdir -p '/etc/claude-code' && chown root:root '/etc/claude-code' && chmod 0755 '/etc/claude-code' && base64 -d > '/etc/claude-code/CLAUDE.md' && chown root:root '/etc/claude-code/CLAUDE.md' && chmod 0644 '/etc/claude-code/CLAUDE.md' && echo __WRITE_OK__ || echo __WRITE_FAIL__ ; } 2>&1
```
Assumption A6: since SSH is already as root (D-13 gate), `chown root:root` is defense-in-depth (harmless idempotent).

**New `removeInstalledFile` helper (RESEARCH Pattern 4)** — peer of `writeInstalledBytesWithMode`:
```typescript
export async function removeInstalledFile(
  channel: SshChannel,
  installPath: string,
): Promise<
  | { ok: true; action: "removed" | "already-absent" }
  | { ok: false; stage: "remove" | "verify"; errorMessage: string }
> {
  try {
    const escaped = shellSingleQuote(installPath);  // absolute path — no tilde
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

**Never-throw contract docstring** (`ssh-push.ts:26-33`):
```
NEVER-THROW CONTRACT:
  Every helper returns a discriminated-union result rather than throwing.
  The Plan 04 hook site inside ssh-poll-orchestrator.ts's
  tryAcquireHostChannel is fire-and-forget from the poll's perspective —
  an unhandled promise rejection at the sweep composer level would leak
  past the poll's error containment and degrade the 2s poll cadence.
```
`removeInstalledFile` inherits this contract — outer try/catch wraps everything, `__THROW__` sentinel prefix per Phase 111 code-review M1.

---

### `src/backend/distributor/run-sweep.ts` (sweep composer)

**Analog:** Existing `runSweepForHost` composer (L87-276) + `SweepDeps` (L50-56) + catalog for-of loop (L109-264).

**SweepDeps injection pattern** (`run-sweep.ts:44-56`):
```typescript
export interface SweepDeps {
  readBundledBytes: (
    bundledPath: string,
  ) => Promise<{ bytes: Buffer; mode: number } | null>;
  now?: () => number;
}
```
Extend per RESEARCH Pattern 2 + Pitfall 6:
```typescript
export interface SweepDeps {
  readBundledBytes: (bundledPath: string) => Promise<{ bytes: Buffer; mode: number } | null>;
  /** Pre-resolved runtime bytes (per D-15: resolved ONCE per sweep at
   *  orchestrator level, fanned to every host). Composer looks up by
   *  entry.resolverKey. null value = row skipped/removed for this sweep. */
  resolvedRuntimeBytes?: Map<string, Buffer | null>;
  now?: () => number;
}
```

**Composer signature** (`run-sweep.ts:87-92`) — Pitfall 3 requires widening host param:
```typescript
export async function runSweepForHost(
  channel: SshChannel,
  host: { id: string; name: string },  // WIDEN → add username: string
  catalog: readonly CatalogEntry[],
  deps: SweepDeps,
): Promise<{ itemsChecked: number; itemsChanged: number; itemsFailed: number }> {
```
Change to `host: { id: string; name: string; username: string }`. Update the two call sites: `server-substrate-orchestrator.ts:180` and `:338` — both pass `hostRecord._connDetails.username as string`.

**Catalog for-of loop** (`run-sweep.ts:109-264`) — new branches slot in BEFORE the existing read/compare flow:
```typescript
for (const entry of catalog) {
  itemsChecked++;
  try {
    // NEW: root-user gate (D-13/D-26)
    const installMode = ("installMode" in entry ? entry.installMode : undefined) ?? "user-home";
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

    // NEW: source resolution branch (D-12)
    let bundledResult: { bytes: Buffer; mode: number } | null;
    if (entry.sourceKind === "runtime") {
      const bytes = deps.resolvedRuntimeBytes?.get(entry.resolverKey) ?? null;
      bundledResult = bytes === null ? null : { bytes, mode: 0o644 };
    } else {
      bundledResult = await deps.readBundledBytes(entry.bundledPath);
    }

    // NEW: removal branch for runtime rows with null bytes (D-16/D-27)
    if (entry.sourceKind === "runtime" && bundledResult === null) {
      const rmResult = await removeInstalledFile(channel, entry.installPath);
      // ... map to logItemChanged / logItemFailed ...
      continue;
    }

    // EXISTING: readInstalledBytes / decideItemAction / writeInstalledBytesWithMode flow
    const installedResult = await retryOnTransport(/* ... */);
    // ...
  } catch (err) { /* existing catch-all */ }
}
```

**Retry-on-transport predicate pattern** (`run-sweep.ts:72-85`):
```typescript
async function retryOnTransport<T>(
  fn: () => Promise<T>,
  isTransient: (result: T) => boolean,
  maxTries: number = 3,
  backoffMs: number = 200,
): Promise<T> {
  let last: T = await fn();
  for (let i = 1; i < maxTries; i++) {
    if (!isTransient(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    last = await fn();
  }
  return last;
}
```
Reuse for `removeInstalledFile` if desired — the predicate would check `r.ok === false && !r.errorMessage.includes("__REMOVE_FAIL__") && !r.errorMessage.includes("__THROW__")`. Minor.

**Never-reject contract** (`run-sweep.ts:12-18`):
```
FIRE-AND-FORGET CONTRACT:
  runSweepForHost RESOLVES even if every item fails. It NEVER rejects.
  The ssh-poll-orchestrator.ts hook site depends on this contract:
  an unhandled promise rejection would leak past the poll's error
  containment and degrade the 2s poll cadence.
```
Every new branch (root-user gate, runtime source, removal) MUST live inside the existing try/catch or add its own — never throw upward.

---

### `src/backend/distributor/server-substrate-orchestrator.ts` (orchestrator wiring — inferred, not in explicit file list)

Per RESEARCH Pitfall 6 (resolve twinkie ONCE per sweep, fan to all hosts): the concrete `resolvedRuntimeBytes` Map SHOULD be populated at orchestrator level, not composer level. Existing call site (`server-substrate-orchestrator.ts:180`):
```typescript
result = await runSweepForHost(channel, { id: host.id, name: host.name }, FLEET_SUBSTRATE_CATALOG, {
  readBundledBytes: bundledReaderFromDisk,
  now: deps.now,
});
```
Extend to:
1. Widen the host object with `username: hostRecord._connDetails.username as string`.
2. Resolve the map ONCE at the top of each tick (both startup pass and 30s retry tick):
```typescript
const runtimeMap = new Map<string, Buffer | null>();
runtimeMap.set("instance-policy", await readInstancePolicyBytes());
// pass runtimeMap as deps.resolvedRuntimeBytes to every runSweepForHost call in this tick
```

Analog for the "resolve once, fan out" motion: the existing startup pass at `server-substrate-orchestrator.ts:259-286` iterates hosts serially — that's the natural memoization boundary.

---

### `docker/branding-defaults/branding.json` (bundled defaults JSON)

**Analog:** Self (existing file — must byte-mirror `HARDCODED_FALLBACK`).

**Existing shape** (`docker/branding-defaults/branding.json`, all 14 lines):
```json
{
  "appName": "SKYNET",
  "shortName": "SKYNET",
  "iconPath": "/branding/icon.png",
  "wordmarkPath": "/branding/wordmark.png",
  "faviconPath": "/branding/favicon.svg",
  "wipIndicatorPath": "/branding/wip-cube.webp",
  "pwaIcons": [
    {"src": "/branding/pwa-icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "/branding/pwa-icon-512.png", "sizes": "512x512", "type": "image/png"}
  ],
  "avatarDirectorSpec": "",
  "avatarGammaDefault": 0.7
}
```
Per D-04 + Phase 70 D-14: add `"instancePolicyFilename": ""` — MUST match HARDCODED_FALLBACK byte-for-byte. Recommended placement: adjacent to `avatarDirectorSpec` (both empty-string-defaulted intentional-unset fields).

---

### `src/backend/branding/branding-config-loader.test.ts` (loader tests)

**Analog:** Existing Phase 74 shape-guard tests.

**fs mock pattern** (`branding-config-loader.test.ts:69-83`):
```typescript
vi.mock("node:fs", () => {
  return {
    promises: {
      stat: async () => {
        if (state.configError) throw state.configError;
        return { size: 1024 };
      },
      readFile: async () => {
        if (state.configError) throw state.configError;
        return JSON.stringify(state.configJson);
      },
    },
    readFileSync: () => JSON.stringify(bundledDefaultJson),
  };
});
```
Extend the mock to also handle `fs.promises.stat` + `readFile` for the twinkie file path (`/etc/skynet/branding/<filename>.md`). Add a `state.twinkieFile: { bytes: Buffer; error: NodeJS.ErrnoException | null }` field to the shared state holder.

**Fresh-import pattern** (`branding-config-loader.test.ts:126-129`):
```typescript
async function freshLoader() {
  vi.resetModules();
  return await import("./branding-config-loader.js");
}
```
Reuse verbatim — the new `readInstancePolicyBytes()` export needs the same fresh-module isolation.

**Tests T-01 through T-05** (per D-21):
- T-01: valid filename → parses correctly.
- T-02: field absent from config JSON → defaults to `""` (validates optional-in-guard shape).
- T-03: over-cap file → `readInstancePolicyBytes()` returns null + `sshLogger.error` called with `operation: "branding_instance_policy_size"`.
- T-04: filename with `..` → `readInstancePolicyBytes()` returns null (log containment violation).
- T-05: field set + file ENOENT → returns null without throwing.

---

### `src/backend/branding/assert-boot.test.ts` (boot-gate tests)

**Analog:** Existing Phase 74 boot-gate tests.

**Loader mock + logger spy pattern** (`assert-boot.test.ts:73-92`):
```typescript
vi.mock("./branding-config-loader.js", () => ({
  loadBrandingConfig: async () => state.loadResult,
}));

const systemLoggerErrorSpy = vi.fn();

vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  },
  systemLogger: {
    debug: () => {}, info: () => {}, warn: () => {},
    error: (...args: unknown[]) => systemLoggerErrorSpy(...args),
  },
}));
```
Extend: (a) extend loader mock to also expose `readInstancePolicyBytes: async () => state.instancePolicyBytes` from a shared `state.instancePolicyBytes: Buffer | null`; (b) add `sshLoggerErrorSpy` alongside `systemLoggerErrorSpy` (Phase 114 uses `sshLogger.error`, NOT `systemLogger.error`).

**exit-spy pattern** (`assert-boot.test.ts:112-117`):
```typescript
exitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code}) called`);
  }) as never);
```
Keep for Phase 74 tests. Phase 114 tests MUST assert `exitSpy` was NEVER called (D-05: non-throwing alarm).

**Tests T-06a through T-06d** (per D-21):
- T-06a: empty-string default (`instancePolicyFilename: ""`) → NO error log, NO exit. (Guards against future accidental gate addition.)
- T-06b: field set + `readInstancePolicyBytes` returns Buffer → clean startup, no log, no exit.
- T-06c: field set + `readInstancePolicyBytes` returns null → `sshLoggerErrorSpy` called with `operation: "branding_instance_policy_boot_alarm"`, exit NOT called.
- T-06d: field set + over-cap → same alarm path as T-06c (from consumer's view).

---

### `src/backend/distributor/catalog.test.ts` (catalog schema tests)

**Analog:** Existing schema-invariant tests (L34-205).

**Row-count test pattern** (`catalog.test.ts:35-50`):
```typescript
it("Test 1: contains exactly 24 entries (17 conceptual items + …)", () => {
  expect(FLEET_SUBSTRATE_CATALOG.length).toBe(24);
});
```
Bump to 25. Update the docstring in the test file too.

**Path-prefix invariant pattern** (`catalog.test.ts:52-70`):
```typescript
it("Test 3: every installPath starts with ~/.claude/skills/, ~/.local/bin/, or ~/.config/systemd/user/", () => {
  for (const entry of FLEET_SUBSTRATE_CATALOG) {
    const ok =
      entry.installPath.startsWith("~/.claude/skills/") ||
      entry.installPath.startsWith("~/.local/bin/") ||
      entry.installPath.startsWith("~/.config/systemd/user/");
    expect(ok, `bad installPath: ${entry.installPath}`).toBe(true);
  }
});
```
LOAD-BEARING UPDATE: Extend the allowed-prefix set to include `/etc/claude-code/` for `installMode: "system-root"` rows, OR narrow the assertion to only apply to `installMode` !== `"system-root"` entries. Recommended: filter by `installMode` — keeps the invariant tight for `user-home` rows.

**Test T-07 (D-22 schema regression guard)** — new test:
```typescript
it("Test T-07: sourceKind discriminant — 24 bundled + 1 runtime row", () => {
  const bundled = FLEET_SUBSTRATE_CATALOG.filter((e) => e.sourceKind === "bundled");
  const runtime = FLEET_SUBSTRATE_CATALOG.filter((e) => e.sourceKind === "runtime");
  expect(bundled.length).toBe(24);
  expect(runtime.length).toBe(1);
  // Bundled entries retain bundledPath field (existing invariant)
  for (const e of bundled) {
    expect(typeof e.bundledPath).toBe("string");
    expect(e.bundledPath.startsWith("/app/fleet-substrate/")).toBe(true);
  }
  // The one runtime entry is the twinkie
  expect(runtime[0].slug).toBe("instance-policy-claude-md");
  expect(runtime[0].installPath).toBe("/etc/claude-code/CLAUDE.md");
  expect(runtime[0].installMode).toBe("system-root");
});
```

---

### `src/backend/distributor/ssh-push.test.ts` (push helper tests)

**Analog:** Existing sentinel-parse tests (L1-280).

**Channel-mock pattern** (`ssh-push.test.ts:31-38`):
```typescript
function makeChannel(execImpl: (cmd: string, stdinBody?: Buffer) => Promise<string | null> | string | null): {
  channel: SshChannel;
  exec: ReturnType<typeof vi.fn>;
} {
  const exec = vi.fn(async (cmd: string, stdinBody?: Buffer) => toExecResult(await execImpl(cmd, stdinBody)));
  const channel: SshChannel = { exec };
  return { channel, exec };
}
```
Reuse verbatim for `removeInstalledFile` tests.

**Tilde-preservation regression pattern** (`ssh-push.test.ts:212-238`):
```typescript
it("Test 8b: tilde-preservation — no `'~/` literal (single-quoted tilde-slash) appears in the write command for a catalog-shaped path", async () => {
  // ...
  expect(cmd).not.toContain("'~/");
  expect(cmd).toContain("~/");
});
```
INVERSE pattern for T-09 (system-root push): expect ABSOLUTE path single-quoted, NO `~/` present:
```typescript
it("Test T-09: system-root write — absolute path single-quoted, no tilde", async () => {
  const { channel, exec } = makeChannel(async () => "__WRITE_OK__");
  const bytes = Buffer.from("twinkie-content");
  await writeInstalledBytesWithMode(channel, "/etc/claude-code/CLAUDE.md", bytes, 0o644, { installMode: "system-root" });
  const cmd = exec.mock.calls[0][0] as string;
  expect(cmd).toContain("'/etc/claude-code/CLAUDE.md'");
  expect(cmd).not.toContain("~/");
  expect(cmd).toContain("chown root:root");
  expect(cmd).toContain("chmod 644");
});
```

**New test suite: `removeInstalledFile`** — mirror the `readInstalledBytes` describe block:
```typescript
describe("removeInstalledFile", () => {
  it("Test T-27a: __REMOVE_DID__ → {ok:true, action:'removed'}", async () => {
    const { channel } = makeChannel(async () => "__REMOVE_DID__");
    const result = await removeInstalledFile(channel, "/etc/claude-code/CLAUDE.md");
    expect(result).toEqual({ ok: true, action: "removed" });
  });
  it("Test T-27b: __REMOVE_ALREADY__ → {ok:true, action:'already-absent'}", async () => { /* ... */ });
  it("Test T-27c: transport failure → {ok:false, stage:'remove'}", async () => { /* ... */ });
  it("Test T-27d: absolute path is shell-single-quoted, no tilde", async () => {
    const { exec } = makeChannel(async () => "__REMOVE_ALREADY__");
    // assert cmd contains "'/etc/claude-code/CLAUDE.md'" but NOT "~/"
  });
});
```

**T-10 byte-compare regression** — reuse existing `readInstalledBytes` test structure (L41-50) with same-bytes return; assert `writeInstalledBytesWithMode` was NEVER called.

---

### `src/backend/distributor/run-sweep.test.ts` (sweep composer tests)

**Analog:** Existing composer tests, `catalogEntry` factory + `makeChannelSequenced`.

**Catalog entry factory** (`run-sweep.test.ts:75-83`):
```typescript
function catalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    slug: "test-item",
    bundledPath: "/app/fleet-substrate/skills/test/SKILL.md",
    installPath: "~/.claude/skills/test/SKILL.md",
    restartHook: null,
    ...overrides,
  };
}
```
Extend to accept `sourceKind` + `installMode` + `resolverKey` overrides. May need a second factory `runtimeCatalogEntry()` since the discriminated-union prevents overrides from mixing `bundledPath` + `resolverKey`.

**Sequenced channel-mock pattern** (`run-sweep.test.ts:60-73`):
```typescript
function makeChannelSequenced(
  handler: (cmd: string, callIndex: number) => string | null,
): { channel: SshChannel; exec: ReturnType<typeof vi.fn> } {
  let idx = 0;
  const exec = vi.fn(async (cmd: string, _stdinBody?: Buffer) => {
    const v = handler(cmd, idx++);
    if (v === null) return { ok: false as const, reason: "transport" as const, message: "channel returned null" };
    return { ok: true as const, stdout: v };
  });
  return { channel: { exec }, exec };
}
```
Reuse verbatim.

**Log-tag mock pattern** (`run-sweep.test.ts:19-24`):
```typescript
vi.mock("./log-tags.js", () => ({
  logSweepResult: vi.fn(),
  logItemChanged: vi.fn(),
  logItemFailed: vi.fn(),
  logSweepHookError: vi.fn(),
}));
```
Reuse. Also add `sshLogger.info` spy for the D-26 skip-log assertion.

**Tests T-08 + gate tests** (per D-22):
- T-08 (resolver-once + null-skip): Compose a runSweepForHost call with `deps.resolvedRuntimeBytes = new Map([["instance-policy", null]])`. Host has `username: "root"`. Assert the twinkie row triggers `removeInstalledFile` (channel.exec was called with `rm -f`), NOT `readInstalledBytes` / `writeInstalledBytesWithMode`. For the "once per sweep" property: assert the composer does NOT re-resolve — that's an orchestrator-level property; the composer just consumes the pre-resolved map.
- Root-user gate test: same runtime map but host `username: "notroot"`. Assert `channel.exec` was NEVER called for the twinkie row; assert `sshLogger.info` spy was called with `operation: "fleet_substrate_system_root_skip"`.

---

### `src/backend/distributor/server-substrate-integration.test.ts` (T-11 end-to-end)

**Analog:** Existing integration harness for the substrate orchestrator.

**Test T-11 (per D-22)**: end-to-end sweep with twinkie set + present on the test Skynet server → managed host receives `/etc/claude-code/CLAUDE.md` with matching bytes. The concrete shape depends on the existing harness — planner should read the file top-to-bottom and mirror its scenario-setup pattern.

---

## Shared Patterns

### Never-throws / never-rejects contract

**Sources:**
- `branding-config-loader.ts:13-21` (loader docstring)
- `ssh-push.ts:26-33` (push docstring)
- `run-sweep.ts:12-18` (composer docstring)

**Apply to:** ALL new code in this phase.

**Concrete excerpt** (branding-config-loader.ts:14-21):
```
Error handling contract:
  - Missing config file (ENOENT) → return bundled defaults (empty state
    is normal — no log; per D-14 a no-config deploy preserves current behavior).
  - Config file exceeds size cap (>256 KB) → sshLogger.error + return
    bundled defaults.
  - Other read error → sshLogger.error + return bundled defaults.
  - JSON parse error → sshLogger.error + return bundled defaults.
  - Shape-invalid parsed value → sshLogger.error + return bundled defaults.
  - This function never throws; all failure modes return the safe default.
```

New surfaces MUST inherit:
- `readInstancePolicyBytes()`: never throws; every failure mode returns `null`.
- `removeInstalledFile()`: never throws; every failure mode returns `{ ok: false, … }`.
- Added branches in `run-sweep.ts`: all wrapped in the existing outer try/catch.
- `assert-boot.ts` Phase 114 addition: `sshLogger.error` + return silently. NO `process.exit`, NO throw.

### Structured logging via `sshLogger` / `systemLogger`

**Source:** `../utils/logger.js` — `sshLogger` (per-item transport-level) and `systemLogger` (server-lifetime-level).

**Apply to:** All new log lines.

**Level guidance:**
- `sshLogger.info` — expected state (root-user gate skip per D-26; runtime null-resolver skip discretion point).
- `sshLogger.error` — misconfig alarm (D-05); containment violation on twinkie filename; over-cap twinkie file; twinkie read error.
- `systemLogger.error` — fatal boot gates only (Phase 74's avatarDirectorSpec branch stays; Phase 114 does NOT add here).

**Concrete excerpt** (existing pattern at `run-sweep.ts` payload style, mirrored from `ssh-poll-orchestrator.ts` log tags):
```typescript
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
```

### Discriminated-union return + sentinel-based dispatch

**Source:** `ssh-push.ts:61-64` (`InstalledReadResult`) + L11-18 (sentinel docstring).

**Apply to:** `removeInstalledFile` new helper.

**Concrete excerpt** (ssh-push.ts:61-64):
```typescript
export type InstalledReadResult =
  | { readOk: true; bytes: Buffer | null }
  | { readOk: false; reason: "transport" };
```

New sentinels for removal (per D-27): `__REMOVE_DID__` / `__REMOVE_ALREADY__` / `__REMOVE_FAIL__`. Discriminated-union return:
```typescript
| { ok: true; action: "removed" | "already-absent" }
| { ok: false; stage: "remove" | "verify"; errorMessage: string };
```

### Path-containment guard (V5/V12)

**Source:** `branding-config-loader.ts:289-295`:
```typescript
const overridePath = path.resolve(overrideBase, sanitized);
if (
  !overridePath.startsWith(overrideBase + path.sep) &&
  overridePath !== overrideBase
) {
  throw new Error("branding asset path escapes override base directory");
}
```

**Apply to:** `readInstancePolicyBytes()` — same `path.resolve` + `startsWith(base + path.sep)` check on the admin-supplied filename. Per D-11 never-throws: log and return null instead of throwing.

### Shell-quoting discipline

**Source:** `discover-identity-session-file.ts:246-248`:
```typescript
export function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
```
And `ssh-push.ts:47-52` (`quotePathPreservingTilde`).

**Apply to:** All exec strings emitted by new ssh-push code.
- `installMode: "user-home"` → `quotePathPreservingTilde()`.
- `installMode: "system-root"` → plain `shellSingleQuote()`. Absolute paths MUST NOT be tilde-processed.

## No Analog Found

None. Every file in Phase 114's edit surface has a direct analog in the current codebase. The three "new capabilities" (runtime-resolved sourceKind, system-root installMode, removal push) are all local extensions of existing patterns — not net-new subsystems.

## Metadata

**Analog search scope:**
- `/home/ubuntu/skynet-tina/src/backend/branding/` (8 files)
- `/home/ubuntu/skynet-tina/src/backend/distributor/` (21 files)
- `/home/ubuntu/skynet-tina/src/backend/claude-session/discover-identity-session-file.ts` (for `shellSingleQuote`)
- `/home/ubuntu/skynet-tina/docker/branding-defaults/branding.json`
- `/home/ubuntu/skynet-tina/src/backend/utils/logger.js` (import surface only — sshLogger / systemLogger)

**Files scanned:** 12 read in full, ~5 partial reads for line-anchor verification.

**Pattern extraction date:** 2026-09-17
