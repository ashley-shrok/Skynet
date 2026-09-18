---
phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
plan: 02
subsystem: substrate
tags: [image-gen, skill, bash-helper, file-drop-broker, distributor, phi-directive]

# Dependency graph
requires:
  - phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
    provides: 116-01 wire-protocol contract (ImageGenRequestBody KNOWN_KEYS + FailureReason enum + SuccessResponse shape) that the helper's request JSON body must satisfy
provides:
  - substrate/skills/image-gen/SKILL.md — on-demand-loaded agent-facing skill body with D-17 PHI directive at top primacy + D-18 recency echo + D-27 7-reason failure taxonomy
  - substrate/scripts/image-gen — bash helper implementing the write-and-poll file-drop broker dance (atomic .tmp+mv, ref-before-json order, dual-cadence poll, 5-min timeout, PNG-move + wire cleanup)
  - src/backend/distributor/catalog.ts — two new BundledCatalogEntry rows (image-gen-skill + image-gen-helper) plumbing both artifacts onto every managed host on the next fleet-substrate sweep
affects: 116-03 (scan-orchestrator consumes the helper's on-disk wire format; the SKILL.md contract locks what callers will pass), 116-04 (test surface — the helper is the drop-tool the end-to-end tests exercise)

# Tech tracking
tech-stack:
  added: []  # zero new deps — bash + uuidgen + jq (all managed-host baseline)
  patterns:
    - "D-17/D-18 top-primacy + recency-reinforcement PHI directive placement in SKILL.md (research-backed via Lost-in-the-Middle + serial-position + hierarchical-safety-adherence benchmark)"
    - "Bash helper file-drop broker: atomic .tmp -> mv writes with strict write-order (ref file BEFORE request JSON per Pitfall 3) so backend claim-on-JSON-observation never sees a bare request without its companion"
    - "Dual-cadence poll loop (500ms fast for 30s, 2s slow after) — first appearance of this cadence in the substrate scripts tree; sized for gpt-image-1 typical 5-30s latency without wasting cycles on slow n=3 quality=high jobs"
    - "IMAGE_GEN_TIMEOUT_SEC env override for the same helper the caller ships to production — surfaces the test-side speed knob without a separate test-mode branch"
    - "Provider-agnostic SKILL surface: no mention of openai/gpt-image-1/token-bucket/avatar in the on-demand-loaded skill body — provider name lives only in the backend adapter (T-116-02-05 EoP mitigation via grep-verifiable absence)"

key-files:
  created:
    - substrate/skills/image-gen/SKILL.md
    - substrate/scripts/image-gen
  modified:
    - src/backend/distributor/catalog.ts

key-decisions:
  - "--out combined with n>1 semantics (planner delegation): first image lands verbatim at the caller's --out path; subsequent images append -<i> suffix before the extension (e.g. --out /tmp/foo.png with n=2 -> /tmp/foo.png + /tmp/foo-1.png). Rejected the alternative 'reject --out with n>1' because the append-suffix behaviour matches how most CLI tools handle multi-output flags and preserves the caller's intent without a hard error. Documented inline in the helper's success-branch comment block."
  - "Placement of image-gen-skill catalog row: after role-skill (end of single-file skills block) rather than alphabetically-first within the block. Rationale: mirrors the placement convention already in the file (block comments group by kind, not by slug), and role-skill is the closest analog (single-file skill, no companions, no restart hook)."
  - "Placement of image-gen-helper catalog row: after claude-usage-collector (end of helper-scripts block, just before the user-onboarding section). Same block-tail convention."
  - "Ref-extension lowercased on the wire: caller's --ref /path/FOO.PNG becomes <uuid>.ref.png on disk. Rationale: the backend parser's REF_PATTERN (from 116-01) is case-insensitive but the on-wire filename is canonicalised to lowercase for scan-log grepability."
  - "Failure branch reads failure JSON BEFORE deleting it (belt-and-suspenders): the file existed on the poll-loop existence check but a concurrent reaper could still remove it between check and rm. The `cat ... 2>/dev/null || true` swallows any race so the caller's transcript still gets the payload if it was captured, and the rm still runs (best-effort) either way."

patterns-established:
  - "Substrate helper header comment convention extended: agent-supervisor.sh's 'canonical copy lives at repo path X, distributed by catalog.ts, installed at ~/.local/bin/Y, do NOT hand-edit installed copy' block reused verbatim for image-gen — establishing a template that future distributed shell helpers should adopt for consistency across the substrate tree."
  - "Two-catalog-row pattern for a distributed skill+helper pair: one row for the SKILL.md (~/.claude/skills/<slug>/), one for the executable helper (~/.local/bin/<name>). First instance in the codebase of a paired distribution; future skills that need companion executables have a clear analog."

requirements-completed: []

# Metrics
duration: ~4min
completed: 2026-09-18
---

# Phase 116 Plan 02: Skill body + bash helper + distributor rows Summary

**Ships the caller side of the file-drop broker end-to-end: a 63-line SKILL.md with the D-17 PHI directive verbatim at the top and the D-18 echo inline in the invocation section, a 323-line bash helper implementing the atomic-write / poll / branch / cleanup dance (with ref-before-json write ordering per Pitfall 3, dual-cadence poll, and IMAGE_GEN_TIMEOUT_SEC test override), and two new fleet-substrate distributor rows so both artifacts land on every managed host on the next sweep after ship — three files, three commits, zero deviations, all verify checks green.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-09-18T00:57:56Z
- **Completed:** 2026-09-18T01:01:52Z
- **Tasks:** 3 (all `type="auto"`, no checkpoints)
- **Files created:** 2 (substrate skill + helper)
- **Files modified:** 1 (catalog)

## Accomplishments

- **SKILL.md with locked D-17/D-18 placement (63 lines).** Frontmatter carries `name: image-gen`, one-line description, `distributed: true` — matching the id-skill / bounty-skill shape convention. The D-17 PHI directive appears in section 2 immediately after the H1 + one-line intro (top primacy), verbatim with the `⚠️` emoji and `MUST NOT include PHI` wording. The D-18 echo appears once more inside the Invocation section as prose (recency reinforcement) — not in a code block, so the language model reads it as an instructional reminder rather than a syntax example. The failure section contains the D-19 `content_blocked` one-liner verbatim plus a markdown table covering all 7 D-27 failure reasons with one-line caller actions each (9 `| ` table lines total — 7 rows + header + separator, exceeding the ≥ 8 verify threshold). Provider-agnostic surface — grep confirms zero mentions of `openai`, `gpt-image-1`, `token-bucket`, or `avatar`.

- **Bash helper implementing the full write-and-poll broker (323 lines).** The helper handles the ~30-line file-drop dance so callers get a one-line invocation. Arg-parse loop covers `--size`, `--n`, `--quality`, `--out`, `--ref`, `--json`, and `-h|--help`, with positional prompt capture. Concrete behaviour highlights:
  - **Atomic .tmp+mv writes** (D-10) for both the request JSON and the optional `<uuid>.ref.<ext>` companion.
  - **Ref-file written BEFORE the request JSON** (Pitfall 3 from 116-RESEARCH.md — verified in the source at lines 160 (ref mv) vs 228 (json mv), so the backend scan-orchestrator will always see the companion present at claim time).
  - **Dual-cadence poll:** 500ms fast interval for the first 30s, 2s slow interval thereafter — sized for gpt-image-1 typical 5-30s latency without wasting cycles on slower n=3 quality=high jobs (matches the RESEARCH.md discretion recommendation).
  - **5-min timeout** (D-16), overridable via `IMAGE_GEN_TIMEOUT_SEC` env for the Plan 04 test surface. On timeout the helper synthesises `{"reason":"expired"}` on stderr and exits 1, so the caller's failure-handling path treats caller-timeout and backend-TTL identically per the D-27 enum.
  - **Success branch** iterates `<uuid>.success.*.png`, moves each to the caller's `--out` (with `-<i>` suffix before the extension for n>1) or the default `~/fleet/image-gen-outputs/<uuid>-<i>.png` (D-15), copies success JSON to stderr, prints paths on stdout (D-14 split), and cleans up all wire files (D-05).
  - **Failure branch** reads failure JSON to stderr, cleans up wire files, exits 1.
  - **uuidgen with `/proc/sys/kernel/random/uuid` fallback** (Assumption A1 mitigation) — portable across every Ubuntu-based managed host.
  - **jq preferred, printf fallback** for JSON assembly (Assumption A2 mitigation) — the fallback branch documents inline that quote-safety in `$prompt` is not guaranteed under the printf path.
  - **V10 safety:** prompt content is NEVER shell-interpolated (grep-verified no `eval` / backtick-`$prompt` / `$(... $prompt`). All prompt handling flows through `jq --arg` (correct JSON escape) or `printf '%s'` (safe passthrough).
  - **Executable bit set** via `chmod +x` after write; git preserves the mode; distributor mirrors it on install.
  - **Smoke-tested locally** across three flows: help output, failure-file branch (planted `content_blocked` failure -> stderr JSON + exit 1 + wire cleanup), success branch (planted success JSON + PNG -> stdout path at custom `--out` + stderr metadata + exit 0 + wire cleanup), and timeout branch (2s override -> `{"reason":"expired"}` + exit 1).

- **Two catalog rows plumbing distribution.** Added `image-gen-skill` (`/app/fleet-substrate/skills/image-gen/SKILL.md` -> `~/.claude/skills/image-gen/SKILL.md`) after `role-skill` in the single-file skills block, and `image-gen-helper` (`/app/fleet-substrate/scripts/image-gen` -> `~/.local/bin/image-gen`) after `claude-usage-collector` in the helper-scripts block. Both rows use `sourceKind: "bundled"` and `restartHook: null` (both are on-demand-loaded — skill re-read at next invocation, helper re-executed at next call). No Dockerfile change required: `docker/Dockerfile:80`'s existing `COPY --chown=node:node substrate /app/fleet-substrate` already picks up both new files. `tsc --noEmit -p tsconfig.node.json` remains clean (0 errors, whole backend).

## Task Commits

1. **Task 1: SKILL.md with D-17/D-18 + D-27 failure table** — `f4a3faa1` (feat)
2. **Task 2: image-gen bash helper (write-and-poll broker)** — `1cb3ea11` (feat)
3. **Task 3: two new catalog rows (skill + helper)** — `f72bf397` (feat)

## Files Created/Modified

**Created (2):**
- `substrate/skills/image-gen/SKILL.md` (63 lines) — frontmatter + H1 + D-17 PHI directive (verbatim) + Invocation section with D-18 echo + Response shape (D-14 stdout/stderr split) + Failure handling with D-19 content_blocked one-liner + D-27 7-reason table.
- `substrate/scripts/image-gen` (323 lines, mode 755) — bash helper implementing the full write-and-poll broker.

**Modified (1):**
- `src/backend/distributor/catalog.ts` (+22 lines) — two new BundledCatalogEntry rows at line 311 (image-gen-skill) and line 377 (image-gen-helper) plus in-line comment blocks explaining Phase 116 context + restartHook rationale for each.

## Decisions Made

- **`--out` combined with `n>1`.** First generated image lands verbatim at the caller's `--out` path; subsequent images append a `-<i>` suffix before the extension. Rejected the alternative "reject --out with n>1" because the append-suffix approach matches how most CLI tools handle multi-output flags (`--out foo.png` with n=2 yields `foo.png` + `foo-1.png`) and preserves the caller's intent without a hard error. Documented inline in the helper's success-branch comment block.
- **Ref extension lowercased on wire.** Caller's `--ref /path/FOO.PNG` becomes `<uuid>.ref.png` on disk. The 116-01 REF_PATTERN accepts case-insensitively but the wire form is canonicalised for scan-log grepability.
- **Catalog row placement: end-of-block, not alphabetical.** Both rows placed at the tail of their respective block (skill row after `role-skill`; helper row after `claude-usage-collector`) rather than alphabetically inserted mid-block. Matches the file's existing convention of grouping by kind then appending new entries at block tail.
- **Belt-and-suspenders failure-JSON read.** The failure-branch `cat "$failure_file" >&2` is guarded by `2>/dev/null || true` so a concurrent reaper deleting the file between the poll-loop existence check and the read cannot crash the helper — the caller's transcript still gets whatever was captured before the race lost, and cleanup still runs.

## Deviations from Plan

None — all three tasks executed exactly per the `<action>` and `<behavior>` blocks in `116-02-PLAN.md`. All `<automated>` verify commands returned success; all `<done>` criteria met on the first pass. No auto-fixes needed (no Rule 1/2/3 events fired); no architectural questions surfaced (no Rule 4).

The three `## Decisions Made` items above are all planner-delegated choices (per the plan's `<action>` block explicitly leaving `--out + n>1` to the executor, and the catalog placement discretion in `<action>` line "A reasonable placement is after...") — not deviations.

## Issues Encountered

None. Clean tree at start (`git status --short` empty), all three commits applied cleanly, `tsc --noEmit` clean across the backend, all smoke tests green.

## User Setup Required

None from this plan directly. The distribution mechanism is fully automatic: the two catalog rows will land on every managed host on the next fleet-substrate sweep after Skynet is deployed (per D-28, that ship motion is orchestrator-owned and gated on the user's greenlight — this executor stops at code + commit + tests green).

Once the backend is running (which requires Plans 116-03 + 116-04 to complete), callers invoke `image-gen "prompt"` on any managed host and the helper handles the full round-trip.

## Threat Model Compliance

All 6 threats in the plan's `<threat_model>` register are addressed by the code shipped here:

| Threat ID | Category | Mitigation Status |
|-----------|----------|-------------------|
| T-116-02-01 | Tampering — prompt shell interpolation | MITIGATED. Helper uses `jq --arg` (correct JSON escape) and `printf '%s'` (safe string passthrough) only. Zero `eval`, zero unquoted `$prompt` expansions in a shell command context (grep-verified). |
| T-116-02-02 | Info Disclosure — prompt in shell history / ps | ACCEPTED per threat register. Same trust boundary as any shell command; the D-17 PHI directive in SKILL.md is the compliance-side mitigation. |
| T-116-02-03 | DoS — runaway callers | ACCEPTED per threat register. Backend token bucket + 5-worker queue (116-01/116-03) drains at the RPM-limited pace; excess ages out via 5-min TTL. |
| T-116-02-04 | Tampering — --ref path traversal | ACCEPTED per threat register. Helper `cp`s whatever caller names; landed file is uuid-derived under `~/fleet/image-gen-requests/` so cross-caller collision is impossible. Caller already has shell — no new privilege granted. |
| T-116-02-05 | EoP — SKILL.md carries provider credentials | MITIGATED. Grep confirms SKILL.md contains ZERO reference to `openai`, `gpt-image-1`, credential/key, API endpoint. Provider abstraction preserved: credential lives only in Skynet backend env per D-25. |
| T-116-02-06 | Repudiation — wire files deleted before caller sees them | MITIGATED. Helper prints paths on stdout + JSON on stderr BEFORE cleaning up wire files (success branch orders: move PNGs → stderr JSON → stdout paths → rm wire files). Failure branch orders: cat failure JSON → rm wire files → exit 1. Both branches guard the read with `2>/dev/null || true` for concurrent-reaper race safety. |

## Next Plan (116-03) Readiness

Plan 02 delivers the caller-side surface. Plan 03 (backend scan-orchestrator) is unblocked — it will consume:

- **Wire format:** the helper drops `<uuid>.json` + optional `<uuid>.ref.<ext>` at `~/fleet/image-gen-requests/`; Plan 03's scan uses the same atomic mv-based claim pattern as `spawn-requests/scan-orchestrator.ts` (target path swapped), and reads the ref field to know which companion to fetch over SFTP.
- **Response contract:** Plan 03's worker will drop `<uuid>.success.json` + `<uuid>.success.<i>.png` (success) or `<uuid>.failure.json` (failure) at the same folder. This helper polls for either and handles the branching.
- **Wire cleanup:** Plan 03 does NOT reap wire files — that's this helper's responsibility, and the helper's cleanup path is already tested (all three smoke tests confirm wire folder is empty after the helper exits).

The two catalog rows are wired but do NOT distribute until Skynet is restarted with the new bundle (per D-28, orchestrator-owned). Plans 116-03 and 116-04 land in parallel without stepping on either of this plan's files.

## Self-Check: PASSED

**Files verified:**
- FOUND: /home/ubuntu/skynet-nebula/substrate/skills/image-gen/SKILL.md
- FOUND: /home/ubuntu/skynet-nebula/substrate/scripts/image-gen (mode 755)
- FOUND: /home/ubuntu/skynet-nebula/src/backend/distributor/catalog.ts (image-gen-skill row at line 311, image-gen-helper row at line 377)

**Commits verified:**
- FOUND: f4a3faa1 — feat(116-02): add image-gen SKILL.md with D-17 PHI directive + D-18 echo
- FOUND: 1cb3ea11 — feat(116-02): add image-gen bash helper (file-drop broker, write-and-poll)
- FOUND: f72bf397 — feat(116-02): add image-gen skill + helper rows to distributor catalog

**Verify checks:**
- SKILL.md: `MUST NOT include PHI` present ✓; `Rephrase and retry` present ✓; `distributed: true` present ✓; 9 `| ` table lines (≥ 8 required) ✓; D-17 heading `### ⚠️ Your prompt leaves this deployment` present verbatim ✓; D-18 echo present verbatim ✓; no `openai`/`gpt-image-1`/`token-bucket`/`avatar` mentions ✓.
- image-gen: file exists ✓; executable (mode 755) ✓; `bash -n` clean ✓; `uuidgen` present ✓; `/proc/sys/kernel/random/uuid` fallback present ✓; `image-gen-outputs` present ✓; `{"reason":"expired"}` synthesis present ✓; `IMAGE_GEN_TIMEOUT_SEC` env override present ✓; ref-mv (line 160) precedes json-mv (line 228) — Pitfall 3 write-order OK ✓; three smoke tests green (failure branch, success with custom --out, timeout).
- catalog.ts: exactly 2 rows added (grep count = 2) ✓; both `sourceKind: "bundled"` ✓; both `restartHook: null` ✓; `npx tsc --noEmit -p tsconfig.node.json` clean (0 errors, whole backend) ✓.

---
*Phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation*
*Completed: 2026-09-18*
