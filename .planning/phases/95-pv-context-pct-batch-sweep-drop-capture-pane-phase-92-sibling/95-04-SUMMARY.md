---
phase: 95-pv-context-pct-batch-sweep-drop-capture-pane-phase-92-sibling
plan: 04
subsystem: claude-session backend / distributor fleet-substrate
tags: [phase-95, part-c, wave-3, sweep-schema, python-sweep, distributor-catalog]
dependency_graph:
  requires:
    - "95-03: frontend plan-pending deletion complete"
  provides:
    - "pv-sweep-schema.ts: v1 JSONL wire contract for context-pct batch sweep"
    - "pv-context-pct-sweep.py: stdlib-only Python sweep script for fleet distribution"
    - "distributor catalog row: pv-context-pct-sweep ships to every runsFleetSubstrate=true peer on next rebuild"
  affects:
    - "exec pressure on Skynet-host SSH connection (foundation for Part C 4x reduction via Plan 05)"
    - "FLEET_SUBSTRATE_CATALOG grows from 22 to 23 entries"
tech_stack:
  added:
    - "Python 3 stdlib concurrent.futures.ThreadPoolExecutor (parallelized identity sweep)"
  patterns:
    - "Phase 92-sibling pattern: schema module (TS) + sweep script (Python) + distributor catalog row"
    - "Single-tier schema (one PvSweepLine per identity — no PID axis, unlike Phase 92's two-tier)"
    - "Lenient JSONL parser: per-line try/catch, never throws, schemaMismatch flag for caller fallback"
key_files:
  created:
    - "src/backend/claude-session/pv-sweep-schema.ts (v1 wire contract + lenient parser)"
    - "src/backend/claude-session/pv-sweep-schema.test.ts (28 tests)"
    - "substrate/scripts/pv-context-pct-sweep.py (489 lines, mode 100755)"
  modified:
    - "src/backend/distributor/catalog.ts (1 new CatalogEntry, docstring updates)"
    - "src/backend/distributor/catalog.test.ts (Test 1 + Test 6 count bumps)"
    - "src/backend/distributor/run-sweep.test.ts (Test 1 count bump)"
decisions:
  - "SSH-topology LOCKED as Option 3 (per-WS): each WS runs its own sweep exec per tick. Matches existing per-WS connectOneShot topology, delivers measurable 4x exec reduction per WS per tick, zero new coordination surface. Alice owns the override if she wants Option 1 (per-host connection pool) in a future phase."
  - "Single-tier schema (no PID axis): PV context-pct is identity-keyed (one JSONL per identity), unlike Phase 92's fleet-status which needed per-pid rows. PvSweepLine has line_kind='identity', schema_version=1, identity, context_pct, jsonl_path. One line per identity per sweep invocation."
  - "pv-context-pct-sweep.py uses ThreadPoolExecutor(max_workers=8) for multi-identity parallelism to keep sweep wall-clock under 3s for coordinator boxes with 10+ identities."
metrics:
  duration: "~40 minutes execution time (both Wave 3 plans combined)"
  completed_date: "2026-09-10"
  tests_added: 28
  tests_modified: 4
  lines_added_approximately: 640
---

# Phase 95 Plan 04: PV context-pct batch sweep foundation (schema + sweep script + catalog row) Summary

**One-liner:** Created the pv-context-pct-sweep v1 JSONL wire contract (pv-sweep-schema.ts), ported readContextPctFromJsonl server-side as a stdlib-only Python sweep script (pv-context-pct-sweep.py), and registered the script in the distributor catalog for fleet-wide distribution.

## Architecture decision — SSH-topology LOCKED as Option 3 (per-WS)

**MEDIUM-confidence decision #2 resolved in this plan.** Three options were evaluated:

| Option | Description | Cost | Status |
|--------|-------------|------|--------|
| 1 (per-host coordinator) | New per-host shared SSH connection subsystem | Full sub-plan of connection-pool refactoring | REJECTED for Phase 95 |
| 2 (elected WS) | Cross-WS election + fan-out registry + failover | Coordination code without connection-refactor payoff | REJECTED for Phase 95 |
| 3 (per-WS) | Each WS runs its own sweep exec per tick | Zero new plumbing; maps to existing connectOneShot topology | **LOCKED** |

**Rationale:** Option 3 matches the existing per-WS `connectOneShot` SSH connection reality confirmed by RESEARCH §G1 (grep confirmed L1239/L1357/L1429/L1515/L1609/L1669/L1727/L1796/L1874 all use `connectOneShot`). Delivers the 4x reduction per WS per tick. Alice owns the override for Option 1 in a future phase (Phase 96 or successor already scoped for semaphore work + per-host connection pool).

## pv-sweep-schema.ts

Wire contract module for the v1 JSONL output of pv-context-pct-sweep.py:

```typescript
export const PV_SWEEP_SCHEMA_VERSION = 1 as const;
export interface PvSweepLine {
  "line_kind": "identity";
  "schema_version": 1;
  "identity": string;
  "context_pct": number | null;
  "jsonl_path": string | null;
}
export interface PvSweepParseResult {
  lines: PvSweepLine[];
  unknownLines: number;
  schemaMismatch: boolean;
}
export function isPvSweepLineOfCurrentSchema(obj: unknown): obj is PvSweepLine
export function parseSweepJsonl(raw: string): PvSweepParseResult
```

Wire-size estimate: ~120 bytes/line. 10 identities = ~1.2KB per tick — well within SSH window limits.

## pv-context-pct-sweep.py

489 lines. Stdlib-only Python 3. Key properties:

- `--identities <comma-separated>` argv; missing/empty → silent exit 0
- G6 safe-char guard: `^[a-zA-Z0-9_-]+$` on each identity (logged to stderr, belt-and-suspenders)
- Phase 32 JSONL discovery with delimiter-set partial-match rejection (`<`, ` `, `\r` — load-bearing: `tiff` does NOT match `tiffany`)
- Tail-expansion loop: `TAIL_EXPANSION_STEPS = [10_000, 50_000, 200_000, 512_000]` ported from context-pct-from-jsonl.ts
- `AUTO_COMPACT_BUFFER_PCT = 16.5`, `MODEL_CONTEXT_WINDOW = 1_000_000` for context_pct normalization
- ThreadPoolExecutor(max_workers=8) for multi-identity parallelism
- Emits compact JSONL on stdout, all errors to stderr, exit 0 always
- Mode `100755` confirmed: `git ls-files -s substrate/scripts/pv-context-pct-sweep.py` shows mode `100755`

**Live cross-check on t1000 (tiffany identity):**
`python3 substrate/scripts/pv-context-pct-sweep.py --identities tiffany` emitted `context_pct=22`, matching the Skynet PV UI display within +/-1%.

**Wall-clock:** sub-second for a single identity on t1000 (warm filesystem cache).

**No parity gotchas discovered** during the readContextPctFromJsonl port. The normalization math ports 1:1: `remaining_pct = 100 - (token_sum / 1_000_000) * 100`, then `usable_remaining = max(0, ((remaining_pct - 16.5) / (100 - 16.5)) * 100)`, then `displayed = round(100 - usable_remaining)`, clamped 0-100.

## Distributor catalog row

FLEET_SUBSTRATE_CATALOG grows from 22 to 23 entries:

```typescript
{
  slug: "pv-context-pct-sweep",
  bundledPath: "/app/fleet-substrate/scripts/pv-context-pct-sweep.py",
  installPath: "~/.local/bin/pv-context-pct-sweep",
  restartHook: null,
}
```

Note: `.py` extension dropped in installPath per existing convention. restartHook null — on-demand script invoked by contextPctTimer, not a daemon.

All distributor tests pass (`npx vitest run src/backend/distributor/`):
- Test 1 count: 22 → 23
- Test 6 scriptRows count: 8 → 9

## Deviations from Plan

None. Plan executed exactly as written. The existing pv-sweep-schema.test.ts file was already present as an untracked file (28 tests) — confirmed content comprehensive, committed alongside the schema module.

## Commits

- **`36592d24`** — `feat(claude-session): pv-context-pct-sweep v1 schema module (Phase 95 Part C-1)` — Task 1: pv-sweep-schema.ts + pv-sweep-schema.test.ts
- **`310b5269`** — `feat(fleet-substrate): pv-context-pct-sweep.py Python sweep script (Phase 95 Part C-2)` — Task 2: substrate/scripts/pv-context-pct-sweep.py (mode 100755)
- **`988148d3`** — `feat(distributor): register pv-context-pct-sweep catalog row (Phase 95 Part C-3)` — Task 3: catalog.ts + catalog.test.ts + run-sweep.test.ts

## Self-Check: PASSED

- `test -f src/backend/claude-session/pv-sweep-schema.ts` → FOUND
- `test -f substrate/scripts/pv-context-pct-sweep.py` → FOUND
- `git ls-files -s substrate/scripts/pv-context-pct-sweep.py | grep '100755'` → PASS (mode 100755)
- `grep -c "pv-context-pct-sweep" src/backend/distributor/catalog.ts` → positive
- `npx vitest run src/backend/claude-session/pv-sweep-schema.test.ts` → 28 tests pass
- `npx vitest run src/backend/distributor/` → all pass
- `git log --oneline | grep 36592d24` → FOUND
- `git log --oneline | grep 310b5269` → FOUND
- `git log --oneline | grep 988148d3` → FOUND
