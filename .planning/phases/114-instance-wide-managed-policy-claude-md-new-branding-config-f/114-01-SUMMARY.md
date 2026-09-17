---
phase: 112-instance-wide-managed-policy-claude-md-new-branding-config-f
plan: 01
subsystem: backend/branding
tags: [branding-config, instance-policy, twinkie, phase-114, tdd]
requires:
  - "BrandingConfig type + isValidBrandingShape() shape guard + HARDCODED_FALLBACK from Phase 70/74/82"
  - "getBrandingAssetsDir() + MAX_CONFIG_BYTES constant + sshLogger structured logs (existing)"
  - "resolveAssetPath() containment-guard shape (Phase 70) — pattern-source"
provides:
  - "BrandingConfig.instancePolicyFilename: string (empty-string = clean unset state)"
  - "isValidBrandingShape() accepts documents WITHOUT the new field (optional-in-guard, Pitfall 1 mitigation)"
  - "readInstancePolicyBytes(): Promise<Buffer | null> — never-throws twinkie byte-reader"
  - "docker/branding-defaults/branding.json byte-mirrors HARDCODED_FALLBACK on the new field"
affects:
  - "Plan 02 (assert-boot alarm) — consumes readInstancePolicyBytes() to fire the D-05 misconfig log"
  - "Plan 03 / 05 (distributor catalog + sweep composer) — consumes readInstancePolicyBytes() as the runtime resolver"
  - "Every downstream Phase 114 plan compiles against this surface"
tech-stack:
  added: []
  patterns:
    - "Optional-in-guard shape validation (guards Pitfall 1 — deployed-config first-boot override-stomp)"
    - "Post-guard normalization coerces parsed.instancePolicyFilename ?? \"\" so downstream trim/compare is safe"
    - "Path-containment guard mirrors resolveAssetPath() but log+return-null instead of throw (per D-11 never-throws)"
    - "Byte-cap reuse of MAX_CONFIG_BYTES (no separate MAX_INSTANCE_POLICY_BYTES alias per D-06)"
    - "ENOENT silent + non-ENOENT loud in the same catch — assert-boot handles boot-time loudness for the misconfig case"
key-files:
  created: []
  modified:
    - "src/backend/branding/branding-config-loader.ts (+ instancePolicyFilename field, HARDCODED_FALLBACK entry, shape-guard optional check, loader normalization, readInstancePolicyBytes export — ~110 lines added)"
    - "src/backend/branding/branding-config-loader.test.ts (+ path-dispatch mock, sshLoggerErrorSpy, P114-T-01/02/03/04/05 + supplementary tests — 11 new tests, 21/21 pass)"
    - "docker/branding-defaults/branding.json (+ instancePolicyFilename empty-string byte-mirror)"
decisions:
  - "Optional-in-guard chosen (Pitfall 1 option (a)) over required-field-in-guard — protects operator overrides on first-boot after upgrade"
  - "Co-located readInstancePolicyBytes() in branding-config-loader.ts (D-11 discretion) — every dep already imported"
  - "Reused MAX_CONFIG_BYTES directly (per D-06 + Task 2 action step 1) — did NOT introduce a MAX_INSTANCE_POLICY_BYTES alias"
  - "Post-guard normalization via mutable-record assignment (smallest diff, preserves existing return shape)"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-17"
---

# Phase 114 Plan 01: Instance-wide managed-policy CLAUDE.md — branding-config source-of-truth Summary

Extends `BrandingConfig` with the `instancePolicyFilename: string` field
(the source-of-truth for the instance-wide managed-policy CLAUDE.md
"twinkie") and adds the never-throws `readInstancePolicyBytes()` peer
export that every downstream Phase 114 plan (assert-boot alarm,
distributor catalog+push, sweep composer) will consume.

## Deliverables

- **`BrandingConfig` type extension** (D-01/D-02): new required-in-type
  `instancePolicyFilename: string`. Bare filename, NOT a URL path — the
  twinkie is never HTTP-served, so a `Path` suffix would mislead readers.
  Empty-string convention mirrors `avatarDirectorSpec` (Phase 74).
- **`HARDCODED_FALLBACK` mirror** (D-03/D-10): `instancePolicyFilename: ""`
  — the intentional-unset state. NO bundled-default leg (unlike iconPath
  / wipIndicatorPath which do have `/app/branding-defaults/<file>`
  fallback).
- **`docker/branding-defaults/branding.json` mirror** (D-04 + Phase 70
  D-14): byte-mirrors HARDCODED_FALLBACK on the new field.
- **Shape-guard optional-in-guard check**: `isValidBrandingShape()` now
  accepts documents *without* `instancePolicyFilename` — critical
  Pitfall 1 mitigation so deployed `branding.json` files written
  BEFORE Phase 114 landed don't get whole-config-rejected and stomp the
  operator's iconPath/wordmarkPath/wipIndicatorPath overrides on first
  boot after upgrade. Absent key = accept; present-but-non-string = reject.
- **Loader normalization**: after the shape guard passes,
  `loadBrandingConfig()` coerces `parsed.instancePolicyFilename ?? ""`
  so the returned `BrandingConfig` always has the field as a string —
  downstream callers can `.trim()` / compare directly with no undefined
  guards.
- **`readInstancePolicyBytes(): Promise<Buffer | null>` export** (D-11):
  reads the twinkie file's bytes from `/etc/skynet/branding/<filename>`
  under the same never-throws contract as the loader. Fast-paths on
  empty filename (no fs call, no log — clean unset per D-10). Path-
  containment guard mirrors `resolveAssetPath()` but logs and returns
  null instead of throwing (per D-11 — no HTTP-route surface at sweep
  time). Byte-cap reuse of `MAX_CONFIG_BYTES` per D-06 (no separate
  constant). ENOENT returns null SILENTLY (Plan 04's assert-boot fires
  the loud misconfig alarm ONCE at boot); non-ENOENT errors emit
  `sshLogger.error` with `operation: "branding_instance_policy_read"`.

## Tests (all passing — 21/21 total in the loader test file)

Task 1 — instancePolicyFilename shape + defaults:

- **P114-T-01**: valid filename parses correctly (`cfg.instancePolicyFilename === "team.md"`).
- **P114-T-02**: absent field is optional-in-guard, normalized to `""`; operator overrides survive (regression guard for Pitfall 1).
- **P114-T-01c**: HARDCODED_FALLBACK.instancePolicyFilename byte-check (empty string via bundled-defaults path).
- **P114-T-01d**: `docker/branding-defaults/branding.json` byte-mirrors HARDCODED_FALLBACK on the new field.
- **P114-T-01e**: malformed `instancePolicyFilename: 123` → shape guard rejects → bundled defaults returned + `branding_config_shape` error log fires.

Task 2 — readInstancePolicyBytes():

- **P114-T-01r**: happy path — filename set + file present → returns Buffer with correct bytes.
- **P114-T-02r**: absent field → returns null without any fs.stat call on the twinkie path.
- **P114-T-03**: over-cap file (256 KB + 1 byte) → null + `sshLogger.error(branding_instance_policy_size)`.
- **P114-T-04**: filename contains `..` → null + `sshLogger.error(branding_instance_policy_containment)` + guard short-circuits before fs.stat.
- **P114-T-05**: file ENOENT → null SILENTLY (no sshLogger call — assert-boot handles the loud boot-time alarm in Plan 04).
- **P114-T-05b**: non-ENOENT read error (EACCES) → null + `sshLogger.error(branding_instance_policy_read)`.

## Verify

```
npx vitest run src/backend/branding/branding-config-loader.test.ts
# → 21/21 pass

python3 -c "import json; d = json.load(open('docker/branding-defaults/branding.json')); assert d['instancePolicyFilename'] == ''"
# → exit 0
```

All source-assertion greps from `<acceptance_criteria>` pass:

- `grep -c "instancePolicyFilename" src/backend/branding/branding-config-loader.ts` → 7 (≥ 4)
- Optional-in-guard shape present (multi-line but semantically identical: `o.instancePolicyFilename !== undefined && typeof o.instancePolicyFilename !== "string"`)
- `grep -q 'instancePolicyFilename: ""' src/backend/branding/branding-config-loader.ts` → succeeds
- `grep -q "^export async function readInstancePolicyBytes" src/backend/branding/branding-config-loader.ts` → succeeds
- All three `operation:` sentinels present (`branding_instance_policy_size|containment|read`)
- `grep -q "stat.size > MAX_CONFIG_BYTES" src/backend/branding/branding-config-loader.ts` → succeeds (byte-cap reuse — no new constant)
- `grep -c "readInstancePolicyBytes" src/backend/branding/branding-config-loader.test.ts` → 13 (≥ 5)
- Throw count in the reader body: 0 (the 2 matches are inside JSDoc comments explicitly saying "do NOT throw")

## Commits

- **105485cb** `feat(112-01): add instancePolicyFilename field to BrandingConfig` — Task 1
- **b0064617** `feat(112-01): add readInstancePolicyBytes() reader with never-throws contract` — Task 2

## Deviations from Plan

None. Plan executed exactly as written — the two tasks landed as-planned
with the optional-in-guard shape (RESEARCH.md-recommended Pitfall 1
option (a)), co-located reader (D-11 discretion), and byte-cap constant
reuse (D-06). No auth gates, no checkpoints, no Rule 1-4 deviations.

**Minor pattern refinement — not a deviation, an implementation choice
inside the discretion band**: the shape-guard multi-line form
(`... !== undefined &&\n    typeof ... !== "string"`) differs superficially
from the single-line grep pattern in `<acceptance_criteria>` but is
semantically identical and matches the file's house style for
multi-condition returns (see the parallel `avatarGammaDefault` check at
L189-193).

## Threat Flags

None. This plan implements exactly the mitigations declared in the plan's
`<threat_model>` for T-114-01 (containment), T-114-02 (DoS byte-cap),
T-114-03 (never-throws info-disclosure), and T-114-04 (optional-in-guard
first-boot override protection). No new security-relevant surface
introduced outside the declared threat register.

## Self-Check: PASSED

- `src/backend/branding/branding-config-loader.ts` — FOUND (modified, +110 lines)
- `src/backend/branding/branding-config-loader.test.ts` — FOUND (modified, +260 lines including test cases + mock extensions)
- `docker/branding-defaults/branding.json` — FOUND (modified, +1 line for new field)
- Commit `105485cb` — FOUND in `git log --oneline`
- Commit `b0064617` — FOUND in `git log --oneline`
- Scoped test command exits 0: `npx vitest run src/backend/branding/branding-config-loader.test.ts` → 21/21 pass.
