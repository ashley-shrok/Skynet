# Phase 98: More versatile STT/TTS support — swap local rig for Amazon Polly + Amazon Transcribe — Context

**Gathered:** 2026-09-10
**Status:** Ready for planning
**Source:** Seeded from `/open` shape file at `.planning/shapes/shape-more-versatile-stt-tts-support.md`. Discussion, gray-area resolution, and provider validation completed inline with Alice 2026-09-09 → 2026-09-10 via `/build more-versatile-stt-tts-support`. AWS exploration ran end-to-end on real Skynet distribution (30 Polly synths across 5 voices × 2 engines × 3 real assistant messages; 5 Amazon Transcribe streaming runs on real voice clips from `/opt/skynet/stt-recordings/`). Alice greenlit provider + generative-engine tier after A/B against her local rig. Exploration spend: $1.14.

<domain>
## Phase Boundary

Move Skynet's voice-in (mic recording → transcript) and voice-out (assistant message → played audio) off the self-hosted model rig on Alice's personal PC over the tailnet (Chatterbox on `100.80.122.111:8000`/`:8001`) and onto external cloud providers. Alice is reclaiming that PC as a gaming machine; the local rig disappears as a model host and Skynet cannot depend on it anymore.

**Chosen providers, validated on real distribution:**
- **Amazon Polly (top-tier generative engine)** for voice-out. 7 en-US voices in the tier (Danielle, Joanna, Ruth, Salli, Matthew, Stephen, Tiffany). Per-call ceiling 6000 chars total / 3000 billed; longer text chunk-and-stitch on the backend.
- **Amazon Transcribe streaming** (HTTP/2 or WebSocket) for voice-in. No synchronous POST-audio-get-text endpoint exists at AWS; streaming is the only real-time option. Client-side contract stays "upload multipart blob to backend"; backend opens the stream and pushes the recording as a burst.

**Cross-instance:** ships uniformly to both Alice's Skynet on t1000 AND Stacy's Skynet on T800. Neither instance is "first" — per Alice 2026-09-09 verbatim: *"we just make sure to include what would need to be done at deploy time or just before it in the repo itself somewhere so that you can do those steps when it deploys over here and Stacy can follow those steps over on her side."* Each operator attaches the narrow Polly/Transcribe policy to their own instance's cloud-account role on their side; a repo-tracked deploy-time doc walks through those steps. On t1000 that policy is ALREADY attached (`termix-ssm-role/PollyTranscribeExploratory`, attached by Iris 2026-09-09) with the caveat that Iris asked for a ping when we ship for prod so she can re-scope the policy name from `-Exploratory` to a production name.

**Clean cutover, not dual-provider.** No provider-selection UI, no config-driven dispatch, no adapter abstraction for a hypothetical third provider. The old Chatterbox integration paths get deleted, not gated behind a config flag. Future flexibility explicitly deferred (Alice 2026-09-09 verbatim: *"maybe some future era will involve standardizing or giving more options in that sense but right now that's gonna work really great for me"*).

**Client contract is invariant.** All translation to AWS lives on the backend. The frontend cannot tell whether the endpoint behind it is the local rig or a cloud provider. Preserves the option to swap providers later without touching frontend code.

**Migration is a hard reset** for existing identity voice bindings. Every current identity's voice value (shaped like a filename with a codec suffix, matching regex `/^[A-Z][A-Za-z]+\.wav$/`) references a Chatterbox voice file that doesn't exist on Polly. All voice values wipe on ship day; identities re-pick from the Polly catalog next time an owner opens them. Alice 2026-09-09 verbatim on the migration: *"I think probably we just do a hard reset for all of mine like i don't really care that much about the picks for those that are already existing."*

</domain>

<decisions>
## Implementation Decisions

### Provider choice (locked)

- **Voice-out: Amazon Polly, `generative` engine only.** No neural-tier option, no user-facing engine toggle, no per-identity engine pick. Alice heard the A/B and picked generative flat: *"yeah, definitely generative, because it sounded way better."* Neural stays a Polly-side capability we don't use.
- **Voice-in: Amazon Transcribe streaming** (WebSocket or HTTP/2, backend chooses). No S3/batch path (adds S3 hop, non-real-time). Recording is pre-completed on the client; backend opens the stream and pushes the whole clip as a burst.
- **No fallback provider.** If AWS is unreachable, the feature fails visibly to the user (same class as today when Chatterbox is unreachable). No cascading to a secondary provider.

### Backend-owned orchestration (locked)

- **All provider translation lives on the backend.** Frontend keeps its current wire shape — multipart audio upload for voice-in, JSON text POST for voice-out. Backend translates to the AWS SDK / API on its side.
- **Uniform backend path**, not two branches for short-vs-long messages. Backend always owns orchestration. For voice-out, the chunk-and-stitch orchestrator naturally handles N=1 (typical assistant messages fit in one Polly call given the 3000-billed-char ceiling) and N>1 (rare long messages).
- **Chunk-and-stitch on backend for long voice-out.** Split on sentence boundaries; fire one Polly call per chunk; pipe audio streams back to the client in order. Client-side player is unchanged (queue chunks, seamless playback). Backend must stay AHEAD of playback (small pre-fetch buffer) to avoid audible pauses between chunks.
- **Streaming preserved.** Time-to-first-byte from Polly is a few hundred ms; matches or beats what listeners experience today. Client player behavior unchanged: decode-and-play as chunks land, cross-message single-speaker interrupt (existing module-level `currentPlayer` singleton), 1.25x sped-up playback rate.

### Voice catalog (locked)

- **Fixed hardcoded set on the frontend.** 7 en-US generative-engine voice IDs (Danielle, Joanna, Ruth, Salli, Matthew, Stephen, Tiffany), listed alphabetically or grouped by gender — planner picks.
- **No runtime fetch.** The `/voice/voices` endpoint that today proxies Chatterbox's `/get_predefined_voices` goes away — or gets rewritten to return the fixed set from a backend-side const. Frontend should not need to await catalog data on mount.
- **English-US only for this phase.** Polly supports many languages; multi-language is out of scope.

### Per-identity voice binding (locked)

- **Value semantics change.** Today: `<Name>.wav` matching `/^[A-Z][A-Za-z]+\.wav$/`. New: Polly voice ID string, matching a whitelist of the 7 supported values.
- **Validator regex updates** to accept ONLY the whitelist. Any prior `.wav` value fails validation post-migration.
- **Hard-reset migration.** Every existing identity's `voice` frontmatter value clears (set to null or removed entirely — planner picks) at ship time. Identity file on disk is source of truth; migration writes to disk once. Alice re-picks the ones she cares about via the identity modal's voice picker.
- **Migration timing / owner.** Run once at deploy time by the operator, not at Skynet startup on every restart. Backend-side one-shot script that walks `~/.claude/identities/*/*.md` on the box, clears each `voice:` frontmatter line, and exits. Planner decides whether this ships as a distributor-run task, a manual `docker exec` step in the deploy doc, or an idempotent bootstrap step that no-ops if all voices already conform.

### Provider access (locked)

- **Ambient instance identity, no static keys.** Backend reads AWS credentials from IMDS via the AWS SDK's default credential chain. No env vars, no key files stored in Skynet's data volume.
- **Operator attaches the policy on their instance's cloud role.** t1000 = done (Iris attached `PollyTranscribeExploratory` on `termix-ssm-role`). T800 = Stacy follows the in-repo deploy doc on her side.
- **Policy actions required:** `polly:SynthesizeSpeech`, `polly:DescribeVoices` (both `*` resource — API-level services with no resource-level scoping), `transcribe:StartStreamTranscription`, `transcribe:StartStreamTranscriptionWebSocket` (both `*`).
- **Off-switch is policy-absence.** Not attaching the policy → backend gets AccessDenied → feature dark. No app-side config flag, no admin toggle in Skynet. This IS the cost gate too — an operator who doesn't want to pay AWS just doesn't attach the policy.

### Slash-command transform preserved

- **The server-side "slash `<skill-name>`" transform in the STT path (currently at `src/backend/voice/slashCommandTransform.ts:181–276`) carries over unchanged.** It's a Skynet-specific quirk that runs on the transcript regardless of provider. New Transcribe adapter returns text → same transform runs on it → returned to client. No behavior change.

### Telegram bridge STT (locked 2026-09-10)

- **The Telegram bridge uses whatever STT Skynet's frontend is configured with — i.e., routes through Skynet's `/voice/transcribe` endpoint.** Alice 2026-09-10 verbatim: *"the telegram bridge is supposed to use whatever STT that Skynet is configured with for STT on the front end."* This keeps the bridge provider-agnostic — it doesn't know or care that AWS is behind it.
- **Concrete impact:** `substrate/services/tg-bridge/bridge.sh:225` (the `tg_voice_to_mx` STT path) stops POSTing to `$STT_URL` (Chatterbox direct) and instead POSTs its transcode-output to Skynet's `/voice/transcribe` endpoint. `bridge-config-writer.ts` stops writing `STT_URL` to `/state/config.env`; it starts writing whatever the bridge needs to reach Skynet (a Skynet base URL + service-account credential — planner picks the auth shape, likely a bridge-scoped API token issued at bridge-config write time OR a shared secret env-var the bridge and Skynet both know).
- **Provider transparency preserved.** The bridge cannot tell whether Skynet is running its own local STT or hitting AWS. Future provider swaps don't touch the bridge.

### Claude's-discretion decisions taken during research phase

Recorded here since these were flagged as "planner picks" in CONTEXT and locked by tabitha 2026-09-10 based on researcher's recommendation, without needing Alice bounce-back:

- **Migration trigger: startup one-shot idempotent** (runs when Skynet backend boots, walks identity+role frontmatter, clears any voice value matching the old regex, no-ops on already-clean state). Recommended by researcher over `docker exec` step — zero-touch for operators, retries automatically on next restart if it flakes.
- **`/voice/voices` endpoint: DROP entirely; inline the 7-voice const in `VoicePicker.tsx`.** The endpoint's only remaining purpose would be to return a hardcoded list; that's cheaper as a frontend const.
- **AWS region: hardcode `us-east-1`** in the adapter code (not env-var-driven). Generative Polly isn't in all regions; hardcoding removes an operator failure mode. Both instances' AWS accounts have `us-east-1` generative available. If a future region-switch becomes needed, one-line change.

Alice can override any of these at plan-review time by saying so.

### Kill list

Delete these files/config outright (clean cutover, no dual-provider seam):
- `src/backend/config/media-endpoints.ts` — the hardcoded Chatterbox URLs (`http://100.80.122.111:8000`, `:8001`). Replace with an AWS-side config module (or delete entirely if the AWS SDK doesn't need it).
- Chatterbox-specific proxy code in `src/backend/database/routes/voice.ts` — the `handleTranscribe`, `handleSpeak`, `handleSpeakStream`, `handleListVoices` handlers become AWS-backed. Keep the route registrations; rewrite the implementations.
- Any tg-bridge config writer that references `media-endpoints.ts` — audit and update.
- The runtime voice-catalog fetch client (`voice-api.ts` `getVoices()`) — reshape to return the hardcoded set OR remove and inline the const in `VoicePicker.tsx`.

### Deploy-time doc (in-repo, MANDATORY)

Ships as part of this phase. Location: TBD by planner (`docs/deploy/aws-voice-setup.md` or similar). Must cover, end-to-end without operator having to ping tabitha:
- Which AWS account (each instance uses its own — Alice's t1000 uses Aither's Aither account via `termix-ssm-role`; Stacy's T800 uses her own account).
- Which IAM role to attach the policy to (each instance's EC2 instance profile / equivalent).
- The exact policy JSON (4 actions listed above, resource `*`).
- How to verify the policy is live (`aws polly describe-voices --engine generative --language-code en-US` from the instance).
- What happens if the policy is absent (feature dark, no error cascade).
- Region (any; sample uses `us-east-1`).

### Verification bar

- Voice-in end-to-end: user records clip in compose box → transcript returns → matches or beats today's accuracy on Alice's real voice (validated during exploration).
- Voice-out end-to-end: assistant message plays back through the standard client audio pipeline. Time-to-first-byte within a few hundred ms. Chunk-and-stitch on a long message (>3000 billed chars) produces continuous audio with no perceptible pauses between chunks.
- Voice catalog: identity modal shows exactly the 7 en-US generative voices; picking any of them and reloading the identity persists the choice.
- Migration: every pre-existing identity has its voice value cleared post-migration; validator rejects any old-format value.
- Off-switch: with the policy detached, feature is dark (no crash, no console spam — clean AccessDenied handling).
- Cross-tree: Stacy on T800 follows the deploy doc unassisted and reports her instance works.

### Claude's discretion

- Exact backend module structure for the Polly and Transcribe adapters (single `polly-adapter.ts` + `transcribe-adapter.ts` under `src/backend/voice/`, or nested under `src/backend/aws/`, etc.).
- AWS SDK package choice (`@aws-sdk/client-polly` + `@aws-sdk/client-transcribe-streaming` are the obvious picks — v3 modular SDK).
- WebM → FLAC transcode owner (client-side before upload vs backend-side before pushing to Transcribe). Backend-side keeps client contract cleaner; needs an `ffmpeg` or equivalent dependency in the container.
- Chunk-and-stitch sentence-boundary detection algorithm (regex on `.!?` with common-abbreviation exceptions, or an existing tokenizer).
- Exact migration script shape + trigger point.
- Whether to keep or drop `/voice/voices` endpoint (drop-and-inline vs keep-and-return-hardcoded).
- Test structure — unit tests for the adapters, integration tests exercising real AWS with a small in-process budget (< $1 per test run), Playwright smoke against the live voice picker UI.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The shape file (SOURCE OF TRUTH)

- `.planning/shapes/shape-more-versatile-stt-tts-support.md` — locked shape from `/open`. Every decision here originates in that file; if the shape and this CONTEXT.md disagree, the shape wins.

### The exploration bounty (validation artifacts + tooling)

- `~/.claude/roles/box-maintainer/bounties/more-versatile-stt-tts-support/` — everything from the exploration.
  - `samples/messages/` — the 3 real assistant messages Alice signed off on
  - `samples/clips/` — 5 real voice clips (webm + flac + mp3 forms)
  - `samples/polly-outputs/` — 30 synthesized mp3s (5 voices × 2 engines × 3 messages) that Alice A/B'd
  - `samples/transcribe-outputs/` — 5 transcripts from Transcribe streaming
  - `samples/index.html` — browsable audio-player index Alice used to listen through the samples
  - `transcribe-flac.py` — reference implementation of Transcribe streaming from Python (chunked push, event handler pattern)
  - `.venv/` — Python `amazon-transcribe` SDK for reference

### Code being modified

**Voice-in path (client → backend → provider):**
- `src/ui/features/pretty-view/useVoiceRecording.ts:60–327` — MediaRecorder + `getUserMedia`, POST `/voice/transcribe`. **Client contract stays the same.** No client-side changes needed IF backend transcode is chosen (recommended).
- `src/backend/database/routes/voice.ts:67–202` (`handleTranscribe`) — the multipart proxy that today forwards to Chatterbox at `/v1/audio/transcriptions`. Rewrite to open a Transcribe streaming session (via `@aws-sdk/client-transcribe-streaming`) and push the recording as a burst. Preserve the fire-and-forget audio-to-disk at `/app/stt-recordings/` (per `STT_RECORDINGS_DIR`) — Alice uses that folder as her post-hoc reference.
- `src/backend/voice/slashCommandTransform.ts:181–276` — the server-side "slash `<skill-name>`" transform. Unchanged in behavior; runs on the transcript regardless of provider.
- `src/backend/ssh/skill-catalog.ts:115–219` — supports the slash transform (fetches per-host skill catalog via SSH). Unchanged.

**Voice-out path (client → backend → provider → streamed audio → client):**
- `src/ui/features/pretty-view/ChatMessage.tsx:143–213` — calls `postSpeakStream(text, identityVoice)` on speak-button click / autoplay. **Client contract stays the same.**
- `src/ui/features/pretty-view/webAudioStreamPlayer.ts:72–335` — WebAudio streaming decoder. **Client player stays the same.** Its inputs are audio chunks; whether they come from Chatterbox's chunked-WAV pipeline or Polly's audio stream doesn't matter to it (byte-shape check needed; Polly emits mp3/ogg/pcm — pick a format the player already handles or add decoder support).
- `src/backend/database/routes/voice.ts:204–278` (`handleSpeak`) — non-streaming JSON POST. Rewrite to a single Polly `SynthesizeSpeech` call.
- `src/backend/database/routes/voice.ts:280–383` (`handleSpeakStream`) — streaming; **primary consumer today**. Rewrite as the chunk-and-stitch orchestrator: split-on-sentence, fire Polly per chunk, pipe response bodies back to the client in order. Preserve `X-Accel-Buffering: no` (nginx anti-accumulation).
- `src/backend/database/routes/voice.ts:385–423` (`handleListVoices`) — proxies Chatterbox `/get_predefined_voices` today. Rewrite to return the fixed 7-voice hardcoded set (or drop the route entirely and inline in the frontend).

**Voice catalog + picker:**
- `src/ui/features/pretty-view/pickers/VoicePicker.tsx:7–123` — dropdown UI. Wire to the new fixed catalog (either via `getVoices()` returning the hardcoded set, or inline the const here directly).
- `src/ui/api/voice-api.ts:53–60` — `getVoices()` client. Reshape or delete.

**Voice-value validator + identity threading:**
- `src/backend/database/routes/identities.ts:51` — the regex `/^[A-Z][A-Za-z]+\.wav$/`. Update to a whitelist enum of the 7 Polly voice IDs.
- `src/ui/features/pretty-view/IdentityModal.tsx:200–220` — `voiceDraft` state + VoicePicker binding + `updateIdentity()` call. Should keep working; verify against new value shape.
- `src/backend/database/routes/identity-artifact-reader.ts` — reads `voice:` from identity frontmatter files on disk. Unchanged in shape; consumes whatever value the migration leaves.
- `src/backend/database/routes/identity-birth.ts:95` — identity birth flow's `voice` threading. Verify default (currently `Elena.wav`) is updated to a Polly voice or null.
- `src/backend/database/routes/identity-clone.ts` — identity clone flow. Same verification.

**Config + endpoints:**
- `src/backend/config/media-endpoints.ts:22–33` — DELETE or reshape. The hardcoded `100.80.122.111:8000/:8001` URLs go away.
- `substrate/services/tg-bridge/bridge.sh` config writer (per Phase 79 Plan 02) — audits any reference to `media-endpoints.ts` and updates.

### AWS SDK reference

- `@aws-sdk/client-polly` (v3, modular). `SynthesizeSpeech` command shape at `https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html`.
- `@aws-sdk/client-transcribe-streaming` (v3, modular). `StartStreamTranscription` at `https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html`.
- Amazon Transcribe accepts FLAC, Opus-in-Ogg, or raw PCM (16-bit LE, NOT WAV). Browser records WebM/Opus; backend transcodes (or uses `ffmpeg` in-container) to Opus-in-Ogg (natively accepted, no format shift) OR FLAC.
- Amazon Polly `SynthesizeSpeech` limit: 6000 total chars, 3000 billed. `TextLengthExceededException` on overshoot.

### Related bounty

- `~/.claude/roles/box-maintainer/bounties/more-versatile-stt-tts-support/bounty.json` — will be updated with plan progress. Currently holds exploration timeline + AWS cost math ($1.14 for exploration).

### Container / operational

- `docker/Dockerfile` — verify `ffmpeg` availability inside the container (needed if backend-side transcode is chosen). If absent, add.
- `~/.claude/roles/box-maintainer/box-map.md` § Operating — includes voice-endpoint context today. Update to reflect the AWS-side flow post-ship (part of the shape's "clean cutover" — old references removed).

</canonical_refs>

<specifics>
## Specific Ideas

- **Adapt existing Phase 92 / Phase 95 patterns.** Both were "swap a self-managed local mechanism for a cleaner abstraction with a distributor rollout"; Phase 98 has similar shape (swap a self-hosted rig for cloud, with an in-repo deploy doc). Reuse test structures where they fit.
- **Cost budget for build phase: ~$20-30 max.** Iris quoted "pocket change" for exploratory ($1-5); build phase testing chunk-and-stitch on long text + integration tests hitting real AWS could plausibly hit $20-30. Flag if it drifts higher; nothing structural stops runaway if tests loop.
- **Test discipline (fleet rule):** scoped tests during dev (`npx vitest run --related <changed-files>`); full-suite ONLY as the first step of ship motion after Alice's greenlight. See role file § Test discipline. AWS-touching tests should be tagged so they can be skipped in offline / no-cred environments.
- **Deploy is orchestrator-owned.** Phase's "done" state is: code + tests green + deploy-doc written + UAT checkpoint prepared. Push + build + `--force-recreate` = orchestrator, not executor.
- **Ping Iris pre-ship** to re-scope her `PollyTranscribeExploratory` policy name to a production name on `termix-ssm-role`. She asked explicitly. Coordination lives outside the phase — just note it in the ship checklist.
- **Real behavior over synthetic samples (from shape philosophy).** Any implementation uncertainty about how Polly or Transcribe behaves under a specific input should be answered by running that input against the real AWS service, not by reasoning about docs. Exploration bounty's `transcribe-flac.py` + the `aws polly synthesize-speech` CLI pattern are already set up for this.
- **Client player format compatibility check.** Polly emits mp3 / ogg_vorbis / ogg_opus / pcm / mulaw / alaw. `webAudioStreamPlayer.ts` currently decodes Chatterbox's PCM-in-WAV chunk stream. Either request pcm from Polly (matches player's decoder shape best) or add mp3/ogg decoding to the player. Planner picks; the CHOICE is HOW to keep the player unchanged in behavior — the constraint isn't the format specifically.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-language voices.** Polly supports 40+ language variants; English-US is the only shape this phase covers.
- **Provider-selection UI + adapter abstraction.** No config-driven provider dispatch. If a future era wants OpenAI TTS, ElevenLabs, Cartesia, or an in-house rig again, that's a follow-up phase (Alice: *"maybe some future era..."*).
- **Per-voice sample-preview affordance.** Letting the user hear a voice before picking it in the identity modal. Nice-to-have; not shipping in this phase.
- **In-app cost visibility surfaces.** No dashboards, no per-user quotas, no spend caps. The policy-attach IS the cost gate for this shape.
- **Bidirectional voice-conversational features** (Amazon Nova Sonic pattern — "live phone call with an agent"). Different shape entirely; separate feature request if it ever comes up.
- **Fall-back to a secondary provider on AWS outage.** Not shipped; feature fails visibly if AWS is unreachable (same failure UX class as today when Chatterbox is unreachable).
- **In-app engine toggle** (neural vs generative per-play or per-identity). Locked at generative-only for everyone.

</deferred>

---

*Phase: 97-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Context gathered: 2026-09-10 — seeded from `/open` shape file; exploration + provider A/B completed 2026-09-09 → 2026-09-10 with Alice in-conversation via `/build`*
