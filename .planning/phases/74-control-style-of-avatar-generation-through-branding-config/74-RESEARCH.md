# Phase 74: control-style-of-avatar-generation-through-branding-config — Research

**Researched:** 2026-09-04
**Domain:** Branding-config schema extension + backend consumer wiring + boot-time fail-fast + cross-deployment migration seeding
**Confidence:** HIGH (every code-side finding verified in-tree; the only unresolved axis is the AI+/T800 deploy handoff mechanism, which CONTEXT.md flags as a plan-phase decision)

<user_constraints>
## User Constraints (from 74-CONTEXT.md)

### Locked Decisions (from CONTEXT.md `## Shape` + `## Scope edges` → In)

- The avatar-generation pipeline's hardcoded MOBA-champion / LoL-splash aesthetic director system prompt (currently `ARCHETYPE_SYSTEM_PROMPT` in `identity-avatar-batch.ts`) moves into the branding config as a **required free-text field**.
- A **numeric gamma-default field** joins the branding config alongside the director spec. Numeric, optional with a shipped fallback (CONTEXT `## Scope edges`: "gamma default field (numeric, optional with a shipped fallback)").
- The `paletteConstraintLine(hue)` injection is **split in two**:
  - **Mechanical hue → color-name mapping (`hueName()`) stays app-owned** and always-injected when a hue is set.
  - **Aesthetic instruction language moves into the seed director spec** (the "PALETTE CONSTRAINT (LOAD-BEARING)…" prose).
- **Boot-time presence check:** instance refuses to boot if the aesthetic director spec is missing or empty. **NO silent fallback. NO shipped-in default** for the director spec (the numeric gamma still has a shipped fallback).
- **Ship migration seeds BOTH existing deployments' branding configs atomically:** t1000 Skynet + T800 AI+ (Stacy's box). Either both boot after ship, or neither is shipped.
- Delete `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` + every file under `~/.claude/roles/box-maintainer/avatar-prompts/` (amelia.md, beatrice.md, becky.md, george.md).
- All outrigger content (Nelly handoff, Matrix media upload, colorHue-picking guidance, ashley-laptop archive notes) is retired.

### Claude's Discretion

- Exact schema field names for the new director-spec + gamma fields (suggestion: `avatarDirectorSpec: string` + `avatarGammaDefault: number` — flat, matches existing snake-flat `iconPath`/`wordmarkPath` style).
- Where the boot-time presence check fires (starter.ts IIFE vs. database.ts serverReady vs. a dedicated `assertBrandingConfigAtBoot()` module — see Findings §Q3).
- Cross-deployment migration mechanism: (a) tina writes both configs directly via SSH, (b) commit the seed file into the repo + Stacy pulls, (c) something else. CONTEXT.md `## Vehicle notes` line 77 explicitly defers this to the plan phase.
- Test surface: unit test on the loader shape guard, integration test on the batch route reading from config, boot-time test that the presence check exits non-zero.

### Deferred Ideas (OUT OF SCOPE)

- **UI edit affordance** for the new fields — file-only edit path, no settings UI.
- **Model swappability** — drafter chat model (`gpt-4o-mini`) + image model (`gpt-image-1`) both stay hardcoded.
- **Content validation beyond presence** — no length checks, no forbidden-content filters, no prompt-injection guards. Trust-the-admin.
- Nelly handoff / Matrix media upload flow changes.
- Birth flow colorHue picking changes.
- Multiple named preset aesthetics (LoL-champion, corporate-soft, etc.).
- Structured multi-axis aesthetic (medium / palette-family / posture).
- Per-user or per-namespace scoping of aesthetic control (branding config remains per-instance).
</user_constraints>

<phase_requirements>
## Phase Requirements

No REQ-ID mapping exists yet in `.planning/REQUIREMENTS.md` for Phase 74 (REQUIREMENTS.md is scoped to patch #43 pretty-view work; the avatar-style phase is roadmap-tracked in STATE.md line 524 but not requirement-ID'd). The phase is behaviorally-specified by the CONTEXT.md `## Scope edges` list. Planner should treat those six "In" bullets as the requirement set. If IDs are needed for traceability, a `STYLE-XX` prefix parallel to the existing patch-level prefixes would fit the house pattern.
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack** — React + TypeScript frontend; Node/Express backend on Drizzle ORM over AES-encrypted SQLite; Docker Compose; Caddy 2 edge. This phase does NOT touch the DB layer or Guacamole.
- **Commit hygiene** — atomic per-task commits, no squashes. Applies to the plan waves this phase produces.
- **Blast radius** — a bad deploy loses Ashley access to her whole fleet. Cross-deployment migration risk is highest-severity per this rule.
- **Encryption** — the director spec is NOT a credential and does NOT need encryption (it's a plaintext operator config file on disk, byte-analog to `branding.json` today).
- **Access model** — EC2 admin is AWS SSM only. Any t1000 seed step must be documented as "Ashley runs via SSM" not "tina SSHes in."
- **Nginx caveat** — this phase does NOT add any new HTTP routes. `/api/branding` already carries the extended schema for free via Phase 70's plumbing. **No new nginx blocks needed.** [VERIFIED: `/api/branding` proxy_pass exists in both `docker/nginx.conf` and `docker/nginx-https.conf` per Phase 70 Plan 02.]
- **GSD workflow enforcement** — planner must produce concrete plans; executor works through `/gsd-execute-phase`.

## Summary

The Phase 70 branding-config plumbing landed a complete pattern: a JSON config file at `/etc/skynet/branding/branding.json` (bind-mounted from host `/opt/skynet/branding/`), a `loadBrandingConfig()` never-throws loader with per-file fallback to bundled defaults at `/app/branding-defaults/`, an `isValidBrandingShape()` type guard, and an unauthenticated `GET /api/branding` route consumed at boot by the frontend store. Phase 74 extends this pattern with two new required-shape fields (the aesthetic director spec + a numeric gamma default), a **boot-time fail-fast** on the director spec, and a re-wire of `identity-avatar-batch.ts` to read both fields from the loader instead of the current in-file constants.

The load-bearing implementation choice: the existing loader is deliberately never-throws. Phase 74 needs a **new boot-time enforcement layer** that reads the config once at startup and calls `process.exit(1)` if the director spec is missing/empty. The right place is a new `assertBrandingConfigAtBoot()` function called from `starter.ts` inside the boot IIFE (which already has `process.exit(1)` on unhandled boot failure at L757/L764/L770), BEFORE the `database.ts` server-ready await. Loader itself stays never-throws so the `/api/branding` HTTP route can never crash.

Cross-deployment migration is the highest-risk piece. T800/AI+ is Stacy's box; she pulls the git fork and applies. If we ship the code change without seeding her `/opt/skynet/branding.json` on T800, her boot breaks. Ashley's shape file (line 77) explicitly defers the mechanism to the plan phase — the plausible paths are (a) tina uses her Skynet-relay account (`@tina:skynet.aithercloud.com` — established convention per `box-maintainer.md`) to DM Stacy a briefing that includes the seed config + apply instructions, or (b) tina touches both configs directly (rejected — box-maintainer.md L17 says explicitly "I do NOT operate on T800 directly"). Recommendation: commit the seed JSON as a repo artifact under `scripts/deploy/` AND DM Stacy the briefing.

**Primary recommendation:**
1. Extend `BrandingConfig` type (both backend loader + frontend store) with `avatarDirectorSpec: string` (required) and `avatarGammaDefault: number` (required in shape, defaults to `0.7` in the bundled default file).
2. Split the palette-constraint line: keep `hueName()` and a minimal mechanical `paletteHueLine(hue)` in-code; move the aesthetic prose into the seed director spec text.
3. Rewire the `POST /identities/avatar/batch` handler to `await loadBrandingConfig()` once per request, read `config.avatarDirectorSpec` + `config.avatarGammaDefault`, and use them in place of `ARCHETYPE_SYSTEM_PROMPT` + the hardcoded `0.7`. Delete both constants after the rewire.
4. Add `assertBrandingConfigAtBoot()` at `src/backend/branding/assert-boot.ts`. Call from `starter.ts` after `dbModule.initializeDatabase()` completes and before `dbServer` import.
5. **Cross-deployment migration** via committed seed JSON + Stacy briefing DM. Ivy owns T800 provisioning per feature-01 D-15 — she may need loop-in.
6. Delete the runbook + 4 archive files as a separate atomic commit-analog (they're outside the repo — `rm` operation, no `git rm`).
7. Scrub `identity-avatar-batch.ts` header comment references to the runbook (L16, L122, L180 — cited by grep).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Director-spec storage | Docker host (bind-mount) | Bundled defaults? **NO** — CONTEXT.md § "No silent fallback" | Files-on-disk, per Phase 70 pattern. Zero fallback per shape lock. |
| Gamma-default storage | Docker host (bind-mount) | Bundled default (`0.7` matching runbook § 5) | Numeric field, "optional with shipped fallback" per CONTEXT scope-edges. |
| Config parse + shape guard | Backend loader (`branding-config-loader.ts`) | — | Extend existing `isValidBrandingShape()` with two new fields. |
| Boot-time presence check | Backend startup (`starter.ts` IIFE) | — | Only place that can `process.exit(1)` cleanly; existing pattern L757/L764/L770. |
| Director-spec injection at request time | Backend route (`identity-avatar-batch.ts` POST /batch) | Loader | Fresh read per request — matches how OpenAI API key is read (per-request, not boot-cached — L242-246). |
| Palette hue → name mechanical fact | Backend (`identity-avatar-batch.ts` `hueName()`) | — | App-owned per CONTEXT.md § "app owns mechanics". Stays in-code. |
| Aesthetic instruction language | Config (`avatarDirectorSpec`) | — | Config-owned per CONTEXT.md § "config owns instructions". |
| Frontend consumption | **None** | — | The director spec never leaves the backend — it's not surfaced in the UI (out of scope: no UI edit affordance). The frontend `BrandingConfig` type still receives it via `/api/branding` (free-carried by Phase 70 plumbing) but no component reads it. |
| Cross-deployment seed | Human/operator (tina → Stacy briefing DM; Ashley on t1000 via SSM) | — | Both configs are ops-side files. Code change alone is insufficient. |
| Runbook file deletion | Local box role folder (`~/.claude/roles/box-maintainer/`) | — | Not in the repo tree; separate `rm` operation from code commits. |

## Standard Stack

### Core (all already installed, verified 2026-09-04 in `identity-avatar-batch.ts` imports + Phase 70 loader)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` | 5.2.1 | Route handler for `POST /identities/avatar/batch` | Already the framework; no change |
| `node:fs` (promises) | node 22 built-in | Config file read | Matches Phase 70 loader |
| `sharp` | already installed | Gamma correction | Existing dependency at `identity-avatar-batch.ts` L26 |
| `nanoid` | already installed | Candidate cache IDs | Existing dependency |

**No new dependencies needed.** [VERIFIED: codebase grep]. This phase is pure schema extension + wiring — the loader/route patterns already exist end-to-end.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fresh loader call per request | Cache config in module-scope at boot | Rejected: fresh call keeps hot-swap semantics from Phase 70 (operator can edit `branding.json` and next request picks it up). Loader is fast (small file, single `fs.readFile`). |
| `assertBrandingConfigAtBoot()` throws | Loader itself throws on missing directorSpec | Rejected: breaks Phase 70's never-throws contract, which the `/api/branding` HTTP route depends on for its belt-and-suspenders try/catch. Keep loader pure; add a separate boot-gate. |
| Content validation beyond presence | Regex / length / word-count checks | Explicitly rejected by CONTEXT.md (trust-the-admin). |
| Zod schema for the two new fields | Inline `typeof` guard extension | Match house style — Phase 70 uses inline `typeof` per `branding-config-loader.ts` L142-159. |

**Version verification:** All packages above already exist in the working tree — no `npm view` needed. The phase installs zero new packages.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages. Every needed capability (Express routing, JSON parsing, `sharp` gamma, `fs.promises` read, `useSyncExternalStore` subscribe, `vitest` mocking) already ships in the existing dependency graph and is proven load-bearing by prior phases.

## Architecture Patterns

### System Data-Flow Diagram

```
Docker host                     Container                              OpenAI API
───────────                     ─────────                              ──────────
/opt/skynet/branding/           /etc/skynet/branding/                       ▲
  branding.json      ────►        branding.json                             │
                                     │                                      │
                                     ▼                                      │
                              branding-config-loader.ts                     │
                              loadBrandingConfig()                          │
                              (never-throws + fallback)                     │
                                     │                                      │
                    ┌────────────────┼──────────────────┐                   │
                    │                │                  │                   │
                    ▼                ▼                  ▼                   │
              assert-boot.ts    /api/branding      identity-avatar-batch.ts │
              (Phase 74 NEW)    (Phase 70)         (Phase 74 REWIRED)       │
              startup gate      GET → frontend     POST /batch              │
              on directorSpec   store              ┌──────────────────────┐ │
                    │                              │ 1. loadBrandingConfig() │
                    │                              │ 2. read directorSpec │  │
        missing/empty ─► process.exit(1)           │ 3. append           │  │
                                                   │    paletteHueLine   │  │
                                                   │    (mechanical      │  │
                                                   │     only, in-code)  │  │
                                                   │ 4. call chat API    ├──┘
                                                   │    with spec+brief  │   ↑
                                                   │ 5. 3× image gens    ├───┤
                                                   │ 6. gamma            │
                                                   │    (use config's    │
                                                   │     gamma value)    │
                                                   └──────────────────────┘
```

### Recommended Project Structure

```
src/backend/branding/
├── branding-config-loader.ts       # MODIFY: extend BrandingConfig type + isValidBrandingShape()
├── assert-boot.ts                  # NEW: fail-fast check on avatarDirectorSpec
├── branding-config-loader.test.ts  # NEW: shape guard test for new fields (does not exist yet)
├── branding-routes.ts              # UNCHANGED: /api/branding auto-carries new fields
├── branding-routes.test.ts         # UNCHANGED
├── branding-template.ts            # UNCHANGED: still just needs config.appName
└── branding-template.test.ts       # UNCHANGED

src/backend/database/routes/
├── identity-avatar-batch.ts        # MODIFY: replace ARCHETYPE_SYSTEM_PROMPT constant with
│                                   #         per-request loadBrandingConfig() read;
│                                   #         split paletteConstraintLine into mechanical-only;
│                                   #         swap hardcoded 0.7 for config.avatarGammaDefault
└── identity-avatar-batch.test.ts   # MODIFY: mock loadBrandingConfig() in each test that runs
                                    #         the /batch path (currently 8+ tests fire the route)

src/backend/starter.ts              # MODIFY: call assertBrandingConfigAtBoot() after
                                    #         initializeDatabase() and before dbServer import

src/ui/branding/branding-store.ts   # MODIFY: extend BrandingConfig type mirror + sentinel default

docker/branding-defaults/
└── branding.json                   # MODIFY: add avatarDirectorSpec: "" (empty on purpose — see
                                    #         Pitfall 1) + avatarGammaDefault: 0.7

scripts/deploy/
└── branding-seed-example.json      # NEW (recommended): the LoL-champion seed as a repo artifact
                                    #                    so Ashley + Stacy have a canonical source

# Operator-side (outside repo tree, NO git touch):
/opt/skynet/branding/branding.json  # ON t1000 — MUST be seeded before ship (currently doesn't
                                    #             exist — bare bind-mount per Phase 70 D-14)
# ON T800 (Stacy's box, out-of-repo)  # Stacy applies via her patch-queue convention

# Local box role folder (NOT in repo — delete separately):
~/.claude/roles/box-maintainer/runbooks/avatar-flow.md            # DELETE (471 lines)
~/.claude/roles/box-maintainer/avatar-prompts/amelia.md           # DELETE (95 lines)
~/.claude/roles/box-maintainer/avatar-prompts/beatrice.md         # DELETE (134 lines)
~/.claude/roles/box-maintainer/avatar-prompts/becky.md            # DELETE (105 lines)
~/.claude/roles/box-maintainer/avatar-prompts/george.md           # DELETE (63 lines)
```

### Pattern 1: Extend `BrandingConfig` type + shape guard

**What:** Add two properties to the exported `BrandingConfig` type at `src/backend/branding/branding-config-loader.ts` L41-48 AND to the frontend mirror at `src/ui/branding/branding-store.ts` L50-57. Extend `isValidBrandingShape()` at L142-159 with two matching branches.

**When to use:** This is the only extension needed for a new required field — the entire loader/route/frontend chain already flows from this shape.

**Example (source: 74-CONTEXT.md decisions + branding-config-loader.ts L142-159 verbatim style):**

```typescript
// src/backend/branding/branding-config-loader.ts

export type BrandingConfig = {
  appName: string;
  shortName: string;
  iconPath: string;
  wordmarkPath: string;
  faviconPath: string;
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
  // Phase 74:
  avatarDirectorSpec: string;      // required non-empty — enforced by boot gate, not loader
  avatarGammaDefault: number;      // required in shape; sensible bundled default = 0.7
};

function isValidBrandingShape(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.appName !== "string") return false;
  if (typeof o.shortName !== "string") return false;
  if (typeof o.iconPath !== "string") return false;
  if (typeof o.wordmarkPath !== "string") return false;
  if (typeof o.faviconPath !== "string") return false;
  if (!Array.isArray(o.pwaIcons)) return false;
  for (const entry of o.pwaIcons as unknown[]) { /* … existing … */ }
  // Phase 74:
  if (typeof o.avatarDirectorSpec !== "string") return false;
  if (typeof o.avatarGammaDefault !== "number" || !Number.isFinite(o.avatarGammaDefault)) return false;
  return true;
}
```

Also update `HARDCODED_FALLBACK` at L64-74 with `avatarDirectorSpec: ""` and `avatarGammaDefault: 0.7`. Also update the frontend sentinel at `src/ui/branding/branding-store.ts` L66-78 with the same two field additions.

### Pattern 2: Boot-time fail-fast (NEW module)

**What:** A separate `src/backend/branding/assert-boot.ts` module that calls `loadBrandingConfig()` once, checks whether `avatarDirectorSpec` is missing-or-empty-after-trim, and if so, logs a structured fatal + exits.

**When to use:** ONLY for hard-required fields where CONTEXT.md says "no silent fallback" (currently only `avatarDirectorSpec`).

**Example:**

```typescript
// src/backend/branding/assert-boot.ts (NEW)

import { loadBrandingConfig } from "./branding-config-loader.js";
import { systemLogger } from "../utils/logger.js";

/**
 * Phase 74: instance refuses to boot if avatarDirectorSpec is missing/empty.
 * No silent fallback — CONTEXT.md § "What would make it wrong" §5.
 *
 * Called from starter.ts after DB init, before dbServer import. Follows the
 * existing starter.ts fail-fast pattern (L757, L764, L770) — structured error
 * log + process.exit(1) so the container's supervisor restarts and Ashley
 * sees the failed-boot log line.
 */
export async function assertBrandingConfigAtBoot(): Promise<void> {
  const config = await loadBrandingConfig();
  const spec = (config.avatarDirectorSpec ?? "").trim();
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

**Boot integration** (source: `src/backend/starter.ts` L262-266 for the pattern):

```typescript
// src/backend/starter.ts (INSIDE the boot IIFE, ~L262 after initializeDatabase)

const { assertBrandingConfigAtBoot } = await import(
  "./branding/assert-boot.js"
);
await assertBrandingConfigAtBoot();  // process.exit(1) if directorSpec missing
```

### Pattern 3: Rewire the batch route to read config

**What:** Replace the module-scope `ARCHETYPE_SYSTEM_PROMPT` constant read with a per-request `loadBrandingConfig()` call inside the `POST /batch` handler.

**When to use:** Any per-request use of an operator-owned config value. Fresh-read matches how `OPENAI_API_KEY` is read at request time (see `identity-avatar-batch.ts` L242-246).

**Example (source: existing route at L204-376, MODIFIED):**

```typescript
// src/backend/database/routes/identity-avatar-batch.ts

// REMOVE the ARCHETYPE_SYSTEM_PROMPT constant at L183-198 entirely.
// REMOVE the aesthetic prose from paletteConstraintLine() at L174-177.
// KEEP hueName() at L162-172 verbatim (mechanical, app-owned).

import { loadBrandingConfig } from "../../branding/branding-config-loader.js";

// NEW: mechanical-only palette hue line — no aesthetic instruction language.
function paletteHueLine(hue: number | null): string {
  if (hue === null) return "";
  return `\n\nIdentity color hue: ${hue}° (reads as ${hueName(hue)}).`;
}

// Inside router.post("/batch", ...):
router.post("/batch", authenticateJWT, async (req, res) => {
  // ... existing input validation ...
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "OpenAI not configured" }); return; }

  // Phase 74: read branding-config for aesthetic director spec + gamma.
  const branding = await loadBrandingConfig();
  const directorSpec = branding.avatarDirectorSpec;
  const gammaValue = branding.avatarGammaDefault;

  // ... archetype-draft call, but with `directorSpec` in the system slot:
  const archRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    // ... headers ...
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: directorSpec },
        {
          role: "user",
          content: `Name: ${name}\nTitle: ${title}\nBrief: ${brief}${paletteHueLine(paletteHue)}\n\nProduce the image-generation prompt only. No preamble. No explanation. Just the prompt.`,
        },
      ],
    }),
    // ...
  });

  // ... 3× image gens unchanged ...

  // Phase 74: gamma value from config, not hardcoded.
  gammaCorrected = await Promise.all(
    b64Results.map(async (b64) => {
      const pngBuffer = Buffer.from(b64, "base64");
      return applyGammaValue(pngBuffer, gammaValue);  // param'd version of applyGamma07
    }),
  );
  // ...
});
```

The current `applyGamma07()` at L133-150 becomes `applyGammaValue(pngBuffer, gamma)` with the hardcoded `0.7` swapped for the parameter. The `_applyCorrectionForTest()` test-helper (L577-593) needs the same parameterization.

### Anti-Patterns to Avoid

- **Falling back to the constant if config is missing.** CONTEXT.md § "What would make it wrong" §5 explicitly rejects this: "If the aesthetic director spec ends up read at avatar-generation time from a source other than the branding config, a stale fallback silently defeats the whole point." Delete the constant entirely — no `const FALLBACK_ARCHETYPE = "…";` lurking anywhere.
- **Caching the config in module scope at boot.** Loses Phase 70's hot-swap property. Fresh per-request read is cheap (single small `fs.readFile`) and matches how `OPENAI_API_KEY` is read.
- **Shipping a "presence check" that passes on `"   "` (whitespace-only).** CONTEXT.md § "What would make it wrong" §3: whitespace-only string passing the check would defeat the guardrail. Trim before length-check.
- **Silent partial migration.** If the ship goes out without Stacy's config seeded, her boot breaks. This is asymmetric-risk territory (per CLAUDE.md "Blast radius"). Either both configs seed atomically, or the ship holds.
- **Bundling a shipped-in default director spec into `docker/branding-defaults/branding.json`.** This would make Phase 70's per-file bundled-default fallback silently rescue a missing operator config — exactly the "silent fallback" CONTEXT.md rejects. **The bundled default MUST have `avatarDirectorSpec: ""` (empty string)** so the boot gate catches it and refuses to start when no operator config is present. **This is a behavior change from Phase 70's D-14 contract on t1000** (which currently boots cleanly with no host config) — Phase 74 breaks that for t1000 unless a t1000 config is seeded at ship time. See Runtime State Inventory below.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config load + parse + shape check | New JSON reader | Extend existing `loadBrandingConfig()` + `isValidBrandingShape()` | Phase 70 pattern is proven — same never-throws contract, same fallback chain |
| Boot-time fail-fast | New signal/process management | `process.exit(1)` from starter.ts IIFE | Existing pattern at L757/L764/L770; container supervisor already restarts on non-zero exit |
| Frontend fetch of new field | Custom hook / component | Just read `useBrandingConfig().avatarDirectorSpec` if ever needed | Frontend store auto-carries the new field once type is extended (though CONTEXT.md says no UI, so this will never fire) |
| Cross-deployment sync | Ad-hoc SSH scripts | Stacy briefing DM per box-maintainer convention (`~/.claude/roles/box-maintainer/box-maintainer.md` L100+; `agent-supervisor-handoff.md` L100+) | box-maintainer.md L17 says explicitly "I do NOT operate on T800 directly." Stacy pulls the fork and gates on her side. |
| Test mocking of the loader | Manual patching | `vi.mock("../../branding/branding-config-loader.js")` at test-file top | Vitest already does this in `identity-avatar-batch.test.ts` for the auth-manager module (L33-52) — same pattern applies to the loader |

**Key insight:** The Phase 70 wiring is the standard. Every extension pattern this phase needs already exists in `.planning/phases/70-branding-config/70-PATTERNS.md` and `70-RESEARCH.md`. The planner should reference those two docs before writing any new pattern reasoning.

## Runtime State Inventory

This phase is **not primarily a rename/refactor**, but it does change runtime behavior in ways that alter the state of running deployments. Explicit inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — the branding config file is the sole storage; no DB rows, no other datastores reference the director spec. Verified: `grep -r "avatarDirectorSpec\|ARCHETYPE_SYSTEM_PROMPT" /home/ubuntu/skynet-tina/src` returns only `identity-avatar-batch.ts` self-references. | None |
| Live service config | **t1000 `/opt/skynet/branding/branding.json`** currently DOES NOT EXIST (per Phase 70 D-14 — t1000 uses bundled defaults). After Phase 74 ships, t1000's boot gate will refuse to start unless this file is created with a valid `avatarDirectorSpec`. Similarly for **T800 `/opt/skynet/branding/branding.json`** — Stacy's AI+ config exists (per feature-01 D-15) but does not contain the new fields. | **BOTH configs must be seeded (or created) with the LoL-champion director spec + gamma=0.7 in the same ship as the code change. Otherwise both boxes crash-loop.** Data migration (add new field to existing operator config) is required for T800; file-creation is required for t1000. Both are ops-side, out of repo. |
| OS-registered state | **None** — no launchd, systemd, or Windows Task Scheduler entries reference the director spec by name | None |
| Secrets/env vars | **None** — `OPENAI_API_KEY` is unaffected; no new env vars introduced | None |
| Build artifacts | **`docker/branding-defaults/branding.json`** ships inside the container image via `Dockerfile` COPY. Must be updated to add the two new fields — `avatarDirectorSpec: ""` (empty, so boot gate fires) and `avatarGammaDefault: 0.7`. Rebuild image on ship. | Rebuild container image (`docker compose up -d --build`). Ivy's provisioning of new AI+ boxes (feature-01 D-15) needs to be aware that no-config-file is no longer valid — a config MUST be dropped or the box won't boot. |

**Nothing found in category "Stored data":** verified via grep for `avatarDirectorSpec`, `avatarGamma`, `ARCHETYPE_SYSTEM_PROMPT` across `src/**/*.ts` — the constant is self-contained in `identity-avatar-batch.ts` and referenced nowhere else. `identity-birth.ts` L39 and `identity-clone.ts` L120 only import `getCandidateForBirth`/`consumeCandidateForBirth` (verified 2026-09-04).

## Common Pitfalls

### Pitfall 1: The `docker/branding-defaults/branding.json` file becomes a silent fallback

**What goes wrong:** Well-meaning implementation seeds the bundled default with the LoL-champion spec (thinking "this is a safety net"). Result: a deployment with no operator config silently gets the LoL aesthetic, defeating the whole point of the boot gate.

**Why it happens:** Phase 70's per-file fallback is baked into `loadBrandingConfig()` — if `/etc/skynet/branding/branding.json` is missing, it returns `getBundledDefaults()`. Loader can't tell the difference between "operator didn't set this" and "operator explicitly set this to the default."

**How to avoid:** Bundled default MUST have `avatarDirectorSpec: ""` (empty string). Boot gate trims + length-checks. Documentation comment adjacent to the field in `docker/branding-defaults/branding.json` explaining this is intentional. Also update the `HARDCODED_FALLBACK` constant at `branding-config-loader.ts` L64-74 with the same `""` value.

**Warning signs:** Any planning discussion of "what should the shipped default director spec look like" is a red flag — the shipped default is the empty string, deliberately.

### Pitfall 2: Loader shape violation on runtime edit → route 5xx cascade

**What goes wrong:** `isValidBrandingShape()` rejects a config where operator typo'd `avatarGammaDefault: "0.7"` (string instead of number). Loader returns bundled defaults (which have empty `avatarDirectorSpec`). Boot gate at startup passes because the app already booted successfully once; only new requests hit the loader. Next avatar batch call reads bundled defaults, gets empty spec, tries to call OpenAI with empty system prompt, gets weird upstream response.

**Why it happens:** Boot gate fires ONCE at startup. If operator edits `branding.json` at runtime and introduces a shape violation, the loader silently reverts to bundled defaults (Phase 70 pattern), which have empty spec.

**How to avoid:** Consider adding a second guard **inside the `/batch` handler**: after `loadBrandingConfig()`, re-check `directorSpec.trim().length > 0`. If not, return `503 { error: "avatar generation misconfigured" }` — same status code the route already uses for missing `OPENAI_API_KEY` at L244. This is defense-in-depth, not a replacement for the boot gate.

**Warning signs:** Any planning that treats the boot gate as the sole enforcement point — Phase 70's loader semantics mean runtime config edits can bypass it.

### Pitfall 3: Cross-deployment migration coordination gap

**What goes wrong:** The code change lands in the fork on `main`. Ashley ships to t1000. She has the seed config ready and drops it into `/opt/skynet/branding/branding.json` before deploy — t1000 boots. Stacy pulls the fork on T800 without receiving the seed config. T800 boot gate fires, box crash-loops. Aither users lose access.

**Why it happens:** Two production deployments, two different operators (Ashley on t1000, Stacy on T800). Code moves through git; ops-side config files don't. box-maintainer.md L100+ establishes the Stacy-briefing pattern for supervisor + id-skill changes, but this phase is a Skynet code change with an *ops-side seed dependency* — a category not yet covered by that convention.

**How to avoid:** Plan phase must produce a concrete migration artifact — a repo file at `scripts/deploy/branding-seed-example.json` containing the LoL-champion seed, PLUS a Stacy briefing DM on the Skynet relay (`@tina:skynet.aithercloud.com` → `@stacy:skynet.aithercloud.com`) that points to the file + gives apply instructions Stacy can run on her side. Ashley should NOT ship to t1000 until Stacy acks receipt. The `/close` step should verify both deployments booted post-ship.

**Warning signs:** Any plan-phase artifact that says "Stacy will figure out the seed" or defers seed generation to Stacy's discretion. The seed is a single JSON blob — commit it to a plan-adjacent file so Stacy can lift verbatim.

### Pitfall 4: Test suite silently uses old `ARCHETYPE_SYSTEM_PROMPT` behavior

**What goes wrong:** `identity-avatar-batch.test.ts` has 8+ tests that fire the `/batch` route (Tests 1-9 + CR-06 eviction tests + manual upload tests). All currently pass because the constant is baked into the module. After Phase 74 rewires the route to `await loadBrandingConfig()`, tests that don't mock the loader will read the actual `/etc/skynet/branding/branding.json` (which doesn't exist in the test container) → loader returns bundled defaults → empty `avatarDirectorSpec` → chat API called with empty system prompt → mock still returns canned response → test passes but exercises no meaningful branching.

**Why it happens:** Vitest's fake filesystem doesn't cover `/etc/skynet/branding/branding.json`, and the loader silently returns bundled defaults on ENOENT.

**How to avoid:** Add `vi.mock("../../branding/branding-config-loader.js")` at the top of `identity-avatar-batch.test.ts` (mirroring the existing `vi.mock("../../utils/auth-manager.js")` at L33-52). Return a full `BrandingConfig` with a non-empty `avatarDirectorSpec` so tests exercise the real path. Add one NEW test that verifies the loader IS called on each request (spy on the mock's call count). Add one NEW test that verifies the /batch handler returns 503 (or the chosen error status) when `avatarDirectorSpec` is empty at runtime (Pitfall 2 defense-in-depth check).

**Warning signs:** Existing tests still pass green immediately after the wiring change without any test-file modification. This is the "silent success" failure mode — the tests are running but not testing the new contract.

### Pitfall 5: Deleting the runbook + archive files as a git commit

**What goes wrong:** Tina makes the runbook + archive deletions part of a code plan. They're outside the repo (`~/.claude/roles/box-maintainer/`), so `git rm` fails silently or the commit is empty for those paths.

**Why it happens:** Local box role folder is not in the Skynet repo. CONTEXT.md § "runbook file to delete" line 78 says the runbook is "local to this box's role folder, not distributed."

**How to avoid:** The plan should have a separate wave/plan that runs `rm` commands on `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` + 4 files under `~/.claude/roles/box-maintainer/avatar-prompts/`. These are NOT git operations. Verify all references to those paths in the codebase get removed too — greps show 6+ references in `.planning/phases/20-*` (historical, safe to leave as-is since they were the pre-Phase-20 spec source) and 3 references in `identity-avatar-batch.ts` header comments (L16, L122, L180) that should be scrubbed.

### Pitfall 6: The palette-instruction migration is under-specified

**What goes wrong:** The current `paletteConstraintLine()` returns a long paragraph that mixes mechanical fact ("the identity's chosen hue on the HSL color wheel is X degrees, which reads as Y") with aesthetic instruction ("MUST center on this hue — dominant color and rim-light in Y, accents within roughly ±30 degrees of X°. Do NOT default to blue / cyan just because the background reads cyberpunk-adjacent"). If the split is done crudely, the seeded director spec ends up with orphaned instruction language ("this hue" — which hue?) that references a mechanical fact only available at request time.

**Why it happens:** The current text is written as if the mechanical fact is right there in the same sentence. Splitting cleanly requires rewriting the aesthetic prose to reference "the hue provided" generically, while keeping the mechanical `paletteHueLine()` succinct.

**How to avoid:** Plan phase should draft the actual seed text at planning time (not defer to execution). Show Ashley/discuss-phase the exact string. The seed's palette instruction should read like:

> "PALETTE INSTRUCTION: When the identity color hue is supplied in the user message, the drafted image-gen prompt's palette section MUST center on that hue — dominant color and rim-light in that hue, accents within roughly ±30 degrees. Do NOT default to blue/cyan just because the background reads cyberpunk-adjacent. The generated avatar has to match the identity's UI badge and chat-bubble tint, which are driven from this same hue."

And the mechanical line at request time becomes just:
> "Identity color hue: 275° (reads as purple / violet)."

## Code Examples

### Reading branding-config from a backend route (verified pattern from Phase 70)

```typescript
// Source: src/backend/branding/branding-routes.ts L54-68
import { loadBrandingConfig } from "./branding-config-loader.js";

router.get("/api/branding", async (_req: Request, res: Response) => {
  try {
    const config = await loadBrandingConfig();
    res.setHeader("Cache-Control", NO_STORE_CACHE);
    return res.status(200).json(config);
  } catch (err) {
    // loadBrandingConfig() is never-throws; the try/catch is belt-and-suspenders
    return res.status(200).json(getBundledDefaults());
  }
});
```

### Fail-fast at boot (verified pattern from starter.ts)

```typescript
// Source: src/backend/starter.ts L753-771 — existing pattern for fatal errors
process.on("uncaughtException", (error) => {
  systemLogger.error("Uncaught exception occurred", error, {
    operation: "error_handling",
  });
  process.exit(1);
});
// ...
} catch (error) {
  systemLogger.error("Failed to initialize backend services", error, {
    operation: "startup_failed",
  });
  process.exit(1);
}
```

The Phase 74 pattern mirrors this: structured error log + `process.exit(1)`. No throwing to a caller — the boot IIFE has a catch-all that would just log and exit anyway.

### Mocking the branding loader in tests (adapted from existing vitest pattern)

```typescript
// Adapted from src/backend/database/routes/identity-avatar-batch.test.ts L33-52 pattern
vi.mock("../../branding/branding-config-loader.js", () => ({
  loadBrandingConfig: async () => ({
    appName: "Skynet",
    shortName: "Skynet",
    iconPath: "/branding/icon.png",
    wordmarkPath: "/branding/wordmark.png",
    faviconPath: "/branding/favicon.svg",
    pwaIcons: [
      { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    avatarDirectorSpec: "TEST DIRECTOR SPEC — not the real thing",
    avatarGammaDefault: 0.7,
  }),
  getBundledDefaults: () => ({ /* same shape as above */ }),
}));
```

## State of the Art

**Not applicable.** This is not a technology-choice phase. Every technology piece already exists in the repo. The "state of the art" is entirely internal — the Phase 70 patterns.

## Key File-and-Line References (for planner `<read_first>` lists)

### Files to READ before planning

| File | Lines | Why |
|------|-------|-----|
| `src/backend/database/routes/identity-avatar-batch.ts` | 1-596 (full) | The primary rewire target — router, constants, gamma helper, and cache helpers all live here |
| `src/backend/branding/branding-config-loader.ts` | 1-300 (full) | The loader to extend — `BrandingConfig` type at L41-48, `HARDCODED_FALLBACK` at L64-74, shape guard at L142-159 |
| `src/backend/branding/branding-routes.ts` | 1-169 (full) | Understand how `/api/branding` publishes the config — no changes needed but context matters |
| `src/backend/branding/branding-template.ts` | 1-100 (full) | Sibling module using the same loader — pattern reference |
| `src/ui/branding/branding-store.ts` | 1-165 (full) | Frontend mirror of `BrandingConfig` type at L50-57, sentinel at L66-78 |
| `src/backend/starter.ts` | 167-773 (boot IIFE) | Where the boot gate call goes — insertion point around L262-266 |
| `src/backend/database/database.ts` | 1885-2189 | Route mounts + `serverReady` promise; understand mount order |
| `docker/branding-defaults/branding.json` | 1-12 (full) | The bundled default to modify |
| `.planning/phases/70-branding-config/70-RESEARCH.md` | Full | Prior-art research; this phase's patterns are extensions of Phase 70's patterns |
| `.planning/phases/70-branding-config/70-PATTERNS.md` | Full | Pattern map from Phase 70 — every extension pattern here has an analog cited |
| `.planning/phases/70-branding-config/70-01-SUMMARY.md` | Full | How the loader landed (implementation reference) |
| `.planning/phases/70-branding-config/70-03-SUMMARY.md` | Full | How the frontend store landed |
| `src/backend/database/routes/identity-avatar-batch.test.ts` | 1-750 (full) | Test file to modify — 8+ tests need loader mocks |
| `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` | 1-471 (full) | Confirm all outrigger content is retired before deletion (per CONTEXT.md § "scope check during execution should re-verify nothing has quietly become live-again") |
| `~/.claude/roles/box-maintainer/box-maintainer.md` | 1-120 | Stacy-briefing convention (L100+) for cross-deployment migration reasoning |

### Files to WRITE (new)

| File | Purpose |
|------|---------|
| `src/backend/branding/assert-boot.ts` | Boot-time fail-fast module (~30 lines) |
| `src/backend/branding/branding-config-loader.test.ts` | Shape guard test for the two new fields — this test file does not exist yet |
| `scripts/deploy/branding-seed-example.json` (recommended) | Canonical seed containing the LoL-champion spec + gamma=0.7, for both Ashley (t1000) and Stacy (T800) to apply |

### Files to DELETE (outside repo, `rm` not `git rm`)

| File | Lines |
|------|-------|
| `~/.claude/roles/box-maintainer/runbooks/avatar-flow.md` | 471 |
| `~/.claude/roles/box-maintainer/avatar-prompts/amelia.md` | 95 |
| `~/.claude/roles/box-maintainer/avatar-prompts/beatrice.md` | 134 |
| `~/.claude/roles/box-maintainer/avatar-prompts/becky.md` | 105 |
| `~/.claude/roles/box-maintainer/avatar-prompts/george.md` | 63 |

### Text scrub sites in existing code (references to the deleted runbook)

| File | Lines | Text to scrub |
|------|-------|--------------|
| `src/backend/database/routes/identity-avatar-batch.ts` | 16 | "output = input^0.7 per the avatar-flow runbook § 5" → rewrite as "output = input^gamma per the operator's `avatarGammaDefault`" |
| `src/backend/database/routes/identity-avatar-batch.ts` | 122 | "Applies gamma 0.7 per the avatar-flow runbook § 5:" → rewrite as "Applies operator-configured gamma per branding config:" |
| `src/backend/database/routes/identity-avatar-batch.ts` | 180 | "// Archetype system prompt (adapted from avatar-flow runbook § 2-3)" → DELETE (constant is being removed anyway) |

Also `.planning/phases/20-*` has 6-8 references to the runbook — these are historical planning artifacts and should be LEFT ALONE (they document what shipped as Phase 20; scrubbing them would rewrite history).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Stacy pulls the fork on T800 and applies patches per the box-maintainer.md L100+ "Stacy-briefing convention" pattern (established for supervisor + id-skill categories, extending here to Skynet code changes with ops-side seed dependencies). | Cross-deployment migration | [ASSUMED — box-maintainer.md establishes convention for supervisor/id-skill; Skynet code changes may or may not follow same route]. Wrong → migration seed doesn't reach Stacy, T800 crash-loops on boot after ship. **Ashley + Stacy must confirm at plan-phase discussion.** |
| A2 | Ivy owns t1000 and T800 initial provisioning per feature-01 D-15, but ongoing config edits (like the Phase 74 seed) are the operator's responsibility (Ashley on t1000, Stacy on T800). | Cross-deployment migration | [ASSUMED — inferred from feature-01 D-15 language "at EC2 provisioning time" implying one-shot install, not ongoing edits]. Wrong → Ivy needs loop-in for the seed application. |
| A3 | The bundled-default `avatarGammaDefault: 0.7` value comes from the runbook § 5 default AND matches the current hardcoded `applyGamma07()` behavior. | Standard Stack | [VERIFIED: codebase grep + runbook read — `Math.pow(data[i] / 255, 0.7)` at `identity-avatar-batch.ts` L142] |
| A4 | `identity-birth.ts` and `identity-clone.ts` import only `getCandidateForBirth` + `consumeCandidateForBirth` from `identity-avatar-batch.ts`, NOT the archetype constants or paletteConstraintLine. | Runtime State Inventory | [VERIFIED: grep for ARCHETYPE_SYSTEM_PROMPT / paletteConstraintLine — only self-references in identity-avatar-batch.ts]. Confirmed safe to delete/replace the constant. |
| A5 | The Stacy briefing DM is a viable delivery mechanism for a JSON config seed (not just a supervisor/id-skill .patch file). | Cross-deployment migration | [ASSUMED — extension of the convention beyond its documented scope]. If the convention is code-patch-only, an alternative like "commit a scripts/deploy/branding-seed-example.json into the repo with a README pointer" may be needed. Recommendation: do BOTH — commit AND DM. |
| A6 | Ashley wants the LoL-champion director spec preserved verbatim as the initial seed for both deployments (implied by CONTEXT.md § "Ship migration seeds BOTH existing deployments' branding configs … with the current LoL-champion director spec"), not a *modified* or *simplified* version. The palette-instruction language folds in as an inline paragraph. | Phase Requirements | [ASSUMED — CONTEXT.md uses "current LoL-champion director spec" which suggests verbatim from `ARCHETYPE_SYSTEM_PROMPT` L183-198 + the aesthetic prose from `paletteConstraintLine` L176]. Plan phase should draft the exact seed text and confirm with Ashley. |
| A7 | The palette-instruction language that moves into the director spec should be embedded such that the mechanical `paletteHueLine()` fact + the spec's aesthetic language compose gracefully at request time (both are appended to the chat-model user message today per L268). | Pattern 3 + Pitfall 6 | [ASSUMED — the current architecture has the aesthetic language in the user message via `paletteConstraintLine()`; after the split the aesthetic language lives entirely in the system-prompt directorSpec while the mechanical fact stays in the user message]. Plan should draft + confirm this composition. |
| A8 | The behavior change to t1000 (Phase 70 D-14 no-op-with-no-config → Phase 74 must-have-config) is acceptable to Ashley because CONTEXT.md § "No silent fallbacks" locks the direction. | Runtime State Inventory + Pitfall 1 | [ASSUMED via CONTEXT.md text]. Wrong → Ashley wants a t1000 fallback path back in, plan needs a different shape. |
| A9 | The `avatarDirectorSpec` field is not surfaced to the frontend for display — the frontend `BrandingConfig` type mirrors it only because `/api/branding` publishes the whole config, but no React component reads it. | Architectural Responsibility Map | [ASSUMED via CONTEXT.md OUT-OF-SCOPE "no UI edit affordance"]. Verified by: no existing frontend consumer references `ARCHETYPE_SYSTEM_PROMPT` or an equivalent — grep for `director` / `archetype` in `src/ui/**/*.tsx` returns zero hits. |

## Open Questions

1. **Where exactly does the aesthetic palette prose land inside the seeded director spec?**
   - What we know: `paletteConstraintLine()` current text (`identity-avatar-batch.ts` L176) is the aesthetic prose that needs to migrate. `ARCHETYPE_SYSTEM_PROMPT` (L183-198) is the base spec.
   - What's unclear: Is the seed director spec `ARCHETYPE_SYSTEM_PROMPT + "\n\n" + <aesthetic-palette-prose>`, or does the aesthetic-palette-prose weave into the archetype spec at specific bullet-point (e.g. under "Specify the palette")?
   - Recommendation: The seed is the current `ARCHETYPE_SYSTEM_PROMPT` text with an inline "PALETTE INSTRUCTION:" paragraph inserted near the palette bullet, phrased so the mechanical hue fact from `paletteHueLine()` at request time makes sense as its concrete instance. Ashley should eyeball the drafted seed at plan-phase discussion.

2. **Does the boot gate need to check `avatarGammaDefault` too?**
   - What we know: CONTEXT.md says gamma is "numeric, optional with a shipped fallback." A missing/invalid gamma means bundled default (0.7) is used.
   - What's unclear: If operator sets `avatarGammaDefault: null` or `avatarGammaDefault: -5`, does the app boot? Loader's shape guard requires it be a `number` (Finite). Negative or zero would technically pass the shape but produce nonsense output.
   - Recommendation: Loader shape guard rejects non-finite. Route reads value and uses it as-is (trust-the-admin per shape). No additional boot gate needed. If a value outside `[0.1, 3.0]` shows up, that's on the admin.

3. **Cross-deployment migration mechanism — commit the seed into the repo, or DM-only?**
   - What we know: CONTEXT.md § "Vehicle notes" line 77 leaves this to plan phase. box-maintainer.md establishes the Stacy-briefing convention for supervisor + id-skill categories.
   - What's unclear: Whether Stacy prefers a DM'd seed she applies manually, or a committed file at `scripts/deploy/branding-seed-example.json` she can cherry-pick / diff.
   - Recommendation: DO BOTH. Commit `scripts/deploy/branding-seed-example.json` (with the LoL-champion spec + gamma=0.7) into the repo as the durable artifact + include it as the payload of the Stacy DM briefing. Stacy pulls the fork, gets the seed file in the tree, applies to `/opt/skynet/branding/branding.json` on T800. tina asks in advance for Stacy's preferred path.

4. **What happens on a t1000 deploy if the operator forgets to seed `/opt/skynet/branding/`?**
   - What we know: Phase 70's D-14 contract said "no host config = bundled defaults = current behavior." Phase 74 breaks D-14 for t1000 by adding a boot-required field.
   - What's unclear: Whether Ashley wants a runtime warning + fallback for the first t1000 deploy, or wants the hard-fail to force her to seed the config.
   - Recommendation: Hard-fail is correct per CONTEXT.md § "No silent fallback." Plan phase should explicitly call out that Ashley needs to `sudo mkdir -p /opt/skynet/branding && cat > /opt/skynet/branding/branding.json <<EOF …EOF` via SSM (per CLAUDE.md access model) before ship. Include this in the ship checklist.

5. **Where does the frontend BrandingConfig type mirror update land — same plan wave as the backend loader extension, or a separate frontend-only wave?**
   - What we know: Frontend never CONSUMES the new fields (no UI), but the type must match or TypeScript blows up on the `/api/branding` fetch.
   - Recommendation: Same wave as the backend loader — treat the type as one atomic contract across the two files. Add matching `avatarDirectorSpec` + `avatarGammaDefault` to the frontend sentinel too (even though they'll never render), to keep the two shapes in strict lockstep.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `sharp` | Gamma correction | ✓ | already in package.json | — |
| `node:fs` + `node:path` | Config load + path resolution | ✓ | built-in | — |
| Docker | Container build to include new bundled defaults | ✓ | on t1000 build box | — |
| `vitest` + `@vitest/*` | Test running | ✓ | in devDeps | — |
| Access to T800 (Stacy's box) | Cross-deployment migration | ✗ (per box-maintainer.md L17: "I do NOT operate on T800 directly") | — | Stacy briefing DM per box-maintainer.md L100+ convention |
| Skynet relay account `@tina:skynet.aithercloud.com` | DM Stacy | Unknown (assumed present per convention) | — | If missing, tina's identity self-register per box-maintainer.md L46 |

**Missing dependencies with fallback:**
- Direct T800 access — mitigated by Stacy-briefing DM pattern. Expected and non-blocking; it just constrains the migration mechanism.
- Skynet relay account (if not yet registered for tina) — one-shot register per box-maintainer.md's established pattern.

**Missing dependencies with no fallback:** None. All hard dependencies exist.

## Security Domain

Config policy: `.planning/config.json` sets `workflow.security_enforcement: true` with `security_asvs_level: 1`. This section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | The affected route (`POST /identities/avatar/batch`) already runs under `authenticateJWT` (unchanged). The new backend surfaces (`assertBrandingConfigAtBoot`) run pre-network. |
| V3 Session Management | no | Not a session-touching change. |
| V4 Access Control | no | The route's userId-scoping (candidate cache, per-user cap) is unchanged. Loader is pure I/O against a container-internal file. |
| V5 Input Validation | yes | The new fields are operator-controlled config values. `isValidBrandingShape()` extends per Pattern 1 to type-check `avatarDirectorSpec: string` and `avatarGammaDefault: number` (Finite). No content validation beyond presence per CONTEXT.md (trust-the-admin). Boot gate trims + length-checks the spec. |
| V6 Cryptography | no | No new secrets or crypto operations. |
| V13 API Security | yes (light) | The `/api/branding` route already publishes the whole config to the frontend (unauthenticated pre-login surface). The `avatarDirectorSpec` field will now be included in that response. Confirm no user-secret content ends up in the seed (it won't — the LoL-champion spec is public/aesthetic text). Also confirm the trust-the-admin ethos accepts that any hostile admin could inject prompt-injection payloads that gpt-4o-mini reflects — this is IN-scope-for-admin-trust per CONTEXT.md. |

### Known Threat Patterns for `{Skynet backend / Express / branding-config}`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via operator-controlled `avatarDirectorSpec` (admin sets spec to `"Ignore previous instructions and…"`) | Tampering + Elevation | ACCEPTED per CONTEXT.md § "Deferred: content validation on the director spec beyond presence" + § "Trust the admin who writes the branding config". No mitigation required. Document as accepted risk in plan's Security section. |
| Empty-string / whitespace-only director spec bypassing boot gate | Denial of Service (silent degradation) | Boot gate at `assertBrandingConfigAtBoot()` trims + length-checks. Route handler adds defense-in-depth 503 on empty spec at request time. |
| Malformed `avatarGammaDefault` (string / NaN / negative) → runtime crash in `sharp` | Denial of Service | Loader shape guard rejects non-finite; falls back to bundled `0.7`. Sharp handles values in `[0.001, 8]` per its docs; extreme values produce ugly but non-crashing output. |
| Cross-user config leak via `/api/branding` (unauthenticated route) | Info Disclosure | Not applicable — director spec is not a user-scoped value. Config is per-instance, public in intent (drives all avatar generation). |
| Silent bundled-default fallback masking missing operator config on t1000 | Tampering (of expected behavior) | See Pitfall 1 — bundled default MUST have `avatarDirectorSpec: ""` so boot gate fires. This is the primary defense. |
| Migration seed lost in transit to Stacy → T800 crashes on boot | Denial of Service (whole fleet) | Cross-deployment migration is CLAUDE.md "Blast radius" territory. Plan-phase must produce a Stacy-briefing DM + repo-committed seed artifact + verified two-side ack. |

## Sources

### Primary (HIGH confidence)
- `/home/ubuntu/skynet-tina/.planning/phases/74-control-style-of-avatar-generation-through-branding-config/74-CONTEXT.md` — the locked shape for this phase (full read)
- `/home/ubuntu/skynet-tina/src/backend/database/routes/identity-avatar-batch.ts` — the primary rewire target (full read)
- `/home/ubuntu/skynet-tina/src/backend/database/routes/identity-avatar-batch.test.ts` — test surface to modify (full read)
- `/home/ubuntu/skynet-tina/src/backend/branding/branding-config-loader.ts` — Phase 70 loader (full read)
- `/home/ubuntu/skynet-tina/src/backend/branding/branding-routes.ts` — Phase 70 routes (full read)
- `/home/ubuntu/skynet-tina/src/backend/branding/branding-template.ts` — Phase 70 template (full read)
- `/home/ubuntu/skynet-tina/src/ui/branding/branding-store.ts` — Phase 70 frontend store (full read)
- `/home/ubuntu/skynet-tina/src/ui/branding/branding-fetch.ts` — Phase 70 frontend fetch (full read)
- `/home/ubuntu/skynet-tina/src/backend/starter.ts` — boot IIFE + fail-fast pattern (full read)
- `/home/ubuntu/skynet-tina/src/backend/database/database.ts` L1880-1950, L1995-2012, L2170-2199 — mount points + serverReady + initializeSecurity
- `/home/ubuntu/skynet-tina/docker/branding-defaults/branding.json` — bundled default (full read)
- `/home/ubuntu/skynet-tina/docker/docker-compose.yml` — bind-mount (full read)
- `/home/ubuntu/skynet-tina/.planning/phases/70-branding-config/70-CONTEXT.md` — precedent design (full read)
- `/home/ubuntu/skynet-tina/.planning/phases/70-branding-config/70-PATTERNS.md` — pattern map from Phase 70 (full read)
- `/home/ubuntu/skynet-tina/.planning/phases/70-branding-config/70-RESEARCH.md` L1-100 — precedent research (partial read for overall pattern awareness)
- `/home/ubuntu/skynet-tina/.planning/phases/70-branding-config/70-05-SUMMARY.md` — how Phase 70 concluded (full read)
- `/home/ubuntu/skynet-tina/.planning/STATE.md` L522-535 — Phase 74 + 70 roadmap entries
- `/home/ubuntu/.claude/roles/box-maintainer/runbooks/avatar-flow.md` — file scheduled for deletion (full read; confirmed all content is retired per CONTEXT.md)
- `/home/ubuntu/.claude/roles/box-maintainer/box-maintainer.md` L1-120 — Stacy-briefing convention for cross-deployment migration

### Secondary (MEDIUM confidence — inferred from convention)
- `~/.claude/roles/box-maintainer/agent-supervisor-handoff.md` L100-107 — Stacy-briefing DM pattern (source for A5 assumption)
- `~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/feature-01-branding-config.md` — Ivy provisioning pattern (source for A2 assumption)

### Tertiary (LOW confidence — none)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every capability verified in-tree, zero new packages
- Architecture: HIGH — extends Phase 70 patterns, all analogs cited with line refs
- Pitfalls: HIGH — five of six are code-mechanic pitfalls verified by reading the Phase 70 loader/route; the sixth (Pitfall 3, cross-deployment) is HIGH-severity-MEDIUM-confidence because it depends on Ashley + Stacy confirming the DM-based mechanism
- Cross-deployment migration: MEDIUM — mechanism is inferable but plan-phase should surface it to Ashley + Stacy for explicit lock

**Research date:** 2026-09-04
**Valid until:** 2026-10-04 (30 days — the Phase 70 patterns are stable and the branding subsystem hasn't churned since ship). Re-verify if any Phase 70 files change between now and plan-phase execution.
