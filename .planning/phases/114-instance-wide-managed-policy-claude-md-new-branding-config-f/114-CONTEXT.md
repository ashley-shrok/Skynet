# Phase 114: Instance-wide managed-policy CLAUDE.md — Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Source:** `/build` → `/open` shape session with user (mercury on t1000, 2026-09-17). Shape file at `.planning/shapes/shape-instance-wide-file.md` is the source-of-truth for scope + intent; this document translates that shape into concrete implementation decisions and open questions for downstream agents. Per fleet build rule ("seed discuss-phase from the shape file"), no re-elicitation of decisions the shape locked.

<domain>
## Phase Boundary

Deliver an instance-wide managed-policy CLAUDE.md tier that lands on every managed host of a Skynet instance and is picked up by Claude Code at every session start. The tier layers ABOVE the per-user `~/.claude/CLAUDE.md` file already honored across the fleet, carrying free-form admin-authored content that is true for the whole instance (company name, company type, brand posture, whatever else the admin puts in — the "twinkie").

**Mechanism gate — already closed (empirically verified this session).** Claude Code 2.1.150 natively loads managed-policy CLAUDE.md from `/etc/claude-code/CLAUDE.md` on Linux — additive above the user file, cannot be excluded. Verified PASS on three hosts across two auth flavors: t1000 (subscription OAuth), T800 (subscription OAuth), test08 (Bedrock via IAM instance profile). Primary source: Anthropic memory docs at `code.claude.com/docs/en/memory`. No id-skill change, no agent-side wake-up read step — Claude Code handles loading natively.

**Three chunks of work:**

1. **Branding-config side (source-of-truth authoring).** New optional field on `BrandingConfig` referencing a filename; the referenced markdown file lives alongside existing branding assets in the Skynet server's host-side branding directory (`/etc/skynet/branding/` inside the container, bind-mounted read-only from `/opt/skynet/branding/` on the host per branding D-01 phase 70). Same pattern icons already use — field carries a filename reference, actual bytes live host-side, admin edits via SSH.

2. **Distributor side (delivery).** New catalog entry (or catalog-adjacent derivation) that reads the twinkie's bytes from the branding-config-resolved location and pushes them, on the normal sweep cadence, to every managed host at `/etc/claude-code/CLAUDE.md`. First substrate item to (a) source bytes from a runtime bind-mounted file rather than `/app/fleet-substrate/…` in the image, AND (b) install to an absolute system-level path outside the ubuntu user's HOME. Both are new capabilities the catalog schema + push helpers must accommodate.

3. **Managed-host side (invariant on the target).** File owned root:root, mode 0644. Distributor stomps drift on next sweep. Nothing on the agent side — Claude Code discovers and loads natively.

## Out of scope (locked by shape file)

- **Any change to the id skill or agent wake-up path.** Claude Code loads managed-policy content natively; the agent side of this phase is zero-touch.
- **Admin UI for editing the twinkie.** No form, no textarea in Skynet's admin surface. SSH-and-file-edit is the whole editing surface, matching branding's current stance (no admin UI for any branding field today).
- **Manual "push now" affordance.** Next scheduled distributor sweep is the propagation model. No new trigger.
- **Bundled default in the container image.** Deliberate departure from the branding-asset pattern (which does bundle defaults under `/app/branding-defaults/`). When the field is unset or the referenced file is missing, distributor pushes NOTHING and the managed host has no managed-policy file at all — a clean unset state.
- **Templating or variable substitution in the twinkie content.** The admin's bytes are the agent's bytes, verbatim. No framing, no headers, no generated-at footers — distributor stays a dumb byte-mover.
- **Per-host variance within an instance.** Every managed host of a given Skynet sees the same twinkie. If per-host differentiation ever matters, it's a different problem.
- **Per-role or per-agent instruction overrides on top of this tier.** Deferred to a future phase.
- **Delivery via Claude Code's alternative native mechanism (`claudeMd` key inside managed-settings.json).** The standalone-file mechanism is the chosen path; the settings-key mechanism is a fallback we do NOT wire.
- **Propagation to non-managed hosts.** Only hosts the fleet-substrate distributor already sweeps get the twinkie. This is not a mechanism for pushing to arbitrary boxes.
- **Boot gate treating the field as required.** The twinkie is optional — a Skynet instance without one boots and runs identically to today. No boot gate.
- **Content of the twinkie for THIS instance (t1000).** The mechanism is what's built; the admin authors content once the plumbing lands. Not part of this build.

</domain>

<decisions>
## Implementation Decisions

### Branding-config field
- **D-01:** Add ONE new field to `BrandingConfig` at `src/backend/branding/branding-config-loader.ts:41-64`. Type: `string` (bare filename, NOT a URL path). Nullable-in-effect via empty string (`""`) — the config schema stays required-fields to match existing branding fields' shape, but empty string means "no twinkie for this instance." Rationale for empty-string vs `null | undefined`: the existing branding pattern uses empty string for `avatarDirectorSpec` when unset (Phase 74) — same convention here keeps loader/type shape uniform.
- **D-02:** Field name — SUGGESTED: `instancePolicyFilename` (or `instancePromptFilename`). Planner picks the name; considerations: (a) must NOT read as a URL path (existing `iconPath`/`wordmarkPath` fields carry `/branding/xxx.png` strings routed through the HTTP branding handler — the twinkie file is NOT served over HTTP, so a `Path`-suffixed name would mislead readers); (b) must convey "the file that becomes managed-policy CLAUDE.md on managed hosts"; (c) short enough to not be a mouthful in log lines. Not load-bearing — user has no strong opinion, "everybody puts whatever they want in their twinkies".
- **D-03:** Add matching field to `HARDCODED_FALLBACK` at `src/backend/branding/branding-config-loader.ts:71-88` with value `""` (empty = no twinkie by default — matches the "no bundled default" scope-edge from the shape).
- **D-04:** Add matching field to `docker/branding-defaults/branding.json` with value `""` (mirrors HARDCODED_FALLBACK per Phase 70 D-14: bundled default MUST match hardcoded fallback byte-for-byte).
- **D-05:** NO boot gate (never throws at boot). The empty-string default is intentionally satisfied without admin action (contrast with Phase 74's `avatarDirectorSpec` which DOES have a boot gate at `assert-boot.ts` — see shape file "Philosophy" §5). However, a NON-throwing loud error log fires at Skynet-server startup when the field IS set but the referenced file is missing on disk (per Q3 resolution, user 2026-09-17) — misconfiguration alarm, not a boot gate. Level: `sshLogger.error` at `assert-boot.ts` (or equivalent startup path — planner picks the anchor). Message: `"[branding] instance-policy field is set to '<filename>' but the file is missing at <resolved-absolute-path> — no twinkie will be pushed to managed hosts this sweep. Fix by placing the file at that path OR clearing the branding-config field."` Fires ONCE at boot, not per-sweep (per-sweep skip logging is separate; see D-15 discretion). If the byte-cap is exceeded (D-06), the same message fires with the reason substituted.
- **D-06:** Byte cap parity — the referenced markdown file MUST respect the same 256KB cap the branding-config-loader applies to `branding.json` itself (`MAX_CONFIG_BYTES` at `branding-config-loader.ts:73`). Files exceeding the cap: log error via `sshLogger.error`, treat as if the file were missing (distributor pushes nothing). Rationale: managed-policy CLAUDE.md content is instruction prose, not a data payload — 256KB is 50k+ words, far more than any legitimate instance-wide instruction set.
- **D-07:** Never-throws contract carries. The loader's Phase 70 contract ("this function never throws; all failure modes return the safe default") extends: if the new field is malformed (non-string type), the whole config falls back to `HARDCODED_FALLBACK` via the existing shape-invalid branch. No new throw paths introduced.

### Locating + reading the twinkie file on the Skynet server
- **D-08:** The twinkie file lives in the same host-side branding assets directory that already holds icons — `/etc/skynet/branding/<filename>.md` inside the container, bind-mounted read-only from `/opt/skynet/branding/<filename>.md` on the host. Same directory `getBrandingAssetsDir()` at `branding-config-loader.ts:111` returns. No new directory, no new bind mount, no compose change.
- **D-09:** Path resolution: pattern-match `resolveAssetPath()` at `branding-config-loader.ts` (planner: verify line range) — filename → absolute container path via `path.join(getBrandingAssetsDir(), filename)`. Path-containment guard (V5/V12 from Phase 70) applies: any filename containing `..` or that escapes the assets base MUST throw at the resolver level → 400 at any calling route. This threat model is inherited unchanged — the twinkie's read path uses the same guard.
- **D-10:** Fallback semantics DEPART from the branding-asset pattern:
  - Branding-asset pattern: override at `/etc/skynet/branding/<file>` → serve override; else bundled at `/app/branding-defaults/<file>` → serve default; else `{ source: "missing" }`.
  - **Twinkie: NO bundled-default leg.** Override at `/etc/skynet/branding/<filename>` → read; else treat as missing. Do NOT introduce a bundled `/app/branding-defaults/<filename>` (there is no per-instance-agnostic default that would ever be right).
- **D-11:** New export from `branding-config-loader.ts`: `readInstancePolicyBytes(): Promise<Buffer | null>` — returns the bytes of the file referenced by the config's field, respecting byte cap and containment guard; returns `null` on any of: field empty, file missing, byte cap exceeded, containment violation, or read error. Never throws. Consumed by the distributor sweep composer.

### Distributor catalog + push shape
- **D-12:** `CatalogEntry` interface at `src/backend/distributor/catalog.ts:68` grows to accommodate two new axes:
  - **Source axis:** `sourceKind: "bundled" | "runtime"`. Existing 24 entries are `"bundled"` (bytes at `/app/fleet-substrate/…` inside the image, static). The twinkie is `"runtime"` (bytes resolved at sweep time via `readInstancePolicyBytes()`; the entry's static `bundledPath` becomes semantically "resolver key" for the runtime lookup, or the entry gains a `resolver: () => Promise<Buffer | null>` field — planner picks the shape). Planner: pick the LOWER-CHURN shape for existing 24 entries; a discriminated union with `sourceKind: "bundled"` staying byte-identical to today is preferred over ripping the field name.
  - **Install-target axis:** `installMode: "user-home" | "system-root"`. Existing 24 entries are `"user-home"` (path prefixed `~/`, ubuntu-user-owned, no root elevation needed). The twinkie is `"system-root"` (absolute path `/etc/claude-code/CLAUDE.md`, root-owned, 0644, requires root write on the managed host).
- **D-13:** Push helper in `ssh-push.ts` grows to handle `installMode: "system-root"`:
  - Path quoting: `installMode: "user-home"` continues using `quotePathPreservingTilde()` at `ssh-push.ts` (preserves leading `~/` for shell home-expansion). `installMode: "system-root"` uses plain `shellSingleQuote()` — absolute paths need no tilde-preservation and MUST NOT be tilde-expanded.
  - Ownership + mode: after write, chown to `root:root` and chmod to `0644` explicitly. Directory `/etc/claude-code/` created with `mkdir -p`, mode `0755`, owned root:root.
  - **Root-user gate (per Q1 resolution, user 2026-09-17):** Before any read/write attempt, check the current SSH user for this (host, row) pair. If `installMode: "system-root"` AND `hosts.username != "root"` → SKIP the row with a structured `sshLogger.info` log line (see D-26). No byte-compare, no push, no partial work. This gate is a property of `installMode: "system-root"` in general — any future system-root row inherits the same behavior. Rationale: user's answer to Q1 was "just have it work on the ones that have root and log that they couldn't have that file drop for the ones that don't" — no sudoers carve-out, no root-credential migration, no elevation code. The fleet's ongoing migration to root-SSH (org-migration bounty) will progressively unlock more hosts over time; each newly-root host receives the twinkie automatically on its next sweep with zero Phase 114 changes.
- **D-26:** Structured skip-log shape when a `system-root` row skips a non-root host:
  - Level: `sshLogger.info` (not `.warn` — this is expected state during the migration, not an error).
  - Message: `"[substrate] skipping <slug> on host <hostId>: installMode=system-root requires SSH as root, current username is <username>"` — includes `slug`, `hostId`, and `username` for grep-ability.
  - Fires once per (sweep, host, row) tuple. Not throttled or deduplicated — a single sweep touches all managed hosts once, so this is naturally bounded.
  - Distinct from byte-compare-skip logging (D-15 discretion) — that fires when bytes match; this fires when the row is inapplicable to the host.
  - Consumed by: nothing programmatic. Human-visible log only. Ops greps for `skipping.*system-root` to see which hosts still need migration.
- **D-14:** New catalog row for the twinkie:
  - `slug`: `"instance-policy-claude-md"` (or planner-chosen kebab-case)
  - `bundledPath` / `resolver`: whichever shape the planner picks in D-12 — points at `readInstancePolicyBytes()`
  - `installPath`: `"/etc/claude-code/CLAUDE.md"` (absolute)
  - `installMode`: `"system-root"`
  - `sourceKind`: `"runtime"`
  - `restartHook`: `null` (Claude Code discovers managed-policy at every session start; no daemon to restart)
- **D-15:** Sweep composer at `src/backend/distributor/run-sweep.ts` iterates the catalog as today; for `sourceKind: "runtime"` entries, the resolver is called ONCE per sweep (not per host) — the same bytes fan out to every managed host. If the resolver returns `null`, the row is SKIPPED for this sweep across all hosts (no push, no removal from managed hosts — see D-17).
- **D-16:** Removal semantics — resolver-returns-null triggers an explicit `rm -f` push on every eligible managed host (per Q2 resolution, user 2026-09-17). When the admin clears the branding field OR removes the referenced markdown file OR the file exceeds the byte cap → `readInstancePolicyBytes()` returns `null` → the sweep issues `rm -f /etc/claude-code/CLAUDE.md` on every managed host whose SSH user is `root` (per D-13 root-user gate; non-root hosts were never pushed to in the first place, so no cleanup needed). The `rm -f` is idempotent (an already-absent file yields success). The parent directory `/etc/claude-code/` is NOT removed (potentially shared with other future system-root items; leaving the empty directory is harmless). Rationale: matches the shape file's "clean unset state" language — "unset means distributor pushes nothing, managed host has no managed-policy file, clean unset state." Sticky-bytes semantics would leave managed hosts silently reading a stale twinkie after ops cleared it.
- **D-17:** With D-16 in place, "cleared field" or "missing file" produces a clean managed-host state on every root-SSH host at the next sweep. Non-root-SSH hosts remain untouched because D-13 gates them out entirely.
- **D-27:** Removal-push mechanics in `ssh-push.ts`:
  - Add a new push-helper variant (or extend the existing one) for `installMode: "system-root"` rows whose source resolves to `null`.
  - Command shape: `rm -f /etc/claude-code/CLAUDE.md` (absolute path, no tilde expansion, single-quoted for defense). No sudo — the same root-user gate D-13 applies; only executed against `hosts.username == "root"`.
  - Result shape: mirror the existing push helpers' discriminated-union return (`{ ok: true, action: "removed" | "already-absent" }` on success, transport-failure on SSH drop). Byte-compare is skipped for removal (there's no source bytes to compare); the helper checks post-conditions via a lightweight `test -f` after the `rm`.
  - `restartHook` is `null` (same as the twinkie push row) — Claude Code discovers managed-policy at every session start; nothing to restart.

### Managed-host on-disk invariant
- **D-18:** Every managed host that receives a twinkie push MUST end up with `/etc/claude-code/CLAUDE.md` owned `root:root`, mode `0644`. Directory `/etc/claude-code/` created with `mkdir -p` on first push (owned root:root, mode `0755`). No other files placed in that directory by this phase.
- **D-19:** Byte-compare mechanism (existing distributor invariant — sweep pushes only when installed bytes differ from source bytes) applies unchanged. The `readInstalledBytes()` helper in `ssh-push.ts` reads the current `/etc/claude-code/CLAUDE.md` on the managed host and skips the push if bytes match. Reading `/etc/claude-code/CLAUDE.md` as the SSH user requires the file be world-readable (mode 0644 ensures this). Root ownership does NOT block the read.

### Fresh-session vs. running-session behavior
- **D-20:** Managed-policy CLAUDE.md is read by Claude Code AT SESSION START. Running `claude` sessions do NOT reload the file mid-session. Consequence: an admin edit + sweep + push lands the new bytes on disk, but any existing session continues with its already-loaded content until it next starts. This is EXPECTED behavior — the twinkie is instance-wide *ambient context* for new work, not a live-broadcasting mechanism. Not a bug, not a workaround needed for this phase.

### Tests
- **D-21:** Branding-loader tests to add in `branding-config-loader.test.ts`:
  - **T-01:** New field parses correctly when set to a valid filename.
  - **T-02:** New field defaults to empty string when absent from config JSON.
  - **T-03:** Byte-cap check on the referenced markdown file — over-cap returns null from `readInstancePolicyBytes()` and emits an error log.
  - **T-04:** Containment guard — filename containing `..` returns null (or throws at the resolver, matching existing branding path-guard pattern) with no read attempt.
  - **T-05:** Missing file — field set but file absent at resolved path returns null cleanly (never throws).
- **T-06:** Assert-boot tests in `assert-boot.test.ts`:
  - **T-06a:** Field empty-string default does NOT trigger a boot gate (contrast to `avatarDirectorSpec` boot gate; guards against future accidental gate additions).
  - **T-06b:** Field set + file present at resolved path → no error log, no throw. Clean-startup case.
  - **T-06c:** Field set + file MISSING at resolved path → `sshLogger.error` fires with the D-05 misconfiguration message; assert-boot does NOT throw (non-fatal alarm, not a gate).
  - **T-06d:** Field set + file present but exceeds byte cap → same error-log path as T-06c with reason substituted.
- **D-22:** Distributor tests to add:
  - **T-07:** Catalog schema — `sourceKind: "runtime"` entry parses; existing 24 entries stay `"bundled"` (regression guard).
  - **T-08:** Sweep composer — resolver called once per sweep (not per host); null return skips row across all hosts.
  - **T-09:** Push helper — `installMode: "system-root"` writes to absolute path with `root:root 0644` post-conditions (mockable at the exec layer).
  - **T-10:** Byte-compare skip — installed bytes match source → no push (regression guard against always-push).
  - **T-11:** Integration — end-to-end sweep with twinkie set + present on the test Skynet server → managed host receives `/etc/claude-code/CLAUDE.md` with matching bytes.
- **D-23:** Scoped test command for executor's green-gate (per fleet Test discipline directive): `npx vitest run src/backend/branding/ src/backend/distributor/`. Full suite runs at ship-gate only (orchestrator-owned, per role file 2026-09-07 refinement).

### Deploy discipline
- **D-24:** [informational] Executor's remit stops at code + commit + scoped tests green. Push → build → recreate → verify happens as one atomic ship motion on user's explicit greenlight, orchestrator-owned. Per role file standing directive (2026-08-29 refinement): the deploy-window boundary sits at `git push`, not at `docker compose up --force-recreate` — a peer's subsequent `--force-recreate` after their `git pull --rebase` would ride-along-ship any pushed-but-not-approved commits.
- **D-25:** [informational] Post-deploy sanity check: on t1000 after `--force-recreate`, verify (a) `docker logs --since 60s skynet 2>&1 | grep -iE "warn|error|fail|unsupported"` reads clean and (b) with the branding field set to a test twinkie AND next distributor sweep firing, `/etc/claude-code/CLAUDE.md` appears on t1000 with matching bytes. First-of-kind capability — verify explicitly, do not assume.

### Claude's Discretion
- Exact field name on `BrandingConfig` (D-02).
- Precise shape of the `CatalogEntry` extension for the two new axes (`sourceKind` / `installMode`) — discriminated union vs. optional flags vs. separate catalog list; planner picks the shape with lowest churn to existing 24 rows (D-12).
- Whether `readInstancePolicyBytes()` lives as a new export in `branding-config-loader.ts` or as a small dedicated module (e.g. `instance-policy-reader.ts`) — either works; loader is fine if we're not adding much surface (D-11).
- Whether the sweep composer's null-resolver skip logs a `sshLogger.info` line so ops can distinguish "field unset" from "sweep didn't touch this row" in the log stream — recommend yes, minor.
- Whether to update the file-level docstrings on `catalog.ts` (row-count reconciliation at lines 33-58) to reflect the new row + the two new axes — recommend yes; the docstring is heavily maintained.

</decisions>

<open_questions>
## Open Questions for Researcher

**Not scope creep — genuinely unresolved decisions the researcher should evaluate against the current codebase state and surface a recommendation the planner locks.**

### Q1 — Elevation strategy for root-write on managed hosts — **RESOLVED** (user 2026-09-17)

**Resolution:** No elevation, no sudoers carve-out, no root-credential migration. The row skips-with-structured-log on any host whose `hosts.username != "root"`. See D-13 (root-user gate) and D-26 (log shape) for the locked mechanics.

User verbatim (2026-09-17): *"okay can we just for right now have it work on the ones that have root and then just log that they couldn't have that file drop for the ones that don't"*

**Consequences the planner should be aware of:**
- Current fleet state (2026-09-17 per `~/fleet/roles/box-maintainer/box-map.md` § Managed hosts): thenasty SSHes as `thenasty`, workstation as `ubuntu`, ZoeyBattlestation as a non-root key-auth user, beelink as `<user>`. **ZERO of the four current Linux managed hosts SSH as root.** t1000 is self and not a distributor push target.
- Mechanism will ship functional but land zero twinkies until the org-migration bounty (`~/fleet/roles/box-maintainer/bounties/plan-proper-org-migration-back/`) or ad-hoc per-host migrations flip `hosts.username` to `root` on target hosts.
- Fine because the twinkie CONTENT is also empty at Phase 114 completion — mechanism first, content later. As hosts migrate, they receive the twinkie automatically on the next sweep with zero Phase 114 code changes.
- The `installMode: "system-root"` gate is generalized — any FUTURE system-root row (there aren't any planned right now, but the axis exists) inherits the same skip-non-root behavior.

Historical option-space (kept for future-similar-decision reference):
- **(a) Assume-root-SSH.** Rely on the fleet-wide migration; push fails cleanly on non-root. Rejected because the migration is not yet done and Phase 114 shouldn't bundle a fleet-wide cutover.
- **(b) NOPASSWD sudoers carve-out.** Distributor ships a sudoers file allowing the current SSH user to write specifically to `/etc/claude-code/CLAUDE.md`. Rejected in favor of the simpler skip-with-log approach — sudoers file placement itself needs root once, and adds a new substrate item with its own bootstrap complexity.
- **(c) Per-catalog-row elevation via `sudo -n`.** Same chicken-and-egg as (b) but inline in the push code. Rejected for the same reason.

### Q2 — Removal semantics — **RESOLVED** (user 2026-09-17)

**Resolution:** Option (a) — explicit `rm -f` push. When the resolver returns `null` (field cleared, file missing, or byte-cap exceeded), the sweep issues `rm -f /etc/claude-code/CLAUDE.md` on every root-SSH managed host. Non-root-SSH hosts are gated out entirely by D-13 and were never pushed to, so no cleanup needed. Mechanics locked in D-16, D-17, and D-27.

Rationale: matches the shape's "clean unset state" language. Sticky-bytes would leave hosts silently reading stale twinkies after ops cleared the field — worse UX than the small extra push motion.

Historical option-space (kept for reference):
- **(a) Explicit removal** — CHOSEN. Guarantees clean state; introduces a "removal push" motion the existing byte-compare mechanism doesn't have today (see D-27 for the new helper).
- **(b) Sticky bytes.** Rejected — leaves managed hosts with stale content after admin clears the field.
- **(c) Empty-file marker.** Rejected — leaves an unnecessary artifact on disk and requires verifying that Claude Code treats a zero-byte managed-policy file identically to no file.

### Q3 — First-boot loudness — **RESOLVED** (user 2026-09-17)

**Resolution:** Option (a) — loud non-throwing error log at Skynet-server startup when the field is set but the referenced file is missing (or over the byte cap). Not a boot gate — the process continues to start. Mechanics locked in D-05; tests in T-06b/c/d.

Rationale: cheap misconfiguration alarm ops sees immediately in the startup log stream, no code path where the misconfig hides silently until someone greps sweep logs.

Historical option-space (kept for reference):
- **(a) Loud at boot** — CHOSEN. Non-throwing `sshLogger.error` at `assert-boot.ts`.
- **(b) Silent-until-sweep.** Rejected — relies on ops grepping sweep logs to notice a misconfig.

</open_questions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape + design
- `.planning/shapes/shape-instance-wide-file.md` — LOCKED shape opened+greenlit 2026-09-17. Source-of-truth for scope, philosophy, failure modes, and scope edges. Every locked decision in this CONTEXT traces back to a paragraph in the shape.

### External docs — Claude Code managed-policy mechanism
- `https://code.claude.com/docs/en/memory` — Anthropic memory documentation. Managed-policy path on Linux is `/etc/claude-code/CLAUDE.md`; load order is managed → user → project → local; cannot be excluded; additive layering; `@import` syntax also available (not used by this phase). Verified live 2026-09-17.

### Backend files this phase modifies
- `src/backend/branding/branding-config-loader.ts` — `BrandingConfig` type (line ~41), `HARDCODED_FALLBACK` (~71), `MAX_CONFIG_BYTES` (~73), `getBrandingAssetsDir()` (~111), `getBundledDefaultsDir()` (~115), `resolveAssetPath()` (planner: verify line range) — add new field + new export `readInstancePolicyBytes()`.
- `src/backend/branding/branding-config-loader.test.ts` — add tests T-01 through T-05.
- `src/backend/branding/assert-boot.ts` — add non-throwing error-log path for the "field set but file missing (or over byte cap)" case per D-05. NOT a boot gate — the process continues to start. Wire to the same `readInstancePolicyBytes()` resolver the sweep uses; on `null` return with a set field, emit `sshLogger.error` with the D-05 message shape.
- `src/backend/branding/assert-boot.test.ts` — add T-06 (explicit no-gate test).
- `docker/branding-defaults/branding.json` — add new field with empty-string default (D-04, mirroring HARDCODED_FALLBACK per Phase 70 D-14).
- `src/backend/distributor/catalog.ts` — extend `CatalogEntry` interface (~line 68) with `sourceKind` + `installMode` axes; add twinkie row to `FLEET_SUBSTRATE_CATALOG`; update file-level docstring row-count reconciliation (lines 33-58).
- `src/backend/distributor/catalog.test.ts` — add T-07 (schema regression guard).
- `src/backend/distributor/ssh-push.ts` — extend push helper to handle `installMode: "system-root"` (absolute-path quoting, chown+chmod post-conditions).
- `src/backend/distributor/ssh-push.test.ts` — add T-09 (root-owned push test) and T-10 (byte-compare skip regression).
- `src/backend/distributor/run-sweep.ts` — sweep composer changes for `sourceKind: "runtime"` resolver call (once per sweep, fan out to hosts).
- `src/backend/distributor/run-sweep.test.ts` — add T-08.
- `src/backend/distributor/server-substrate-integration.test.ts` — add T-11 (end-to-end integration).

### Files this phase does NOT modify (invariants)
- `~/.claude/skills/id/SKILL.md` and any `id`-skill-adjacent files — Claude Code loads managed-policy natively; no agent-side change.
- Any file under `~/skynet-tina/substrate/scripts/` or `~/skynet-tina/substrate/skills/` — the fleet-substrate itself is unaffected; only the distributor's push shape grows.
- Any file under `docker/` other than the branding-defaults JSON — no Dockerfile change, no compose change.

### Role-file references (fleet-scope discipline that applies)
- `~/fleet/roles/box-maintainer/box-maintainer.md` — read `## Standing directives` before touching the distributor or deploying. Specifically: "no hand-patch fleet-substrate on any host" (the user 2026-09-10), "Never leave tests failing", "Multi-identity role — git pull --rebase before every push", "SSH to peer boxes as root" (the user 2026-09-08), and the deploy-window boundary at `git push` (2026-08-29 refinement).
- `~/fleet/roles/box-maintainer/box-map.md` — read for the current SSH-user distribution across managed hosts (needed to answer Q1).

### Prior related phases
- **Phase 70** (branding-config) — established the `/etc/skynet/branding.json` + bundled-defaults + per-file-fallback pattern this phase extends. Key contract: loader never throws; all failure modes return the safe default. Read `.planning/phases/70-*` CONTEXT.md if it exists.
- **Phase 74** (avatar-style-through-branding-config) — added `avatarDirectorSpec` + `avatarGammaDefault` fields to `BrandingConfig`. Also added a boot gate at `assert-boot.ts` for the intentionally-empty default. This phase's D-05 explicitly rejects a similar boot gate; Phase 74's assert-boot mechanics are the reference for what NOT to replicate here.
- **Phase 82** (wip-indicator through branding) — added `wipIndicatorPath`. Reference for shape of adding a new referenced-file field.
- **Phase 72** (feature-02 slice 2) — established `CatalogEntry` interface + sweep-composer + ssh-push mechanism. All extended by this phase.
- **Phase 111** (loud failures) — recent hardening of ssh-push's transport-vs-ENOENT distinction. The `readInstalledBytes` helper's ExecResult shape (from Plan 01 of Phase 111) is what byte-compare relies on.

</canonical_refs>
