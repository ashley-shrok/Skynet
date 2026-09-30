# Shape: host-side un-archive — supervisor reverses the archive for each of the three types when it sees the intent sentinel

**Opened:** 2026-09-30
**Vehicle:** inline (this session)

## What this is

The host-side half of the un-archiving campaign. When someone leaves an un-archive intent sentinel inside an archived identity, role, or app folder — agent hand-drop today; UI + endpoint later in shape 2 — the box's supervisor reconcile loop picks it up on its next tick and does the actual reverse-of-archive work. For identities that means reactivating the Matrix account, minting a fresh access token, marking the identity dormant so the harness stays idle, then moving the folder back to the live tree. For roles it's a folder move. For apps it's a folder move plus reinstalling the systemd unit so the app runs again — folding the standalone restore script that used to do the app half into the supervisor itself and removing that script from the app-provisioning skill and from the substrate distributor's catalog.

## Shape

Three parallel scanners live inside the supervisor's reconcile tick, one per archived-object type. Each walks its own archive directory on every tick looking for the un-archive intent sentinel. When one is found the scanner runs a pre-flight (does a live object with the same name/slug/key already exist? if yes, refuse loudly, delete the sentinel, do nothing else — the operator resolves the collision manually), and then the type-specific reverse-of-archive body.

**Identity scanner** has an extra pre-flight: read the archived identity's frontmatter, extract every role listed (the field can be a scalar name or a YAML list — either flow-style or block-style, both must parse), and confirm every listed role has a live folder. If any is still archived, refuse and delete the sentinel with a LOUD log naming the missing role(s); the user un-archives those first, then re-issues. Once the pre-flight passes, the scanner:

1. Reactivates the identity's Matrix account by hitting the homeserver's admin user-update endpoint with the fleet admin token (`deactivated=false`, password preserved). Three-attempt exponential backoff on transient failures, mirroring the retire path's step-1 posture. Idempotent — a re-run against an already-alive account returns 200 and we treat that as success.
2. Mints a fresh access token via the admin login-as-user endpoint, again with the fleet admin token. Atomically rewrites the archived identity's `relay.json` (tmp+rename) to replace the stale token with the fresh one; password and other fields stay untouched.
3. Unless the archive folder carries `.no-dormancy` from before archive (in which case the always-on intent is preserved), writes `.dormant` inside the archive folder.
4. Deletes `.unarchive-requested` from the archive folder.
5. Moves the folder from archive to live.

The dormancy sentinel travels with the folder because it was written before the move; the moved-back identity is now visible in the sidebar, its Matrix account is alive with a fresh token, and it wakes naturally when a DM lands or a scheduled wake-up fires — same mechanism the supervisor already uses for idle-dormancy'd identities. A pinned/always-on identity that had `.no-dormancy` set before archive comes back auto-launching, because `.dormant` was never written.

**Role scanner** body: delete the intent sentinel, mv the folder back. Nothing cascades. Identities that were retired alongside the role at archive time stay retired until independently un-archived.

**App scanner** body inlines what the standalone app-restore script used to do: read the archived port from the systemd unit that was stashed inside the folder at archive time, take the same file lock the app-provisioning create path uses, verify no live app has already claimed that port (if it has, refuse and delete the sentinel with a LOUD log), mv the folder back, install the unit file to its usual user-systemd location, remove the stash from inside the moved-back folder, daemon-reload, enable-and-start, sanity-check that the unit reaches active state (WARN log if not). The standalone script is deleted from the app-provisioning skill folder in the same session and its entry stripped from the substrate distributor's catalog so old copies stop propagating to fleet boxes.

**Retry semantics** mirror the archive-side scanner: any transient failure leaves the intent sentinel in place so the next reconcile tick retries; permanent failures (collision, missing prerequisite, unrecoverable Matrix error, port stolen) delete the sentinel and log LOUD so the operator sees it and can decide what to do. The Matrix reactivate + token-refresh curls carry three-attempt exponential-backoff on 5xx / network errors; 4xx (other than the specific idempotent 200) is treated as permanent.

**Ordering discipline** — the sentinel-delete sits between "we're committed to un-archiving" and "we've committed" — the pattern mirrors the archive scanner's step-4a-before-4b sentinel-delete. A crash between delete and mv leaves the sentinel gone and the folder still in the archive tree; the operator retries via a fresh sentinel drop. The alternative (delete-after-mv) leaks orphan sentinels in the live tree that the scanner doesn't see, so the archive-side ordering is the right prior art.

## Philosophy

Symmetric with archive. Same disk-gesture vocabulary (an intent sentinel dropped inside the target folder), same tick cadence, same tolerance for retry, same LOUD-on-permanent-failure posture. The un-archive path uses existing sentinel and mechanism vocabulary rather than inventing new ones — `.dormant` already means "don't launch the harness, wake on incoming events", which is exactly what we want for a moved-back identity. The identity comes back as dormant, not as running work — un-archive reverses archive, it does not resume execution. If the user wants the identity active she sends a DM or lets a wake-up fire; the existing dormant-branch machinery does the rest.

Fold-in of the app-restore script consolidates authority for un-archiving apps into the supervisor, matching how the identity and role paths already work. The former split (script in a skill, invoked out-of-band) was archaeology from before the sentinel-mechanism generalized to app archive; the un-archive side lands cleanly consolidated.

## Prior context

Archive already works this way for all three types today. The archive sentinel drops inside the LIVE folder; a per-type scanner in the supervisor picks it up every reconcile tick; the scanner runs the archive body (Matrix deactivate + graceful harness exit + tmux kill + mv for identities; folder mv for roles; invoke the standalone archive script for apps). The three archive paths landed in phases 115, 133, and the app-archive shape respectively. Un-archive is the inverse of each, built on the same primitives (per-object file operations, admin API curls, mv operations, flock discipline for the app path).

The identity-side retire flow already carries a bash Matrix admin curl with three-attempt backoff and idempotent-retry semantics; the un-archive reactivate mirrors that shape. The Matrix admin client on the backend side already contains TypeScript primitives for user-update-with-deactivated-false and login-as-user; the supervisor doesn't call those (bash-side symmetry with the existing retire path), but they document the endpoint shapes and idempotency contract. The fleet admin token lives at a well-known path in the box-maintainer role folder; retire's step 1 already reads it via jq.

The `.dormant` sentinel is written by the supervisor itself today when an identity is idle-swept; its wake path (matrix_peek or schedule_peek → do_wake → drive() --resume) is the same mechanism un-archived identities will use. Session transcripts at `~/.claude/projects/-home-...-workspace/<uuid>.jsonl` persist across archive (the workspace-repo cleanup only removes safely-re-clonable git repos, not the harness's own state elsewhere), so a moved-back identity's `drive() --resume` finds its old session ID and resumes cleanly.

## What would make it wrong

- If un-archiving an identity results in the harness auto-launching before the user pings it, the shape has missed the point. Un-archive is a reversal of the archive gesture, not a "resume work" gesture; a moved-back identity is dormant.
- If un-archiving a role auto-un-archives every identity that was retired alongside it during archive, the shape has missed the point. Those cascades are separate user choices; role un-archive is scoped to the role folder alone.
- If the pre-flight and the scanner disagree about whether an operation should proceed (e.g. pre-flight against a stale in-memory snapshot; scanner sees fresh disk state and disagrees), the wrong-shape signal is the operation completing anyway on stale info. Both must read from disk at execution time; no snapshot passing between layers.
- If Matrix reactivate succeeds but token refresh doesn't and we proceed anyway, the moved-back identity silently fails to sync — its relay receiver 401s on every poll. Both must succeed before mv, or the scanner iteration aborts and the sentinel stays for next tick.
- If reactivation loses room memberships and the shape doesn't compensate, an un-archived identity's peers can't find her in the rooms they used to share. The fidelity spike settles whether this happens; if yes, the compensating force-join step folds into the identity scanner in the same shape (uses the admin `/join/{roomId}?user_id=<mxid>` API — a primitive that already exists for the "elevate skynet-admin into legacy rooms" flow).
- If the app scanner mv's the folder back but leaves the systemd unit uninstalled or inactive, the app appears to be un-archived from the user's perspective but doesn't actually run. Every step (mv → install → daemon-reload → enable+start → active-check) must complete or the scanner logs a WARN and the operator investigates.
- If a mid-flight sentinel-delete happens without the folder move completing, the intent is silently lost. Sentinel deletion sits between "committed" and "done"; the operation is best-effort atomic across those two, and any deviation logs LOUD.
- If `.no-dormancy` on an archived identity is silently downgraded to "dormant on un-archive," the user's always-on intent is lost. Every un-archive respects the pre-archive `.no-dormancy` presence.

## Scope edges

**In:**
- Three supervisor scanners inside the reconcile loop.
- Matrix reactivate + fresh-token-mint bash curls in the identity scanner, mirroring the retire path's admin-API shape.
- Multi-role frontmatter parsing in bash via Python inline (for the YAML shapes bash awk can't reliably handle).
- Fold-in of the app-restore script + deletion from the skill folder + removal from the substrate distributor's catalog + grep-and-strip of references in the app-provisioning skill's `SKILL.md`.
- Supervisor tests using the scratch-dir env-override pattern the existing supervisor tests already use (`AGENT_IDENTITIES_ARCHIVE_DIR`, `AGENT_ROLES_ARCHIVE_DIR`, `AGENT_APPS_ARCHIVE_DIR`, `AGENT_APP_ARCHIVE_SCRIPT`-style envs).
- Matrix reactivation fidelity spike on a throwaway identity — load-bearing verification before shipping. Outcome may add a room-rejoin compensating step to the identity scanner in this same shape.

**Out (moved to shape 2 — frontend + backend):**
- Three POST endpoints and their route tests.
- Per-type primitive extensions to write sentinels into the archive tree from the backend.
- Frontend affordances for un-archive (drawer, modal, whatever surface shape 2 picks).
- Edits to the id skill documenting the user-facing affordance and the sentinel-drop pattern.

**Out (explicitly not this campaign):**
- Cascading un-archive (role un-archive does NOT touch identities; convenience-cascade is a shape-2 UI discussion).
- Re-cloning workspace repos that archive cleaned. Un-archive leaves workspace as archive left it; the identity re-clones what it needs on next task.
- Fixing the archive-side cascade's scalar-only role check (multi-role identities can escape the cascade today, per adjacent bug flagged in-session). Noted; not remediated here.

**Tempting but no:**
- Adding a `/id unarchive` agent slash-command. Concept-open decided no: agents drop the sentinel directly, same disk gesture as archive from an agent's peer perspective.
- Introducing a new dormancy sentinel (e.g. `.dormant-hold` or `.no-auto-start`) as an alternative to reusing `.dormant`. The existing sentinel already means what we want and its wake path already exists.

## Vehicle notes

Inline in this session. The pieces (three scanners + fold-in + deletions + tests + spike) share one language, one file, and one execution mental model — parallel-wave planning in a GSD phase would add ceremony without buying isolation.

Tracking pieces of work via harness tasks as I go:

1. Identity scanner (biggest — Matrix, token, multi-role, dormancy preservation, mv).
2. Role scanner.
3. App scanner (fold-in from the app-restore script).
4. Wire the three scanners into the reconcile tick.
5. Delete the app-restore script + strip from substrate distributor catalog + grep-and-remove references in the app-provisioning skill's `SKILL.md`.
6. Supervisor tests for each scanner using the scratch-dir env-override pattern.
7. Matrix reactivation fidelity spike on a throwaway identity — gates deploy.

**Deploy gate:** full test suite green + Matrix fidelity spike passing on a throwaway identity before push. Standard multi-identity role discipline: `git pull --rebase` before push, again before `docker build`, container mutations serialized with Ashley's greenlight.

**Handoff to shape 2:** the on-disk gesture is stable after this shape ships — an agent (or a hand-drop from bash) can un-archive by writing the intent sentinel into the archive folder, and the supervisor completes the reversal. Shape 2 opens as a separate `/build` session against `shape-unarchive-frontend-backend` when this shape lands and is deployed.

**Close:** `/close unarchive-host-side` at end of session.

## Matrix fidelity spike — results + accepted caveat

Load-bearing spike executed against the live t1000 Synapse (2026-09-30). Registered a throwaway `@unarchive-fidelity-test-<epoch>` account, joined a fresh test room, sent a message; deactivated with `erase=true` (mirroring retire step 1); reactivated via admin PUT `deactivated=false` (mirroring the identity scanner's step 1); minted a fresh access token via admin login-as-user (mirroring step 2); attempted `/sync` and direct-message-read against the earlier room.

**What survives:** the account itself. Fresh token /syncs successfully; `whoami` returns the correct mxid; the account is fully alive.

**What doesn't:** room memberships. `/sync` returns empty `rooms.join`/`rooms.invite`/`rooms.leave`. Admin `/users/{mxid}/joined_rooms` returns `total: 0`. The room entity may still exist on the homeserver as a zombie (`/rooms/{room_id}` shows it with `joined_members: 0`, `forgotten: true`), but the reactivated account has no membership record. There is no admin API that lists rooms a deactivated account was PREVIOUSLY in.

**Accepted caveat (option B):** shape 1 ships without a room-rejoin compensating step. Un-archive reactivates the account and moves the folder back; rooms are not restored. Practical implication: new DMs to the un-archived identity work naturally (Matrix auto-creates a new DM room when peers send to someone with no shared room, and matrix_peek wakes the identity on it), so recontact is seamless from the sender's side. Peers with cached zombie-room IDs would send into rooms the identity is no longer in — same stale-cache problem archive itself creates, not made worse here.

**Rejected (option A):** folding a rejoin path into shape 1 by snapshotting `joined_rooms` at retire time. Rejected as scope creep — the shape's declared load-bearing invariant was "account reactivates cleanly and identity wakes on incoming DMs," both of which hold. Documented so a later maintainer sees the path considered and can revisit if peer stale-cache trouble becomes user-visible in practice.

**Follow-up hook:** if a room-inventory rejoin becomes desirable, it would land as a small dedicated shape (retire captures joined_rooms → un-archive scanner reads the snapshot and force-joins each via admin `/join/{roomId}?user_id=<mxid>` — the primitive already exists in `matrix-admin-client.ts` as `joinRoom`). Small enough for `/gsd:quick` when the need surfaces.

