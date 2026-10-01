# Shape: agent-side identity un-archive — restore the sentinel-drop pattern across the fleet

**Declared:** 2026-10-01
**Status:** declared (not opened)
**Vehicle:** TBD at /open time

## What this is

Shape 1 shipped identity un-archive assuming the fleet Matrix admin creds (`~/fleet/roles/box-maintainer/matrix-admin-t1000.json`) live on every host. They don't — only T1000 carries them. Un-archiving an identity whose home host is anything other than T1000 silently stalls at the supervisor's reactivate step because the admin creds file is missing.

An inline correction landed alongside this declaration (same session, 2026-10-01) that moves Matrix reactivate + token mint + relay.json rewrite from the agent-supervisor into the backend `identity-unarchive.ts` route. That restores the **frontend-triggered** path from any host — the backend endpoint always runs on T1000 where the admin creds live, and reaches out via SSH to the identity's home host for the relay.json rewrite + sentinel drop. **It does not restore the agent-side sentinel-drop pattern** — an agent on a non-T1000 host can still drop `.unarchive-requested` into the archive folder, but the supervisor's whoami safety-check will refuse the sentinel (401 on the stale token = account still deactivated) and the agent has no way to do the Matrix step itself.

This shape re-enables agent-side identity un-archive from any host.

## The design question

How does the local agent-supervisor get a reactivated Matrix account + fresh access_token without carrying the fleet admin creds locally?

Three candidate architectures surfaced during the inline-correction session:

- **A — Spread the admin creds via substrate.** Reject-tier for crown-jewel blast radius. The fleet admin token can create accounts, reset passwords, deactivate anyone. Putting it on every managed host is a security regression even though it would make the correction trivial.

- **B — Agent calls the user-facing backend un-archive endpoint directly.** Clean but loses the sentinel-drop pattern (the agent would be using the same HTTPS route the frontend uses, not touching a sentinel at all). Also needs an agent-usable auth path to the backend that doesn't exist today; sessions are user-scoped.

- **C — Supervisor delegates the Matrix step to T1000 via a scoped internal endpoint.** Supervisor on each host sees `.unarchive-requested`, calls a new T1000 backend endpoint `/internal/matrix-reactivate` with `{mxid, password}`, gets `{access_token}` back, writes relay.json locally, does folder move locally. The agent-facing contract stays identical (`touch .unarchive-requested` inside the archive folder). The crown-jewel admin creds stay on T1000. The new endpoint is a scoped capability (reactivate + mint for a specific mxid) carrying only the authority this operation needs — not the full admin token.

C is the leading design. The /open discussion needs to pin down:

- **Auth on the internal endpoint.** Tailnet-only is the baseline (T1000's backend is already reachable only inside the tailnet). Whether to also require a shared bearer secret in `~/fleet/host/matrix-reactivate-token` as a defense-in-depth measure — or lean on tailnet membership alone — is a call during /open.
- **Caller identification.** Does the endpoint care which host is calling? For the first cut it doesn't need to — reactivate+mint for a mxid is a pure capability. But logs should carry the caller's tailscale hostname so the audit trail is useful.
- **How the supervisor discovers T1000's address.** Reuse `~/fleet/host/parent` (already distributed) + a known path, or introduce `~/fleet/host/skynet-backend` with the base URL. Reusing existing config is simpler if the shape fits.
- **Failure modes.** T1000 unreachable (network partition, tailnet trouble, backend down): sentinel retained, next tick retries — same semantics as the existing retry loop. T1000 returns 4xx (mxid unknown, admin creds dead): sentinel retained, LOUD log, operator resolves — same semantics as the existing permanent-error path.
- **Interaction with the whoami safety-check added by the inline correction.** Once this shape ships, the supervisor's whoami probe becomes redundant for well-ordered flows (supervisor reactivates then whoami succeeds) but still useful as a crash-recovery guard. Decision at /open: keep as belt-and-suspenders, remove, or re-shape as a positive assertion the scanner makes AFTER its own reactivate call.

## Prior context

The inline correction (same session, 2026-10-01) landed:

- Backend `identity-unarchive.ts` extended with Matrix reactivate + mint + relay.json rewrite BEFORE the sentinel drop. Uses the existing `createOrUpdateUser` and `loginAsUser` primitives from `src/backend/matrix/matrix-admin-client.ts`. For LOCAL identities it writes relay.json via direct fs; for REMOTE identities it writes via SSH using the archive-tree writer extended to accept `relay.json` as a second whitelist entry.
- Supervisor `agent-supervisor.sh` stripped of the Matrix admin block in the identity un-archive scanner. The scanner retains preconditions (name collision, roles-all-live), folder move, sentinel delete, `.dormant` / `.no-dormancy` logic. New safety: a whoami probe against the relay.json's token before `mv`. 401 = account not reactivated = refuse + LOUD + sentinel retained. This prevents half-un-archives from direct sentinel drops.
- id skill updated: for identities, agent-side sentinel-drop is **temporarily restricted** — supervisor refuses sentinels for not-yet-reactivated accounts. Agents direct the user at the frontend path (conversation search modal → kebab → "Un-archive") for identity un-archive from any host that isn't T1000. Roles + apps continue to work via sentinel-drop as before.

The `matrix-admin-client.ts` primitives (`createOrUpdateUser`, `loginAsUser`) are the exact calls the supervisor used to make in bash; both are already covered by unit tests and used by `identity-birth.ts`. This shape would call them from a new internal route rather than from the per-host supervisor.

Shape 1's live-fleet spike (2026-09-30) is still the governing evidence on Matrix reactivation fidelity — rooms don't survive, accounts do. The caveat is already documented and accepted; this shape doesn't change that.

## What would make it wrong

- If the internal endpoint grows beyond "reactivate + mint for mxid X." It's a scoped capability; adding user creation, deactivation, or room admin to the same endpoint widens the blast radius back toward the shape-A reject.
- If an agent on any host can trigger reactivation for ANY mxid including other users' identities. Tailnet-only addresses "random internet client"; shape should think about whether to also check that the caller has some claim on the identity (same user? same host?). Leaning toward "no additional check needed" because reactivation is reversible and the sentinel-drop still requires physical access to the archive folder which is a stronger authorization — but worth a /open beat.
- If the supervisor's whoami safety-check is removed before this shape ships. Keep the crash-recovery guard until the end-to-end flow is proven under real load.
- If the id-skill isn't updated to re-enable agent-side identity un-archive language once this shape ships. The current language says agents must direct the user at the frontend path for identity un-archive — that's the limitation we're removing.

## Scope edges

**In:**

- New internal backend endpoint on T1000 (`/internal/matrix-reactivate` or similar; path decided at /open).
- Shared secret file + distributor catalog entry if the /open discussion chooses defense-in-depth over tailnet-only.
- Supervisor rewrite: call the T1000 endpoint instead of refusing with the whoami probe. Whoami probe either stays as belt-and-suspenders or is reshaped to run AFTER the supervisor's own reactivate call.
- Tests for the new endpoint + updated supervisor shell tests.
- id-skill revert: re-enable agent-side identity sentinel-drop pattern language (unconditional across hosts).

**Out:**

- Any changes to the frontend-triggered backend route (`identity-unarchive.ts`). That route is working after the inline correction; this shape only touches the agent-side pipe.
- Changes to role or app agent-side un-archive. Those don't need the Matrix step and already work from any host.
- Any revisiting of Matrix reactivation fidelity (rooms don't survive — shape 1's accepted caveat stands).

## Vehicle notes

TBD at /open time. Candidates:

- **inline** — scope is bounded (one new endpoint + one supervisor edit + test migrations + id-skill revert + distributor entry). ~6 commits.
- **GSD phase** — if the shared-secret distribution turns out to need multiple phases of design (bootstrap, rotation, revocation) or if the supervisor rewrite touches enough other scanners to warrant wave-based planning.

The inline-correction that lands alongside this declaration is the sibling precedent — same campaign, similar surface area, similar commit count. Pointing at inline for /open as the leading candidate.
