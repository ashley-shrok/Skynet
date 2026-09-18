# Phase 116: image-gen-skill — file-drop broker for OpenAI image generation, distributed to every managed host — Context

**Gathered:** 2026-09-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Give agents running inside Skynet's managed chat surface (Claude Code harness on end-user boxes) a native way to generate images from prompts, without exposing the OpenAI credential to those agents or to humans on the same box. Two coupled pieces shipped as one phase: (1) an on-demand-loaded skill distributed to every managed host via the fleet-substrate distributor, with a helper script that drops a request file into an agreed folder and polls for the response; (2) a backend scanner + queue + worker pool on the central Skynet instance that claims request files atomically, calls the OpenAI image API, and drops success or failure response files back.

The mechanism is a direct clone of the Phase 99 spawn-request pattern (identity-birth): same atomic `.tmp` → `mv` writes, same in-memory backend queue, same success/failure response file contract, same "requester cleans up its own response files, Skynet doesn't reap" convention. Adds two things Phase 99 didn't need: (a) provider-native passthrough parameters (prompt required, size/quality/n/reference-image/etc. optional), and (b) a token-bucket rate limiter on the outbound OpenAI calls so we self-throttle below OpenAI's per-tier limit.

Load-bearing security constraint: the OpenAI credential must never sit anywhere agents (or humans on the same box) can reach. It lives only in the Skynet backend's environment; the skill on the host carries no credential and needs no auth — the trust boundary is the filesystem (a request file appearing in the agreed folder is the whole authorization signal, because getting a file into that folder requires shell access to the box, and shell access to a box IS the trust perimeter).

Phase 116 is the first shape of a potential future family of file-drop broker capabilities (see Deferred Ideas). This phase does NOT abstract the pattern — it clones Phase 99's implementation. Factoring the shared broker mechanism into reusable infrastructure is future work when a second broker instance justifies it.

</domain>

<decisions>
## Implementation Decisions

### Signal-file broker pattern (inherited from Phase 99, applied to image-gen)
- **D-01:** Piggyback on the existing fleet-status per-host sweep (`src/backend/fleet-status/ssh-poll-orchestrator.ts`) — no new SSH plumbing. Adds one additional atomic read-and-delete exec per tick per host, scanning `~/fleet/image-gen-requests/` alongside the existing `~/fleet/spawn-requests/` scan. Same 2-second tick, same long-lived per-host channel, same batched-exec pattern (Phase 99 D-01, D-02).
- **D-02:** Single atomic read-and-delete exec per tick per host. In one remote exec, the sweep lists `~/fleet/image-gen-requests/`, reads each `*.json` file (plus any matching `<uuid>.ref.*` companion file bytes), deletes ONLY the request JSON (companion ref files are pulled but not deleted separately — request-delete is the claim moment; ref file becomes orphan bytes on the box's disk that the helper script cleans up on its own timeout/success path). Zero window between "observed" and "claimed" (matches Phase 99 D-02 verbatim).
- **D-03:** Missing folder is not an error. If `~/fleet/image-gen-requests/` doesn't exist on a host (fresh box, no agent has ever invoked the skill), the exec returns empty batched contents. No mkdir, no warn-log, no failure — the helper script is responsible for creating the folder on its first request drop (matches Phase 99 D-03).
- **D-04:** Response file lives in the SAME folder the request was written to (`~/fleet/image-gen-requests/`). Skill polls one folder for either success or failure file matching its uuid (matches Phase 99 D-11).
- **D-05:** Response file cleanup is the HELPER SCRIPT's job on the happy path (helper reads response files, moves images out to `~/fleet/image-gen-outputs/`, deletes the wire-protocol response files). Skynet does NOT auto-reap orphaned response files. If callers consistently fail to clean up, the folder accumulates cruft — deferred as a future problem worth its own bounty at that time (matches Phase 99 D-13 principle).

### Wire protocol — request shape
- **D-06:** Request file at `~/fleet/image-gen-requests/<uuid>.json`. Contents: `{prompt, size?, quality?, n?, ref?, ...provider-native optional params}`. Request-id is the filename (`<uuid>.json`), NOT the body — filename is the primary key (matches Phase 99 D-04). Helper script derives uuid via any standard UUID generator. All parameters other than `prompt` are optional passthroughs to OpenAI's `gpt-image-1` API; the backend adapter forwards recognized OpenAI params and REJECTS the request with `reason: malformed` + descriptive message when the request includes an unrecognized param (fail-explicit, don't silently drop caller-specified params — matches shape file's "would-make-it-wrong" clause).
- **D-07:** Reference image transport (for image-to-image / editing use case): **companion file next to the request**, NOT base64 in the JSON. Caller writes `<uuid>.ref.<ext>` (`.png` / `.jpg` / `.webp`) alongside `<uuid>.json`, and the request JSON's `ref` field names the companion filename (relative, e.g. `"ref": "<uuid>.ref.png"`). Backend reads the companion file over the same SSH channel it's already using to read the request. Symmetric with the response side (which is also JSON + companion files). No base64 encode/decode step, no 40% JSON-payload bloat.

### Wire protocol — response shape
- **D-08:** Success response file at `~/fleet/image-gen-requests/<uuid>.success.json`. Contents: `{images: [<filename>...], size, model, seed?, n, generation_time_ms}`. `images` is an array of companion PNG filenames (one per generated image when caller set `n>1`). Companion PNG files land at `~/fleet/image-gen-requests/<uuid>.success.0.png`, `.success.1.png`, ..., `.success.<n-1>.png`. One request → one response event even when `n>1` (matches OpenAI's own atomic `n`-response semantic).
- **D-09:** Failure response file at `~/fleet/image-gen-requests/<uuid>.failure.json`. Contents: `{reason, message?}`. `reason` enum locked to a small closed set (see D-27 for the concrete list). `message` is PRESENT and descriptive when `reason == "malformed"` (caller may iterate on the request body); ABSENT or short-terse for every other reason (matches Phase 99 D-10).
- **D-10:** Both request and response files use atomic `.tmp` → `mv` writes (matches Phase 99's convention; standard fleet-broker rule).
- **D-11:** Response file writes happen over the SFTP channel of the fleet-status per-host connection (or same-channel exec write; planner picks whichever is cheaper). Small files (success JSON < 500 bytes, PNGs ~1-5MB each); not on the critical path of the sweep tick (matches Phase 99 D-12).

### Skill-side helper script (invocation shape)
- **D-12:** Skill ships with a helper script (via the fleet-substrate distributor to `~/.local/bin/image-gen`, following the existing substrate-scripts convention). Skill body invokes the helper with a concise call site. Rationale: the file-drop-then-poll dance is ~30 lines of shell to do robustly (atomic write, poll loop with timeout, error-file-vs-success-file branching, cleanup); burying that in a skill-body recipe means every invocation regenerates the same shell. Helper keeps the call site one line; skill body focuses on caller-facing concerns (what you can ask for, response shape, PHI directive).
- **D-13:** Helper argument shape: **positional prompt + flags for common params + `--json <file>` escape hatch for full-payload calls.** Concrete example: `image-gen "a cat" --size 1024x1024 --n 2 --quality high --out /tmp/cat.png`. For the reference-image case (image-to-image), callers use `image-gen --json /path/to/full-request.json --ref /path/to/ref.png` (helper handles the companion-file placement + JSON-field wiring). 90% of calls are `image-gen "prompt"` or `image-gen "prompt" --size portrait --n 3`; flag syntax is shortest for those.
- **D-14:** Helper output on success: **paths on stdout (one per line), full success JSON copied to stderr for debugging.** Agents mostly just want the paths — grabbing them cleanly is `image-gen "..." | head -1`. If something goes weird, the metadata is in stderr and lands in the transcript. Machine-parseable success (exit 0 + N lines on stdout) and human-readable failure (non-zero exit + failure JSON on stderr).
- **D-15:** Helper output default location: `~/fleet/image-gen-outputs/<uuid>-<n>.png` (overridable via `--out <path>`). Helper moves images out of the wire folder (`~/fleet/image-gen-requests/`) to the output location AS PART OF the read-response step, then deletes the wire-protocol files (request tmp/final, response JSON, response PNGs). Wire folder stays tidy per-call; user-facing files live at a predictable path the agent can rename/move/delete freely. Default is under `~/fleet/` per the fleet rule (`/tmp` is forbidden for anything worth surviving a reboot — 2026-07-15 rule).
- **D-16:** Helper polling timeout: **5 minutes** from request drop. gpt-image-1 typical latency is 5-30s per call; worst case (say `n=3` at `quality=high` behind 2 other requests in the queue) is ~90s. 5 minutes gives comfortable headroom and still surfaces a broken Skynet quickly. On timeout, helper exits non-zero with a synthetic failure JSON of `reason: expired` on stderr (matches the backend's own TTL fire path in D-22 — same reason enum for both).

### PHI / compliance directive in skill body
- **D-17:** Directive wording (locked, minimal 3-sentence version, uses `MUST NOT` phrasing + reason per Anthropic skill-authoring guidance and research on instruction adherence):
  ```
  ### ⚠️ Your prompt leaves this deployment

  Prompts are sent to a third-party image provider and leave this deployment's boundary. You MUST NOT include PHI, patient identifiers, or content your deployment's compliance boundary forbids sending to a third-party API. Paraphrase specifics; if unsure, don't send it.
  ```
- **D-18:** Directive placement: **top of SKILL.md body** (immediately after `# Title` + one-line "what this is"), AND a one-line echo at the invocation section: *"Before invoking: confirm the prompt contains no PHI or compliance-restricted content. See the directive at the top of this file."* Rationale: research (Liu et al. 2024 "Lost in the Middle" + Guo et al. 2024 serial-position effects + 2025 hierarchical-safety-adherence benchmark) shows middle-of-file is measurably the WEAKEST position for constraint adherence; both top (primacy) and near-invocation (recency) beat middle; recency edges primacy but redundancy at both ends is best. Anthropic's skill-authoring docs specifically recommend `MUST` phrasing over `do not` and require the directive to live in `SKILL.md` itself (referenced files may only get `head -100` read).
- **D-19:** `content_blocked` failure guidance in the skill body's failure-handling section (one-liner): *"If you get `content_blocked`, the provider refused the prompt. Rephrase and retry, or tell the user the request isn't something the provider will generate."* Enough for the agent to know what action is called for without turning the skill body into a rewrite of OpenAI's content-policy docs.

### Backend concurrency + rate limiting
- **D-20:** Worker pool concurrency: **N=5**. Five in-flight OpenAI calls at a time. Rationale: handles typical fleet bursts (a couple of agents on different boxes each doing a small batch) without approaching provider rate limits at any tier past new-account, keeps backend memory footprint bounded (~50MB worst case for in-flight image buffers at n=1 per call).
- **D-21:** Rate limiting: **token bucket, env-configurable via `SKYNET_IMAGE_GEN_RPM` (default 30 requests/minute)**. Workers acquire a token before calling OpenAI; block on empty bucket. Combined with the in-memory queue (from D-06 pattern), incoming spikes drain at the throttled rate instead of getting rejected by OpenAI. 30 RPM = 1 every ~2 seconds sustained, well under Tier 2's 50 IPM (so it "just works" for any tier past new-account without config); operators on higher tiers bump via env. Bucket capacity = burst allowance; planner picks concrete capacity (recommendation: capacity = RPM × 5 seconds so a brief burst of ~2.5 requests can fire immediately, then the sustained rate takes over — matches standard token-bucket sizing).
- **D-22:** Queue TTL: **5 minutes from `requested_at`**, matching the caller's poll window (D-16). On dequeue, worker checks `now < requested_at + 5min`; if not, worker skips the OpenAI call and drops a `<uuid>.failure.json` with `reason: expired`. No wasted API call, no wasted $$, and the response folder ends up in a consistent state. Matches the caller's own timeout assumption — if the caller has given up, nothing should still be running for them.
- **D-23:** On OpenAI 429 (rate limit slipped through our own self-throttle): **fail immediately** with `reason: rate_limited` in the failure file. No backoff-and-retry inside the worker. Matches Phase 99 D-15 "no automatic retry anywhere." A 429 that gets through our self-throttle is a signal that our throttle is misconfigured (operator's OpenAI tier is lower than assumed); fast-fail surfaces this rather than papering over it. Should ~never fire in practice at the default 30 RPM.
- **D-24:** On OpenAI 5xx / network error / provider timeout: **fail immediately** with `reason: provider_unavailable`. Same no-retry principle. Caller decides whether to retry after a brief delay.

### Provider integration
- **D-25:** OpenAI credential source: **reuse `process.env.OPENAI_API_KEY`** (same env var the existing `identity-avatar-batch.ts` route reads at request time). No new credential config surface; new adapter reads from the same env var. Missing key on the backend returns `reason: not_configured` in the failure file (matches existing avatar route's 503-on-missing-key pattern; adapts to the file-drop failure surface).
- **D-26:** OpenAI model: **`gpt-image-1`** (locked for v1 — same model the avatar route uses; matches Phase 116 shape "the same provider already used for avatar generation"). Model choice is NOT exposed to the caller as a request param in v1 (deferred; if a second model gets added later, opt-in via a new optional request field).

### Failure taxonomy — final locked enum
- **D-27:** Failure `reason` enum values (closed set of 7, matches Phase 99 D-10 pattern of "small closed enum + optional message"):
  - `content_blocked` — OpenAI refused the prompt via their content policy. Message optional. Caller action: rephrase or escalate to user.
  - `rate_limited` — OpenAI 429 slipped through our own self-throttle. Message optional. Caller action: signal misconfiguration to operator (should ~never fire).
  - `provider_unavailable` — OpenAI 5xx / network error / provider timeout. Message optional. Caller action: retry.
  - `not_configured` — Backend has no `OPENAI_API_KEY` set. Message optional. Caller action: escalate to operator.
  - `malformed` — Request JSON couldn't be parsed, missing required fields, or contained unrecognized params. **Message PRESENT and descriptive** (matches Phase 99 D-10 for `malformed`). Caller action: fix and retry (may iterate on the message).
  - `expired` — Sat in the backend queue past 5 minutes from `requested_at` (D-22) OR skill's own poll timeout fired (D-16). Message optional. Caller action: retry (fleet may be overloaded).
  - `unknown` — Catch-all for anything the worker didn't classify. Message optional. Caller action: escalate to operator.

### Ship coordination
- **D-28:** All changes in this phase ship as one atomic ship motion. Executor's remit stops at code + commit + tests green (per fleet rule 2026-08-08). Push, docker build, and docker compose up are orchestrator-owned and gated on the user's explicit ship greenlight (per fleet rule 2026-07-27 + 2026-08-29 strengthening — deploy-window boundary sits at `git push`). The fleet-substrate distributor sweep is what actually gets the skill + helper script onto every managed host after ship; that happens on the distributor's own schedule (typically within minutes of the container restart).

### Claude's Discretion (implementation-level, planner decides)
- **Number of plans + wave breakdown.** The phase has ~5 distinct work surfaces (backend scanner extension in fleet-status; backend queue + worker pool + token bucket subsystem; OpenAI adapter; helper script + skill body distribution + catalog entry; test surface). Planner may split into 4-5 plans in 2-3 waves based on file overlap and test coupling. A 4-plan / 2-wave layout is likely reasonable: Wave 1 = queue+worker+adapter (independent modules) parallel with helper+skill (independent files); Wave 2 = fleet-status scanner extension (depends on Wave 1 queue).
- **Exact bucket capacity for the token bucket (D-21).** Recommendation: capacity = RPM × 5 seconds. Planner picks concrete value during implementation.
- **Whether to log-instrument the queue at enqueue / dequeue / worker-start / OpenAI-call-start / OpenAI-call-done / response-drop.** Standing directive: "Logging is cheap and batched; log at every meaningful state transition." Planner instruments per that directive.
- **The exact shell of the atomic read-and-delete exec (D-02).** Matches Phase 99's discretion; planner picks the shell-portable form (find + xargs, inline script, or similar).
- **Backend module layout.** Conceptually `src/backend/image-gen-requests/{queue,worker,adapter,scan-orchestrator,parse-request-body,types}.ts` mirroring `src/backend/spawn-requests/` structure. Planner may split differently.
- **Test surface.** Unit tests for request-body parser (schema validation, malformed handling), queue (enqueue/dequeue/TTL), worker (adapter mocking, response-file drops), token bucket (rate enforcement). Integration test for the fleet-status sweep's atomic read-and-delete exec (mocked SSH). End-to-end wire test similar to Phase 99 D-22: helper drops request, backend scans, worker calls mocked OpenAI, response file drops back at correct path with correct schema.
- **Helper script's exact retry-poll cadence.** Recommendation: poll every 500ms for the first 30 seconds, back off to every 2 seconds after that (matches typical file-watch poll patterns; balances responsiveness for fast responses against wasted work for slow ones).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/shapes/shape-image-gen-skill.md` — user's locked shape from the /open pass 2026-09-17. All D-01..D-28 above derive from it plus this discuss-phase session's decisions on wire-protocol specifics, worker concurrency + rate limiting, and PHI directive wording + placement.

### Prior-phase context that establishes the pattern this phase clones
- `.planning/phases/99-spawn-request-watcher-skynet-side-noticing-of-coord-dropped-/99-CONTEXT.md` — the identity-birth spawn-request pattern. Phase 116 IS a clone of Phase 99's mechanism (D-01..D-05, D-10 all reference Phase 99 decisions directly). Read this before planning to internalize the pattern.
- `.planning/phases/96-on-disk-tree-consolidation-consolidate-identity-metadata-and/96-CONTEXT.md` — establishes the `~/fleet/` tree layout that `~/fleet/image-gen-requests/` and `~/fleet/image-gen-outputs/` live under.

### External code dependencies (READ before implementing — no changes here)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — the per-host sweep. This phase extends it (D-01). READ before touching to understand the per-host tick loop, long-lived SSH channel management, and batched exec pattern.
- `src/backend/spawn-requests/` — the Phase 99 implementation of the identity-birth spawn-request pattern. This phase's backend module structure mirrors this directory (queue, worker, scan-orchestrator, parse-request-body, types). READ before planning the image-gen backend module layout.
- `src/backend/database/routes/identity-avatar-batch.ts` — the existing gpt-image-1 call site (avatar batch generation). READ for: (a) how the OpenAI SDK is invoked with `process.env.OPENAI_API_KEY`, (b) how gpt-image-1's response shape is parsed, (c) how missing-key returns 503. This phase's new adapter extracts the CORE image-gen call from this file (dropping the avatar-specific gamma correction, aesthetic director, LLM-prompt-drafting, and multer/multipart machinery — none of that applies to the generic skill).

### Existing patterns this phase inherits
- `src/backend/branding/branding-config-loader.ts` — how per-instance operator-facing config is loaded (referenced by the existing avatar route for gamma + director spec). The image-gen rate throttle (`SKYNET_IMAGE_GEN_RPM`) does NOT live in branding.json; it lives in env alongside `OPENAI_API_KEY` (provider-integration config vs operator-facing aesthetic config — different concerns, different config surfaces).

### Distribution
- `substrate/skills/` — where the new `substrate/skills/image-gen/SKILL.md` lands
- `substrate/scripts/` — where the new `substrate/scripts/image-gen` helper script lands (installed to `~/.local/bin/image-gen` on managed hosts)
- `src/backend/distributor/catalog.ts` — canonical catalog file for the fleet-substrate distributor. New entries for the skill + helper script land here. READ before adding entries to understand the row schema (name, source path, destination path, permissions).

### Anthropic guidance the PHI directive draws on
- `platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices` — general prompt engineering guidance
- `platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices` — skill authoring best practices (`MUST` phrasing, prominence, reason-giving, `head -100` read caveat for referenced files)

### Research the D-18 placement decision cites
- Liu et al. 2024 "Lost in the Middle: How Language Models Use Long Contexts" (TACL) — the seminal middle-position weakness paper
- Guo et al. 2024 "Serial Position Effects of Large Language Models" — confirms primacy + recency effects
- 2025 hierarchical-safety-adherence benchmark (arXiv 2506.02357) — even prominent top-of-prompt safety rules can be violated under task pressure; redundancy at both ends mitigates

### Files this phase creates
- `substrate/skills/image-gen/SKILL.md` — the skill body
- `substrate/scripts/image-gen` — the helper script
- `src/backend/image-gen-requests/{queue,worker,adapter,scan-orchestrator,parse-request-body,types,token-bucket}.ts` — backend broker (planner picks final layout)
- Corresponding `.test.ts` files
- One additional entry per row in `src/backend/distributor/catalog.ts` for the skill folder and the helper script

### Files this phase modifies
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — extend per-host tick with the atomic read-and-delete exec for `~/fleet/image-gen-requests/` and the enqueue call to the image-gen queue
- `src/backend/distributor/catalog.ts` — add rows for the new skill + helper script

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Fleet-status per-host sweep (`ssh-poll-orchestrator.ts`)** — already reaches every managed host on a 2-second tick with one long-lived SSH channel each. This phase's observation-and-claim step is one additional exec inside the existing per-host loop. Zero new SSH plumbing.
- **Spawn-request backend subsystem (`src/backend/spawn-requests/`)** — canonical implementation of the file-drop broker pattern (queue, worker, scan-orchestrator, parse-request-body, types). This phase's backend module structure mirrors it directly; planner can clone-and-modify rather than design from scratch.
- **Existing OpenAI `gpt-image-1` integration (`identity-avatar-batch.ts`)** — working call site with `OpenAI` SDK, `process.env.OPENAI_API_KEY` at request time, response parsing. Extract the core image-gen call (drop the avatar-specific gamma, aesthetic director, LLM-prompt-drafting, and multer/multipart bits — none applies to the generic skill).
- **Fleet-substrate distributor (`src/backend/distributor/`)** — already pushes skills + scripts to every managed host on its own schedule. Adding an entry to the catalog is the whole delivery mechanism for the new skill + helper script.
- **SSH exec helpers** — the per-host channel already exposes remote-exec + SFTP-write primitives, used throughout the sweep. Reading request-bodies and writing response files reuses these directly.

### Established Patterns
- **In-memory backend queue that dies on restart** — matches Phase 99 (spawn-requests), matches Skynet's live-subsystem convention. Restart clears in-flight; upstream callers (fleet-status sweep, skill helper) tolerate the loss cleanly (skill sees `expired` after 5min; sweep re-observes any un-claimed request files on the next tick).
- **Atomic read-and-delete exec at claim time** — Phase 99 D-02, applied wholesale to image-gen (D-02 here). Single exec, no window between "observed" and "claimed."
- **Request/response file pair keyed on shared uuid** — Phase 99 D-04, D-09, D-10. Filename is the primary key; body carries data.
- **Coord/caller cleans up its own response files** — Phase 99 D-13, applied here (D-05). Skynet doesn't auto-reap.
- **Fleet-substrate distribution to `~/.local/bin/` for scripts + `~/.claude/skills/<name>/SKILL.md` for skills** — existing convention (see substrate/scripts/agent-supervisor.sh, id-skill SKILL.md, etc.).
- **`process.env.OPENAI_API_KEY` read at request time, not boot** — existing pattern in identity-avatar-batch.ts. Missing key returns a clean error surface rather than crashing on boot. This phase mirrors that (missing key → `reason: not_configured` in the failure file).

### Integration Points
- **Fleet-status sweep** — one additional exec per tick per host (D-01). Same channel, same auth, same error surface.
- **Backend queue + worker pool** — new subsystem; naturally isolated from existing Skynet subsystems. Publishes response files via existing per-host SFTP/exec channels.
- **Fleet-substrate distributor** — new catalog rows; skill + helper land on every host on the next sweep after ship. No coordination needed beyond the catalog entry.
- **OpenAI adapter** — new module wrapping the OpenAI SDK's images API. Existing avatar route continues to use its own inline call (deliberately not refactored to share the new adapter — the avatar route has avatar-specific pre/post-processing that would obscure the generic adapter's shape).

### Test Considerations
- Fleet-status sweep tests already exist (`ssh-poll-orchestrator.test.ts`); this phase adds tests for the image-gen-scan behavior with mocked SSH exec responses.
- Spawn-requests tests already exist (`src/backend/spawn-requests/*.test.ts`); mirror those for the image-gen-requests subsystem (queue, worker, parse-request-body).
- New tests: token bucket (rate enforcement, burst behavior, TTL correctness), OpenAI adapter (mocked SDK), helper script (shell-level tests via a mocked backend or integration test with the real backend).
- End-to-end wire test similar to Phase 99 D-22: skill helper drops request, backend scans, worker calls mocked OpenAI, response file drops back at correct path with correct schema. Validates the wire only; OpenAI mechanics are covered by the adapter unit tests.

### Anti-patterns to avoid
- **Do NOT introduce a persistent queue backing** (matches Phase 99 D-06). Complexity cost buys nothing the caller-timeout-plus-`expired` path doesn't already cover.
- **Do NOT retry failed calls inside the worker** (matches Phase 99 D-15, applied to D-23 + D-24 here). All retries are caller decisions.
- **Do NOT modify the existing `identity-avatar-batch.ts` avatar route to share this phase's new adapter.** The avatar route has avatar-specific pre/post-processing (gamma, director spec, multer) that would obscure the generic adapter's shape. Two call sites is fine for now.
- **Do NOT expose model choice as a request param in v1** (D-26). Locked to `gpt-image-1`; expose only if/when a second model is added.
- **Do NOT silently drop caller-specified params the backend doesn't recognize** (D-06). Reject the request with `reason: malformed` + descriptive message.
- **Do NOT introduce message streaming** (fleet-wide standing directive: "Skynet has NO message streaming — ever, anywhere"). Response files are atomic writes; no partial-file streaming affordances.
- **Do NOT hand-patch fleet-substrate-managed content on any host** (fleet-wide standing directive). All changes here go through the substrate distributor via the catalog.
- **Do NOT push, docker build, or docker compose up as part of executor's remit** (fleet rule 2026-07-27 + 2026-08-29). Executor's remit stops at code + commit + tests green. Orchestrator owns the ship motion on the user's greenlight.
- **Do NOT put the throttle-rate config in branding.json** (D-21). Provider-integration config (rate, credential) lives in env; operator-facing aesthetic config (gamma, director spec) lives in branding.json. Different concerns, different surfaces.

</code_context>

<specifics>
## Specific Ideas

- **Signal-file broker pattern reuse** — user 2026-09-17, midway through /open discussion, pointed at the identity-birth spawn-request pattern in coordinator-instructions.md as the model to copy. Verbatim: *"we copy the pattern that happens with birthing identities then which you can check out the coordinator instructions for because that's usually how communication from hosts to skynet actually works where they just essentially send up a signal layer saying they want something done."*
- **PHI directive over Bedrock provider path** — user 2026-09-17, after Bedrock research findings came in showing weak image-gen options and quality gap vs gpt-image-1. Verbatim: *"the amazon picture doesn't sound like it's great so that makes me want other options ... rather than trying to find a provider that we can send phi to i'm thinking we just say in the skill like never submit any phi when you try to generate an image and i would trust that enough especially given that the skill is an on demand loaded thing."* Pragmatic call — freshly-loaded skill directive replaces a whole provider-swap engineering path in v1.
- **Provider-native passthrough philosophy** — user 2026-09-17, on the caller-facing param surface. Verbatim: *"if the provider supports something like image to image or you know different aspect ratios or whatever else then it would be nice to try to support that because it just gives people more options."* Skill exposes everything gpt-image-1 supports; backend adapter forwards; unrecognized params fail-explicit rather than silently drop.
- **Companion-file symmetry** — user 2026-09-18, on wire-protocol simplicity. Response files already use JSON + companion PNG; making the ref-image input use the same pattern (JSON + companion PNG) keeps the whole protocol symmetric and avoids base64 bloat.
- **Backend self-throttle instead of provider-limit reactive handling** — user 2026-09-18. Verbatim: *"can we have like something in place on the back end that deliberately rate limits lower than whatever we think open a i does so that we never actually hit that from them and maybe there could be like a queue or something."* Token bucket + queue = the shape. RPM env-configurable so operators on higher OpenAI tiers can bump.
- **Output directory under `~/fleet/`** — user 2026-09-18. Verbatim: *"as long as we are parallelizing the image generation itself then i'm okay with five minutes ... let's make sure that the out put directory is in the fleet folder still if you think that's a good idea."* Keeps all fleet-related scratch under one root; consistent with Phase 96's on-disk tree layout.
- **`MUST NOT` phrasing + top-plus-echo placement for PHI directive** — user 2026-09-18, after asking for research on instruction-adherence ordering. Verbatim on wanting research first: *"i would say you should look up what the research says about ordering of instructions and how the models follow it and that can dictate this call."* Findings: Lost-in-the-Middle + serial-position effects + 2025 hierarchical-safety-adherence benchmark + Anthropic's own skill-authoring guidance all point to top + inline echo with `MUST` phrasing.

</specifics>

<deferred>
## Deferred Ideas

- **Second provider path (Bedrock) for BAA-restricted deployments.** Bedrock research completed during /open (Titan Image Generator v2 in us-east-1/us-west-2 is BAA-clean; Stable Image Ultra in us-west-2 is closer-to-frontier; Nova Canvas EOL 2026-09-30 excluded; none matches gpt-image-1 quality). v1 uses the PHI directive instead; if a deployment ever needs the routing separation, add a per-instance provider config that swaps the adapter (adapter interface is designed to support this — see D-25).
- **Per-caller attribution / metering / rate limiting.** Explicitly out for v1 per the shape. Cost lands on the operator's account with no per-user breakdown. If enterprise deployments ever need per-user quotas or audit trails, add a caller-id field to the request schema and metering in the queue.
- **Post-processing on the skill side** (gamma correction, style application, watermarking). Explicitly out — this is generic image gen only. Avatar pipeline stays separate.
- **Avatar-flow bleed-in.** Explicitly out — the avatar pipeline is a separate operator-facing tool with its own aesthetic and post-processing. Do NOT add avatar-generation as a preset in this skill.
- **Model choice exposed to caller.** Locked to `gpt-image-1` in v1 (D-26). If a second model gets added later, opt-in via a new optional request field.
- **Multiple simultaneous providers per host.** One provider per Skynet instance in v1. If per-instance provider selection ever matters, add config.
- **Long-running generation with a job-handle async pattern.** Sync polling with a generous safety timeout is v1. If we ever add a truly long-running model (video gen, batch jobs), reconsider.
- **Cross-provider abstraction of parameters.** v1 passes params through natively to gpt-image-1 and documents what exists. A canonical `size` / `aspect_ratio` / `quality` abstraction layer would be needed to swap providers cleanly; deferred until there's an actual second provider.
- **Admin surface on the backend to reconfigure the provider on-the-fly.** Config stays backend-owned and env-driven in v1. Adding an admin UI surface is future work if operators start swapping providers frequently.
- **Response-file aging / auto-reaper on Skynet side.** If callers consistently forget to delete their response files (helper handles it on happy path per D-15), the image-gen-requests folder accumulates cruft. Same tradeoff Phase 99 D-13 made; not addressed here — happy-path helper cleanup is the contract for now.
- **Broker-pattern factoring into shared infrastructure.** Phase 116 is a clone of Phase 99, not an abstraction. If a third broker use case emerges, refactor the queue/worker/scanner shape into a reusable module then. Two instances is not enough to justify the abstraction.
- **Bounded token bucket burst-capacity tuning.** Default `capacity = RPM × 5s` is a starting point (D-21). If real-world usage shows the burst allowance is too tight or too loose, tune based on measured request-arrival patterns.
- **Per-host quota inside the fleet.** All 5 workers can be consumed by one host's requests in the current design. If a chatty host starves others, add per-host round-robin dequeue.

</deferred>

---

*Phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation*
*Context gathered: 2026-09-18*
