# Phase 78: Passthrough URLs — file URL scheme (phase 1 of 2) — Context

**Gathered:** 2026-09-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a second URL pattern — `<skynet-domain>/file/<hostname>/<absolute-path>` — to Skynet's existing editable-file affordance stack (shipped in Phase 40). Agents cite these URLs in messages; frontend detects them (adding to the existing tailnet-URL detection); backend fetches the file bytes from the named host over Skynet's existing SSH machinery; the existing `EditableFileModal` opens on click with view + edit; the existing save-attaches-to-compose flow is unchanged.

Also ship the per-box parent-Skynet-domain config mechanism (single-line file `~/.claude/skynet-parent` pushed by the fleet distributor) so agents on every managed box know their parent Skynet's domain when constructing URLs.

This is the file half of the two-phase shape `shape-skynet-passthrough-urls.md`. Phase 2 (deferred to a separate phase) delivers the serve URL half (`/serve/<host>/<port>/...` reverse proxy + wildcard TLS via Route 53).

</domain>

<decisions>
## Implementation Decisions

### URL grammar
- **D-01:** Literal path segments after the hostname. Shape: `<skynet-domain>/file/<hostname>/home/ubuntu/foo.md`. Backend strips the `/file/<hostname>/` prefix and re-adds the leading slash to reconstruct the absolute path. No URL-encoding of the whole path; browsers auto-encode individual characters (spaces, unicode) at those specific chars. Rationale: matches the existing tailnet-URL pattern agents already know (`http://100.x.y.z:PORT/filename` — no encoding), matches how file URLs read on other systems (GitHub file URLs, etc.), stays agent-natural to construct.

### Broken-URL bubble UX
- **D-02:** Passive render — no preflight HEAD. URL renders with the pencil affordance whenever its extension is whitelist-eligible (same rule Phase 40 uses today for tailnet URLs). On click, backend fetch happens synchronously and any failure is surfaced INSIDE the modal with a clean human-readable error: "Host unreachable," "File not found: `<path>`," "Permission denied on `<host>`." Same failure UX pattern as any web link — you don't know it's dead until you click. Rationale: preflight HEAD would fire one SSH round-trip per URL per rendered message; a chat with a few file mentions scrolled across 20 messages would burn 50-100 SSH channels just to render, which is untenable at scale.

### Parent-Skynet-domain config
- **D-03:** Single-line file at `~/.claude/skynet-parent`. Contents: the parent Skynet's HTTPS URL only, nothing else. Written by the fleet distributor during the same sweep that already pushes `settings.json`, hooks, and other per-box config. Agents read via `cat ~/.claude/skynet-parent` when constructing URLs. If the file is missing → agent surfaces "I can't share files right now, my parent-Skynet config is missing" to the user rather than silently guessing. Rationale: JSON is over-engineered for a single value (no other fields foreseen for this file); prose in CLAUDE.md is fragile (each agent extracts from prose differently); env vars need shell reload and hide "missing" as a silent empty string. Mirrors existing single-line-file patterns like `~/.claude/identities/<name>/relay-state/since`.

### Read access mechanic on the target host
- **D-04:** Read as whatever SSH user Skynet already uses for that host — no sudo escalation, no dedicated service account. Skynet already has a per-host SSH connection with a configured user (usually `ubuntu`, which is what agents also run as on fleet boxes, so agent-written files are readable by the SSH user in the default case). Failure surfaces as "permission denied" in the modal, and the operator fixes it host-side (unified user, shared group membership, or add sudo-cat later). Rationale: YAGNI on the escape hatches until they hurt; aligns with the shape's "any path an agent might write to" requirement without expanding the trust boundary or adding onboarding overhead.

### Claude's Discretion
- Exact regex for the new URL pattern → planner + phase-researcher pick, following the shape and mirroring the existing `TAILNET_URL_RE_CLIENT` from `editable-file-whitelist.ts` (client-side detection with `stripTrailingPunct` for markdown-link edge cases).
- Backend route path and Express router placement — reuse the existing SSH client machinery per the R&D findings; exact route (e.g. under `/api/host/file/...` or a top-level `/file/<host>/<path>` route) is a planner detail. The URL AGENTS write is the shape-locked `/file/<host>/<path>` — Caddy/routing at the edge maps that to whatever internal backend route serves it.
- Exactly which of Phase 40's affordance code paths (whitelist check, modal fetch call, `useEditableFileEligibility` hook) get extended vs. copied — planner scouts and decides; the intent is REUSE, not fork.
- Distributor mechanism specifics (which sweep step writes the file, how upgrades of the URL propagate, per-box vs. global config) — planner + phase-researcher decide following the existing distributor pattern this role now owns.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape + R&D
- `.planning/shapes/shape-skynet-passthrough-urls.md` — the two-phase shape agreed with Ashley 2026-09-05. Governs philosophy (agents-aren't-lied-to, Skynet-as-delivery-surface, no-writes-from-Skynet), scope edges, failure modes. Applies to both phase 75 (file) and the phase-2 serve URL work.
- `~/.claude/roles/box-maintainer/bounties/skynet-passthrough-urls-rd/findings-summary.md` — R&D findings. Confirms SSH machinery reuse; documents the file-URL Phase 40 stack; lists gotchas relevant to phase 2 (mostly serve-URL concerns, but WS-compression gotcha context is worth reading).

### Phase 40 infrastructure (REUSE — do not fork)
- `src/ui/features/pretty-view/editable-file-whitelist.ts` — client-side whitelist (`EDITABLE_EXTENSIONS`, `EDITABLE_BASENAMES`, `classifyByExtension`) + existing `TAILNET_URL_RE_CLIENT` regex + `stripTrailingPunct` helper. Phase 78 adds a SIBLING regex for the new URL scheme and reuses the whitelist verbatim.
- `src/backend/utils/editable-file-whitelist.ts` — byte-identical backend mirror of the whitelist (per Phase 40 D-02). Any new regex added client-side ALSO gets added here in lockstep.
- `src/ui/features/pretty-view/EditableFileModal.tsx` — the modal that fetches file bytes, allows edit, hits save-to-compose. Phase 78 repoints its fetch to also handle the new URL pattern (or wires a second fetch code path).
- `src/ui/features/pretty-view/EditableFileAffordance.tsx` (referenced from `ChatMessage.tsx:13`) — the pencil affordance component rendered inside ReactMarkdown's `<a>` override. Reused as-is.
- `src/ui/features/pretty-view/use-editable-file-eligibility.ts` — the hook that scans message text for eligible URLs and returns a Set for the ReactMarkdown override to gate on. Extended to include the new URL pattern in its scan.
- `src/ui/features/pretty-view/ChatMessage.tsx:72,91,328` — where the affordance gets wired into message rendering. Read the "Phase 40 D-03/D-06" comment at line 72.
- Phase 40 backend byte-sniff proxy — the server-side fallback for extensionless files. New file-fetch route should either extend this proxy or follow its pattern (planner decides).

### SSH machinery (REUSE)
- `src/backend/ssh/ssh-connection-pool.ts` — connection pool (3 conns/host, health-checked). New file-fetch route uses `withConnection(...)` or `getConnection(...)` from here.
- `src/backend/ssh/ssh-one-shot.ts` — minimal connect+exec helper for one-off queries. Reference for the fetch-a-file idiom.
- `src/backend/guacamole/routes.ts:295-395` — the canonical `sshClient.forwardOut` pattern in existing code (relevant more to phase 2 than phase 75, but worth being aware of).
- `src/backend/database/routes/identities.ts` — reference pattern for auth-gated backend routes with per-user permissions.

### Fleet substrate + distributor
- `.planning/shapes/shape-skynet-passthrough-urls.md` § "Vehicle notes" — phase 1 explicitly includes shipping the parent-Skynet-domain config mechanism.
- Distributor code (owned by this role per 2026-09-02 substrate ownership transfer) — the per-box sweep that pushes settings.json / hooks / recycled sentinel plumbing. New config-file push follows the same pattern. (Distributor file paths in the codebase — planner locates via grep during research.)

### Standing directives worth re-reading before planning
- `~/.claude/roles/box-maintainer/box-maintainer.md` § "Load-bearing invariants" — the Skynet in-memory-SQLite `DatabaseSaveTrigger.forceSave` rule matters if this phase touches any DB writes. Also the enable-flags trap (probably not relevant — file route doesn't touch host records).
- Same file § "Standing directives" — the container-mutations coord-room rule and full-suite-green ship gate apply at ship time.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 40 file-URL detection stack** — whitelist, regex helper, modal, affordance, eligibility hook, ChatMessage integration. Every one of these gets reused (not forked) by phase 75; the new URL scheme is a second regex + a second backend fetch code path plugged into the existing stack.
- **SSH connection pool** — `withConnection` / `getConnection` in `src/backend/ssh/ssh-connection-pool.ts`. Phase 78's backend file-fetch route uses this rather than opening its own SSH clients.
- **Per-user-per-host auth middleware** — exists across Skynet's backend routes. New file-fetch route mounts it the same way existing host-scoped routes do (planner locates the middleware).
- **Distributor per-box sweep** — the mechanism that already pushes settings.json + hooks + recycled sentinel plumbing to every fleet box. Extends to push `~/.claude/skynet-parent` too.

### Established Patterns
- **Frontend/backend whitelist mirror rule** (Phase 40 D-02): any pattern the frontend uses to classify eligible URLs has a byte-identical mirror in the backend `editable-file-whitelist.ts`. Applies to the new URL regex — add it in BOTH files.
- **In-memory SQLite `forceSave` rule** (`box-maintainer.md` load-bearing invariant): if the file route ever writes to the DB, wrap the write with `DatabaseSaveTrigger.forceSave("<reason>")`. Phase 78 is fetch-only so probably N/A, but worth knowing the rule.
- **Read as backend user, not user-elevated** (D-04) — matches how the existing SSH-based routes read files today (per-host SSH user, no sudo).
- **Coord-room + `git pull --rebase` before push** — standing multi-identity rule. Ship-time only.

### Integration Points
- `ChatMessage.tsx` line ~91 (`useEditableFileEligibility(eventId, content)`) — hook scans message text; extending its regex set adds the new URL pattern to the eligibility test.
- `ChatMessage.tsx` line ~328 — the ReactMarkdown `<a>` override where `<EditableFileAffordance>` gets rendered. No change needed if the eligibility hook returns the new URLs alongside the tailnet ones.
- `EditableFileModal.tsx` — fetch call. Either extended to detect the URL type and call the right backend endpoint, or the affordance passes a fetch-endpoint URL to the modal (planner picks the cleaner seam).
- Backend router — the new `/file/<host>/<path>` route mounts alongside existing host routes with per-user-per-host auth middleware.
- Distributor per-box sweep — new step that writes `~/.claude/skynet-parent` with the URL of the parent Skynet.
- id-skill — the file-half of "Sending files to the user" section gets rewritten to teach agents to construct `<skynet-domain>/file/<hostname>/<absolute-path>` URLs (and to `cat ~/.claude/skynet-parent` for the domain). This is a fleet-substrate change pushed via the distributor.

</code_context>

<specifics>
## Specific Ideas

- URL grammar reads like GitHub file URLs (`github.com/owner/repo/blob/main/src/foo.ts`) — same "literal path segments" feel Ashley reaches for naturally.
- The affordance renders EXACTLY like the tailnet-URL affordance already renders today — click → modal → view/edit → save-to-compose. No new visual affordance to design.
- Error surfaces in the modal read like human speech: "Host unreachable," "File not found: `<path>`," "Permission denied on `<host>`" — not stack traces or HTTP status codes.

</specifics>

<deferred>
## Deferred Ideas

- **Serve URL scheme** (`<skynet-domain>/serve/<hostname>/<port>/...` reverse proxy + wildcard TLS via Route 53 + WebSocket passthrough) — deliberate phase 2 of this shape. Separate GSD phase after phase 75 ships. Route 53 IAM provisioning is a phase-2 external dependency, not phase-1 concern.
- **Directory listings via file URL** — the shape explicitly ruled this out; agents cite multiple file URLs when sharing multiple files.
- **Skynet writing directly into host files** — the shape explicitly ruled this out; edits round-trip through the user's next message via the compose-box attachment flow.
- **Preflight HEAD on rendered URLs** to show upfront broken-file status — rejected in D-02 as too expensive; may revisit if user behavior indicates the click-then-see-error UX is confusing at scale.
- **`sudo cat` or a dedicated `skynet-fs-read` service account** on managed hosts for broader read reach — rejected in D-04 as YAGNI; may revisit if the plain SSH-user read boundary causes real friction on any specific box.

</deferred>

---

*Phase: 78-passthrough-urls-file-url-scheme-phase-1-of-2*
*Context gathered: 2026-09-06*
