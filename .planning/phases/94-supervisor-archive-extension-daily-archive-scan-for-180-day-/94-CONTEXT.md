# Phase 94: supervisor archive extension — daily archive-scan for 180-day dormant identities (Shape 2 of id-skill-revamp campaign) - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Teach the per-host agent-supervisor a second job alongside its existing "keep identities alive" role: on a daily cadence, walk the box's identities and retire the ones that have been genuinely dormant for 180 days. Retirement means (1) moving the identity's folder into an `archive/` sibling of the identities tree, (2) killing any live tmux session for the identity, and (3) self-deactivating the identity's matrix account using its own credentials. All three steps are local to the host; no admin credential participates, no cross-service coordination happens, and no announcement is emitted anywhere.

Shape 2 of 4 in the id-skill-revamp multi-shape campaign. Hard-depends on Shape 1 (Phase 92 pin-sentinel-migration) — the retire mechanism's `.pinned` guard reads the sentinel that Phase 92 puts on disk. Shapes 3 (on-disk tree consolidation) and 4 (substrate prose polish) are downstream phases.

</domain>

<decisions>
## Implementation Decisions

### Trigger + cadence
- **D-01:** Archive-scan is a **daily** sub-loop, not a separate script or a systemd unit. Lives inside `substrate/scripts/agent-supervisor.sh` as a branch on the existing reconcile loop: check "have I run the archive scan in the last 24h?"; if not, run it now. One file, one distribution path, no drift risk between "which identities exist" (supervisor's authority) and "which are being considered for retire."
- **D-02:** The "last archive scan ran at" timestamp is state the supervisor owns. Planner picks the mechanism (mtime of a marker file, JSON state, timestamp file — whatever matches how the supervisor already persists its own state today). Cadence is "at least 24h since last run" — no anchor on wall-clock time-of-day; whichever tick crosses the 24h boundary triggers the scan.

### Guards (any one skips the identity)
- **D-03:** Skip if `~/.claude/identities/<name>/.pinned` sentinel is present (Shape 1's on-disk pin state). One-line disk check, same shape as `.no-dormancy` reader.
- **D-04:** Skip if `~/.claude/identities/<name>/.no-dormancy` sentinel is present (existing always-on affordance). One-line disk check.
- **D-05:** Skip if the identity is a coordinator. Detection: read the identity's own metadata file frontmatter and match `coordinator: true` under the **strict-detection rule already codified in the id-skill body** (between the FIRST two `---` lines of the identity file, top-level key on its own line, unquoted boolean `true`, not commented, not inside quoted string, not in body prose). No new sentinel — the frontmatter marker IS the source of truth and stays that way (no drift-risk second copy).

### Freshness signal
- **D-06:** Freshness = modification time of the identity's relay receiver cursor file (`~/.claude/identities/<name>/relay-state/since`). Every successful sync (~30s while any session for the identity is up) rewrites the file with a fresh `next_batch` token, so mtime is a reliable proxy for "any session for this identity has been active recently." This includes matrix-message wakes, scheduled wake-ups, and manual `/id <name>` loads — every path that spins the identity up starts the receiver.
- **D-07:** **Fallback:** if the cursor file does not exist yet (brand-new identity that has never woken, or hand-cleared cursor), fall back to the identity folder's own modification time. Brand-new identity created today has fresh folder mtime, so this handles the "never used yet" case correctly without a special "recently created, defer" branch.
- **D-08:** **Threshold: 180 days.** Uniform across all identities (actors, persistent-beings, coord-spawned actors alike). No per-class differentiation — the pin and no-dormancy affordances do the "keep this alive" work explicitly.
- **D-09:** No defensive guards against filesystem operations that reset mtimes en masse (backup restore, cross-filesystem move without preserve, Shape 3's manual per-box tree migration). Trust the signal. Exceptional operations are the maintainer's problem to sequence around — either use `mv -a` / preserve timestamps, or `touch` cursors right before the maintenance to reset the clock.

### Retire action (three steps, deliberate order)
- **D-10:** **Step 1 — move folder.** `mv ~/.claude/identities/<name>/ ~/.claude/identities/archive/<name>/`. First because the supervisor's own keep-alive loop reads the active identities tree; once the folder is out, no new sessions for this identity can spin up regardless of what happens in the remaining steps. `archive/` sibling is created on demand if it doesn't exist.
- **D-11:** **Step 2 — kill tmux.** Kill any live tmux session for the identity using the supervisor's existing session-naming convention (case-insensitive match, `-t <name>` not `-t =<name>` — codified in `agent-supervisor-handoff.md`). No-op if nothing is running.
- **D-12:** **Step 3 — deactivate matrix account.** Read the identity's credentials from the (now archived) `relay.json`, `POST /_matrix/client/v3/account/deactivate` with `Authorization: Bearer <own-token>`, body `{"auth": {"type": "m.login.password", "user": "<mxid>", "password": "<pwd>"}, "erase": true}`. No admin token. Verified by Naomi during campaign shape development against a live Synapse 1.157.2 instance — produces post-state identical to the admin-side deactivate path (deactivate revokes the calling token as part of the operation, which is why the tmux kill came first — the kill doesn't need matrix creds).

### Failure handling
- **D-13:** Any step failing aborts the whole retire; the next daily pass retries from the top. Move-first ordering makes retries idempotent: step 1 is idempotent (if the folder is already in `archive/`, no-op / skip); step 2 is idempotent (killing a non-existent session is a no-op); step 3 is idempotent per Synapse (deactivating an already-deactivated account returns success). Retries are safe regardless of where the previous attempt failed.
- **D-14:** **Retire-stuck sentinel.** After 3 consecutive daily-pass failures on the same identity, drop `retire-stuck` sentinel in the identity's archived folder AND log loudly to the supervisor's operational log. Purpose: prevent silent-forever failure. The maintainer can grep for the sentinel across boxes when they want a fleet-wide view of what needs manual attention. Planner picks the counter mechanism (per-identity state file, an empty sentinel per failed attempt with mtimes for chronology, or something else that survives supervisor restarts).

### Announcement (none)
- **D-15:** Retirement makes **no deliberate notification wire.** No `history.md` entry in the role folder. No DM to the coordinator. No ping to Alice. No entry in a fleet events log. The move-plus-kill-plus-deactivate IS the whole event; discovery is by observation (identity is no longer in Skynet's conversation list because Skynet's periodic per-host identity refresh sees it's gone from the active tree) or by looking at the `archive/` folder. Whatever the supervisor's operational log naturally emits about its own work is diagnostic plumbing, not an announcement — do not add extra logging with the intent of "announcing." Loud logging around the retire-stuck sentinel (D-14) is a distinct case and is explicitly wanted for that path.

### Un-archive (out of scope)
- **D-16:** No un-archive path is built in this phase. Alice: *"unarchiving will be a concept that we get into formally later."* The folder move is trivially reversible (`mv` back), but the matrix deactivation is permanent per Synapse (the username stays reserved; a re-registration would land under an ordinal like `<name>-2`). Formalizing un-archive is a later concept, not this phase. Do NOT build safety valves or human-confirmation delays around the retire on the theory that "we might want to undo" — the retire is what it is.

### Skynet-side downstream (natural, no code)
- **D-17:** Skynet's existing periodic per-host identity refresh scans the active identities tree on each cycle. When it finds an identity is no longer in the active tree, it naturally drops the row from the conversation list. **No push wire, no explicit "identity retired" notification** is added to Skynet in this phase. The conversation-list disappearance is a natural consequence of Skynet's existing polling; no coordination between agent-supervisor and Skynet is needed.

### Claude's Discretion (implementation-level, planner decides)
- Exact form of the "last archive scan ran at" state persistence (marker mtime, JSON state, sqlite in the supervisor's state dir — whichever matches existing supervisor state patterns).
- Exact form of the retire-stuck counter (per-identity JSON, a series of empty sentinel files with mtime chronology, a single counter file — planner picks based on supervisor code style).
- How to handle an existing `archive/<name>/` from an earlier retire (should be impossible in this shape since un-archive isn't built, but the planner may add a defensive suffix like `<name>.<epoch>/` to make the move always succeed).
- Whether the daily branch runs inline on the reconcile tick that crosses the 24h boundary, or spawns a background task so the reconcile loop stays snappy. Given the scan is cheap (walk identities dir + stat files + read frontmatter for coord check), inline is probably fine; planner confirms.
- Test surface: guard function unit tests (pin, no-dormancy, coord detection with the strict-detection edge cases from the id-skill body), freshness read with cursor + folder-mtime fallback, retire action end-to-end against a throwaway identity + throwaway matrix account, retry-from-top idempotency, retire-stuck sentinel firing after 3 failures.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/shapes/shape-supervisor-archive.md` — Alice's locked shape from the /open pass 2026-09-09. All D-01..D-17 above are derived from it. Read this first.

### Campaign context
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md` — original whole-campaign shape (multi-phase). This phase is Shape 2 of 4. The archival section of the campaign shape provides the philosophical framing that this phase implements.
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/bounty.json` — campaign hub bounty with cross-shape todos + related links.

### Upstream dependency (Shape 1, code-complete at HEAD)
- `.planning/phases/92-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/92-CONTEXT.md` — Phase 92 decisions. The `.pinned` sentinel that Shape 2's D-03 guard reads.
- `.planning/phases/92-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/92-01-PLAN.md` through `92-04-PLAN.md` — Shape 1's implementation. The sentinel semantics (presence-only, empty file, `[ -f "$dir/.pinned" ]` reader) are established here.

### File the phase modifies
- `substrate/scripts/agent-supervisor.sh` — the per-host supervisor. This phase adds a daily archive-scan branch to its existing reconcile loop. Fleet substrate — distributed to every managed box via Skynet's fleet-substrate distributor on the next sweep after commit lands on origin.
- `~/.claude/roles/box-maintainer/agent-supervisor-handoff.md` — full context transfer for the supervisor: canonical source, install pattern, version-detect (`cmp -s`), core invariants (`KillMode=process`, case-insensitive session matching, `-t <name>` not `-t =<name>`), sentinel semantics, incident-learnings. **READ before touching the supervisor.**

### Files the phase READS (contract references, no changes)
- `substrate/skills/id/SKILL.md` § "Coordinator mode" (around line 372) — the strict-detection rule for `coordinator: true` in identity frontmatter. Guard D-05 must match this rule verbatim (between the first two `---` lines, top-level key on its own line, unquoted `true`, not commented, not in body prose). Any drift between the id-skill's detection and the supervisor's detection would cause coordinator identities to be incorrectly classified.
- `substrate/scripts/recv.sh` line 235 — `SINCE="$NB"; printf '%s' "$SINCE" > "$SINCE_FILE"` — the unconditional cursor write after the CURSOR GUARD passes. Load-bearing mechanical fact: mtime advances every ~30s any session is up, not only on inbound messages. If this write becomes conditional (e.g. gated on message presence), Shape 2's freshness signal is invalidated.
- `substrate/skills/id/SKILL.md` § "Making yourself always-on — the `.no-dormancy` sentinel" — the existing sentinel precedent. `.pinned` guard (D-03) follows identical read semantics.

### Fleet substrate distribution (confirms the code path)
- `src/backend/distributor/catalog.ts` — canonical catalog of what the fleet substrate distributor sweeps. `agent-supervisor.sh` is a first-class entry. Once this phase's changes land on origin, the distributor spreads them to every managed box on its next sweep. No manual per-box install.

### Homeserver deactivate reference (mechanics verified)
- Bounty (Naomi's verification, campaign shape §Prior context): live Synapse 1.157.2 confirmed self-deactivate with identity's own token + password + `erase:true` produces post-state identical to admin-side deactivate; username stays permanently reserved; `user_directory/search` filters deactivated accounts cleanly. The exact endpoint call shape is in the shape file's D-12 quote. No new server-side work is needed for this phase — the endpoint is standard Matrix spec.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Supervisor state persistence** (`agent-supervisor.sh`): whatever mechanism the supervisor uses today for its own per-tick state (last-reconcile time, per-identity tmux session tracking) is the pattern the "last archive scan ran at" state (D-02) should mirror. Do not invent a new state file convention.
- **Sibling sentinel readers** (`agent-supervisor.sh`, `id` skill body): `.no-dormancy` and `.recycle-requested` readers are one-line `[ -f "$dir/.sentinel" ]` disk checks. Guards D-03, D-04 use the same shape. D-05 (coordinator marker) is a lightly more complex frontmatter grep, but still local.
- **Matrix auth via curl** (`recv.sh`): the receiver's own `curl -H "Authorization: Bearer $TOKEN"` pattern shows exactly how to speak to the homeserver from shell. The deactivate call (D-12) is the same shape with a different endpoint + body.

### Established Patterns
- **Presence-is-meaning sentinels** (existing precedent): `.no-dormancy`, `.recycle-requested`, and (post-Shape-1) `.pinned` all follow this convention. `retire-stuck` (D-14) MUST follow the same rule — empty file, presence-only, no encoded content. If the planner needs to encode counter state, it lives elsewhere (per-identity state file in the supervisor's state dir); the sentinel itself stays contentless.
- **Case-insensitive tmux session naming** (supervisor invariant, `agent-supervisor-handoff.md`): the tmux kill (D-11) MUST use `-t <name>` not `-t =<name>` and match case-insensitively — this is a known trap that has bit prior supervisor edits.
- **Idempotent by construction**: every step in the retire action (D-10, D-11, D-12) is idempotent by nature or by defensive check. The planner should reason about this explicitly — retry safety depends on it.
- **Fleet substrate distribution** (`src/backend/distributor/catalog.ts`): edits to `agent-supervisor.sh` are made in the Skynet repo, land on all boxes via the next distributor sweep. **Never hand-edit the installed copies on any box** (e.g. `~/.local/bin/agent-supervisor`). Fleet rule.

### Integration Points
- **Skynet's per-host identity refresh** (existing code path, no new integration): Skynet polls each managed host for its list of active identities and reconciles the conversation list. When the archive move (D-10) completes, the identity is no longer in the active identities tree; Skynet's next poll sees it's gone and drops the conversation row. No push wire, no new API surface, no cross-service message. Planner should verify (spot-check the poll cadence + reconciliation logic) but should NOT add any coupling between supervisor and Skynet for this phase.
- **agent-supervisor's existing tmux session lifecycle**: the supervisor already knows how to kill sessions (that's what `.recycle-requested` triggers). Retire's step 2 (D-11) reuses the same tmux invocation shape — no new session-management code, just a call-site for an existing helper.

### Test Considerations
- Guard functions can be unit-tested against a temporary identity folder with various combinations of sentinels + frontmatter.
- The retire action's steps can be unit-tested individually. End-to-end retire against a throwaway matrix account (register → deactivate via the same path the supervisor uses) confirms the deactivate call shape works against a live homeserver. Naomi's verification during campaign development gives high confidence but a shipping test locks it.
- Retire-stuck counter behavior: simulate 3 consecutive daily-pass failures (mock the deactivate call to fail) and confirm the sentinel drops + log fires on the 3rd fail, not the 1st or 2nd.
- Retry-from-top idempotency: run retire twice in succession without resetting the identity folder; second run should complete cleanly as a no-op (or as a normal retire if the first run partially completed).

</code_context>

<specifics>
## Specific Ideas

- **180-day threshold** — Alice's number from the campaign shape, thumbs-up during Shape 2 /open pass. Not a knob exposed to configuration in this phase (planner does not add a `--threshold-days` CLI flag or environment variable).
- **Daily cadence** — Alice thumbs-up during /open, chosen over 6-hourly (campaign shape's placeholder), once-per-supervisor-start, and once-per-tick. Reasoning: threshold is measured in days; being off by hours or a day is invisible.
- **Move-first ordering** — Alice thumbs-up during /open. The campaign shape had kill → deactivate → move; this phase's shape flipped it after grill discussion of failure modes.
- **Fully silent retirement** — Alice 2026-09-09 verbatim: *"No announcement of any kind."*
- **Un-archive out of scope** — Alice 2026-09-09 verbatim: *"unarchiving will be a concept that we get into formally later."*
- **Coord exemption** — Alice 2026-09-09 verbatim: *"Coordinators are not expected to be no dormancy, that's just not a thing, and I think we should not archive coordinators."*
- **Cursor mtime as freshness signal** — Alice corrected a mid-grill misread on my part: mtime advances on every ~30s successful sync (verified against `recv.sh` line 235), not only on inbound messages. That correction is what enabled the "one signal, no supplementary heuristics needed" cleanness of the mechanism.

</specifics>

<deferred>
## Deferred Ideas

- **Un-archive path** — folder move back + re-registration under ordinal name + Skynet conversation-list re-injection. Out of scope per D-16; formalized later.
- **User-facing archive UI in Skynet** — a "manage archived identities" surface. Explicitly rejected in the campaign shape ("no user-facing archive UI in this scope — the manual archive affordance is explicitly deferred as a 'maybe later' addition").
- **Configurable threshold** — a per-role or per-identity override on the 180-day threshold. Excluded to keep the mechanism uniform; the pin + no-dormancy affordances do the "keep this alive" work.
- **Signal heuristics beyond cursor mtime** — secondary file checks, content-based heartbeats, multi-signal composite freshness. Excluded per D-09 (trust the signal); defensive complexity for problems that haven't happened just increases surface.
- **Announcement wire for routine retirements** — history log entry, coord DM, Alice ping. Excluded per D-15 (silent by design); routine retirements should feel unremarkable under the task-scoped paradigm.
- **Per-identity-class differentiated thresholds** — e.g. a shorter threshold for coord-spawned actors on the theory that task-scoped actors "should" retire faster. Explicitly considered and rejected in the shape's "tempting but no" section.
- **Cross-box coordination for retirement** — a fleet-wide "this identity is being retired everywhere" broadcast. Excluded because identities are per-box; if the same pool name is used on two boxes, they're independent identities that happen to share a name.
- **Guards against filesystem operations that reset mtimes en masse** — defensive code to detect that a backup restore or cross-filesystem move happened and defer retirement. Excluded per D-09; maintainer's problem to sequence around.

</deferred>

---

*Phase: 94-supervisor-archive-extension*
*Context gathered: 2026-09-09*
