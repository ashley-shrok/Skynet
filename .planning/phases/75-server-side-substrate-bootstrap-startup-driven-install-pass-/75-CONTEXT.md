# Phase 75: Server-side substrate bootstrap — Context

**Gathered:** 2026-09-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Reshape fleet-substrate distribution from **per-user browser-driven** to **system-driven**. Today the install pass is welded to the `ssh-poll-orchestrator` channel-acquire moment, which only exists while a browser session subscribes to fleet-status AND can only decrypt credentials that belong to the subscribed user. This phase decouples both: the pass runs on Skynet container startup (walking every substrate-flagged host serially), fires immediately on new-host-create, retries unreachable hosts on the existing 30s host-list refresh cadence, and reads credentials through a system-owned key so no user session is required. Existing browser-driven hook is deleted as redundant. Credential handling change is scoped narrowly to substrate-flagged hosts only. One-shot operator-run migration script for existing substrate hosts ships in-phase.

**Unblocks:** Stacy's exec-onboarding runbook Moment 7 on T800 (Aither AI+) — the moment where a freshly-provisioned user's `runsFleetSubstrate:true` VM waits for bootstrap that never fires because that user has never opened the app.

**Deliberate posture change:** The security property "credentials require the owner to be present to decrypt" is relaxed for one specific class of credentials (substrate-flagged hosts) where the property is already at odds with what the system needs to do (unattended install passes). This is the standard backend-secrets pattern applied narrowly, not a broad security-posture change. All other credentials keep per-user DEK wrapping unchanged.

</domain>

<decisions>
## Implementation Decisions

### Trigger model
- **D-01:** Startup pass runs at container boot, **serially** through every host with `runsFleetSubstrate:true`. Substrate size and host count are small enough that parallelism isn't worth the coordination cost.
- **D-02:** Host-create hook fires the install pass immediately for the just-created host as **fire-and-forget** from the create request. `POST /host/db/host` returns without awaiting the sweep.
- **D-03:** Retry cadence for hosts that failed the pass **piggybacks on the existing 30-second host-list refresh** — no new timer. Server-context orchestrator gets a periodic tick equivalent to the existing `hostRefreshEveryNTicks` semantics.
- **D-04:** Existing browser-driven install-pass hook at `ssh-poll-orchestrator.ts:2087-2152` is **removed**. Server-context path fully supersedes it; keeping it as belt-and-suspenders would be redundant no-op code (per-item idempotence already handles the no-change case).
- **D-05:** Once-per-host-per-Skynet-lifetime invariant is **preserved** — successful sweep marks the host done for this uptime; container restart re-fires. Same shape as `sweepedThisInstance` today, just owned by the new server-context orchestrator.

### Failure handling
- **D-06:** Retry-forever semantics with **distinctive loud alerting after N consecutive failures per host** (N = small number, likely 3-5, planner picks). Alert is a structured log line (new operation tag, e.g., `fleet_substrate_host_persistent_failure`) that surfaces the host as needing operator attention. Retries continue in the background regardless.
- **D-07:** Alert fires **once per host per uptime** at the N-th failure — subsequent failures for the same host log at normal severity, not re-scream. Reset counter on next successful sweep.

### Credential model
- **D-08:** Substrate-flagged hosts get credentials **wrapped with `SystemCrypto.getCredentialSharingKey()` (CSKEK)** — one representation, no per-user DEK wrap. This applies at:
  - Host create with `runsFleetSubstrate:true`
  - Host update that flips `runsFleetSubstrate` to `true`
  - Host update that changes the credential (SSH key rotation, password change, etc.) on an already-substrate host
- **D-09:** Owner accesses through the same CSKEK path. Browser terminal to a substrate host reads through the system key, not through the owner's DEK. **Single representation** — no dual-wrap sync problem.
- **D-10:** Non-substrate hosts **unchanged** — per-user DEK wrap continues exactly as today. This relaxation is scoped to substrate hosts only.
- **D-11:** Substrate-flag-toggle-**off** (rare) is **deferred out-of-phase** — credential stays CSKEK-wrapped, sweep just stops running for that host. Address only if a real case emerges.

### Migration
- **D-12:** **One-shot operator-run migration script** ships in-phase, delivered as a small script/endpoint in the codebase.
- **D-13:** Migration takes **every existing substrate-host owner's key material as input** (feasible today because both live instances — this box and T800 — have small, known user populations and Ashley has all the credentials).
- **D-14:** Per-host migration: unwrap credential using the owner's key material → re-wrap with CSKEK → update record. Atomic per host (either the swap succeeds AND the wrap flips, or nothing changes for that host).
- **D-15:** Migration script is **retired after ship** — new hosts go straight into the new model at create time, so there's no ongoing use for it.

### Test coverage
- **D-16:** Unit tests for the CSKEK wrap/unwrap swap at host-create and host-update paths.
- **D-17:** Integration test for the startup pass (server-context orchestrator boots, walks substrate hosts, marks successful ones done, leaves failures for retry).
- **D-18:** Integration test for the on-add trigger (host-create with `runsFleetSubstrate:true` fires the sweep fire-and-forget; create response doesn't block).
- **D-19:** Migration script has its own test using a fixture database with per-user-DEK-wrapped credentials → runs migration → verifies CSKEK-wrapped output + working decrypt.

### Claude's Discretion
- Exact value of N (consecutive-failures threshold before the loud alert) — planner picks a defensible small number, likely 3-5.
- Exact shape of the server-context orchestrator (new module vs. extending starter.ts vs. new subscriptionless variant of the existing orchestrator) — planner decides based on how cleanly the existing code decomposes.
- Migration invocation surface (CLI script vs. admin endpoint vs. one-shot node command) — planner picks whichever fits Skynet's existing operational patterns cleanest.
- Log-tag naming for the new operations (following the existing `fleet_substrate_*` convention).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase's shape (source-of-truth for scope)
- `.planning/shapes/shape-server-side-substrate-bootstrap.md` — Full shape agreement, opened + greenlit 2026-09-05 via `/build` → `/open`. Every "what would make it wrong" / "scope edges" / "philosophy" call lives here and governs the phase.

### Predecessor phases (substrate distribution history)
- `.planning/phases/72-*/72-CONTEXT.md` and `.planning/phases/72-*/72-01-SUMMARY.md` through `.../72-05-SUMMARY.md` — Phase 72 Plan 04 introduced the current sweep hook at `ssh-poll-orchestrator.ts:2087-2152` with the `sweepedThisInstance` Set. Understanding why that hook was placed where it was matters for the removal decision (D-04) and for reusing the once-per-instance gating shape (D-05).
- `.planning/phases/73-*/73-CONTEXT.md` and `.../73-*-SUMMARY.md` — Phase 73 (feature-02 slice 2 — Skynet-side reconcile loop) — the immediate predecessor of substrate distribution work. Establishes the `fleet_substrate_*` log-tag convention, per-item idempotence contracts, `FLEET_SUBSTRATE_CATALOG` composition, `runBootstrapForHost` behavior.

### AI+ MVP project docs (this phase slots into feature-07's unblock)
- `/home/ubuntu/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/PROJECT.md` — Overall AI+ MVP sequencing + how-to-start-a-feature.
- `/home/ubuntu/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/feature-07-linux-user-provisioning-helper.md` — Onboarding runbook Moment 7 is exactly what this phase unblocks. The furnishing script + host-registration + `runsFleetSubstrate:true` opt-in flow is defined here.
- `/home/ubuntu/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/decisions.md` — Locked calls source-of-truth for the AI+ project; check for any calls that interact with substrate bootstrap timing.

### Fleet role standards
- `~/.claude/roles/box-maintainer/box-maintainer.md` § Standing directives — coord-room announce protocol for container mutations, the push gate (deploy motion is orchestrator-owned), test discipline (scoped during dev, full-suite as ship gate), no worktrees, `git pull --rebase` before every push, etc.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`SystemCrypto` singleton** — `src/backend/utils/system-crypto.ts:6`. Provides `getCredentialSharingKey()` at line 239 (throws if key not loaded — bootstrapping loads it from env `CS_KEY` or config file). This IS the "system's key" the shape refers to. Already used in production for the user-triggered credential-sharing case. Extending its usage to cover substrate host credentials is the load-bearing crypto extension.

- **`SharedCredentialManager.encryptCredentialForUser()`** — `src/backend/utils/shared-credential-manager.ts:441`. Existing pattern for wrapping a decrypted credential payload for a specific target. Provides the encrypt-and-store shape; the new substrate-cred wrap can follow the same pattern with the CSKEK as the target key.

- **`CredentialSystemEncryptionMigration`** — `src/backend/utils/credential-system-encryption-migration.ts`. The existing migration class that swaps user-DEK-wrapped credentials to CSKEK. Currently user-triggered (requires the user's DEK to be available). The new migration script for this phase mirrors this shape but takes owner key material as external input rather than reading from the current logged-in user's DEK.

- **`runBootstrapForHost`** — `src/backend/distributor/run-bootstrap.ts:113`. The composer that runs BEFORE the catalog loop in a full sweep. Never-throws contract, structured logging. The new server-context orchestrator invokes `runSweepForHost` (which invokes this) unchanged.

- **`runSweepForHost`** — `src/backend/distributor/run-sweep.ts:87`. Full per-host sweep composer with the never-reject contract. Returns `{itemsFailed, ...}` for the caller to gate on. Reuse unchanged from server-context.

- **`FLEET_SUBSTRATE_CATALOG`** — `src/backend/distributor/catalog.ts`. The item catalog with per-item idempotence checks. Not modified in this phase.

- **`bundledReaderFromDisk`** — referenced at `ssh-poll-orchestrator.ts:2123` as `readBundledBytes: bundledReaderFromDisk`. The read-from-container path for bundled substrate bytes. Reuse from server-context orchestrator.

- **`logSweepHookError` and `fleet_substrate_*` log tags** — `src/backend/distributor/log-tags.ts:121`. Existing structured-log surface. New failure-persistence alert (D-06) adds a new tag following the same convention.

### Established Patterns

- **Once-per-host-per-Skynet-lifetime gating via a `Set<string>`** — `ssh-poll-orchestrator.ts:829-838`. Populated on fully-successful sweep only (partial failures leave the host un-marked so next tick retries). Clear on orchestrator stop. New server-context orchestrator uses the same shape.

- **Fire-and-forget `queueMicrotask` from a poll loop** — `ssh-poll-orchestrator.ts:2117`. The pattern for kicking off a background job without blocking the poll. Server-context orchestrator's periodic tick reuses this shape.

- **Per-item idempotence contracts** — every catalog item checks whether it's up-to-date on the host and no-ops if it is. Load-bearing here: no per-host "already bootstrapped" marker needed; catalog items answer that question themselves.

- **NEVER-THROW contract for sweep composer** — `run-sweep.ts:13`. `runSweepForHost` resolves even if every item fails. New callers rely on this contract; do not introduce paths that could throw uncaught.

- **In-memory SQLite crown-jewel + `DatabaseSaveTrigger.forceSave` after direct writes** — box-maintainer role file, standing directive. If the migration script or the wrap-at-create hook does direct `db.insert/update/delete().run()` calls, they MUST call `DatabaseSaveTrigger.forceSave("<reason>")` afterward (wrapped in try/catch, log-and-swallow on failure). Pattern reference: `host-autostart-routes.ts:173-181`.

### Integration Points

- **Host-create hook (D-02)** — `src/backend/database/routes/host.ts` — the `POST /host/db/host` handler is where the fire-and-forget install-pass trigger inserts. When the created host has `runsFleetSubstrate:true`, kick off `runSweepForHost` fire-and-forget after the create commits (and after `DatabaseSaveTrigger.forceSave` flushes).

- **Startup pass entry point** — `src/backend/starter.ts` (currently wires the browser-driven orchestrator via `subscription-registry.ts:73`'s `onFirstSubscriber`). The new server-context orchestrator gets started at boot from starter.ts, independent of subscription hooks.

- **Credential wrap-at-store integration** — wherever the current host-create/update path encrypts SSH credentials before writing to `sshCredentials` / `sharedCredentials`. Grep for the current encrypt-and-store call sites; branch on `runsFleetSubstrate` to select CSKEK vs. user-DEK.

- **Removal target** — `src/backend/fleet-status/ssh-poll-orchestrator.ts:2087-2152` (the fleet-substrate sweep-hook block) plus its state (`sweepedThisInstance`, `sweepInFlight` at 829/833, `.clear()` calls at 2309-2310). Also review whether the `hostRefreshEveryNTicks` cadence should be preserved on the new server-context orchestrator (D-03 says yes, piggyback).

- **Subscription-registry decoupling** — `src/backend/fleet-status/subscription-registry.ts:73/88`'s `onFirstSubscriber`/`onLastUnsubscriber` currently drive the substrate sweep's lifecycle indirectly (via starting/stopping the orchestrator). After this phase, subscription lifecycle only drives fleet-status polling; substrate sweep is orthogonal. Verify no other cross-wiring exists before deleting the sweep hook.

- **DB column** — `src/backend/database/db/schema.ts:140` (`runs_fleet_substrate` boolean, default false). No schema change needed; column already exists and is populated correctly per Phase 73's work.

</code_context>

<specifics>
## Specific Ideas

- Ashley's verbatim call on the deliberate-posture-change (from `/open` discussion, 2026-09-05): *"if I'm being honest with you, I feel like it's bullshit that the system can't just use the keys it already has."* Followed later by the sanity-check: *"like the running back end of an app has access to, you know, all of the things that it needs to function and if anyone got a hold of that stuff it would be bad right so that that's like that feels like a pretty standard pattern to me so it seems like we're not exactly like being reckless here in that sense."* — Locks D-08/D-09/D-10 as scoped-relaxation, not fleet-wide.

- Ashley's call on the migration approach (2026-09-05): *"I know the credentials for every user currently on both this instance and Stacey's instance, which are the only two instances of the app that exists. So maybe that can give us our answer because I can provide those and we can do a migration."* — Locks D-12/D-13 as one-shot operator-driven.

- Ashley's call on retry cadence (2026-09-05): *"piggybacking on the 30 second thing seems like a good idea and you know the benefit of it is that it would catch a host that comes back up pretty quickly which is nice."* — Locks D-03.

- Ashley's call on failure alerting (2026-09-05): *"Um, either first or second, whichever you think is better."* — Delegated within the choice between quiet-forever and loud-after-N-failures. Chose loud-after-N (D-06) per the AI+ project's already-locked "fail loud, trust operator to diagnose" stance.

</specifics>

<deferred>
## Deferred Ideas

- **Substrate-flag-toggle-off** — going from substrate to non-substrate on an existing host. Rare in practice. Not handled in this phase; if a real case emerges, addressed then. See D-11.

- **Extension of the CSKEK model to future classes of hosts** beyond substrate — this phase is scoped to substrate hosts only. Not a fleet-wide security-posture change.

- **Periodic mid-uptime sweeps for substrate updates** — unnecessary because substrate can't change without a container restart (bundle is baked into the container image), so container-start IS the natural sync point. Explicitly out of scope.

- **UI affordance for triggering the install pass manually** — if the automatic triggers are right, a manual button is a smell. Only add if operators actually reach for one; do not add speculatively.

- **Full history of past install-pass runs recorded in the DB** — structured logs at lifecycle boundaries are enough. Do not add a database-backed run-history table.

- **Parallelized startup pass** — serial is deliberate given current substrate size + host counts. Revisit only if the serial pass becomes a real user-visible startup delay.

- **Fleet-wide system-key wrap (drop per-user DEK for everything)** — deliberately not this phase. The relaxation is scoped to substrate hosts only.

</deferred>

---

*Phase: 75 — Server-side substrate bootstrap*
*Context gathered: 2026-09-05*
