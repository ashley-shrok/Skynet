# Shape: more-versatile-stt-tts-support

**Opened:** 2026-09-10
**Vehicle:** GSD phase

## What this is

Skynet's voice-in (mic recording turned into text) and voice-out (assistant messages read aloud) currently terminate at a self-hosted model rig on Alice's personal PC over the tailnet. That machine is going away as a model host — she's reclaiming it. This shape moves both sides of voice onto external cloud providers so nothing depends on the personal PC anymore.

Chosen providers, based on hands-on quality validation against real Skynet distribution: **Amazon Polly** for voice-out (top-tier generative engine, Alice confirmed the quality matches or beats her local rig) and **Amazon Transcribe** streaming for voice-in.

## Shape

Two lanes, one philosophy — the client speaks the same shape it already speaks; the backend owns the whole translation to the new provider.

**Voice-in lane.** User records a clip in the compose box (unchanged UI). Recording lands at the backend as a blob upload — same client contract as today. Backend opens a streaming session with the external transcription service, pushes the recording as a burst, receives the transcript, returns it to the client. The client cannot tell whether the endpoint behind it is the local rig or a cloud provider.

**Voice-out lane.** Assistant message text goes from client to backend. Backend fires a synthesis call at the external voice provider — one call for typical messages, chunk-and-stitch on the backend side for messages that exceed the provider's per-call length ceiling — and streams the resulting audio back to the client as it arrives. Client audio player unchanged: decode-and-play as chunks land, cross-message single-speaker interrupt, sped-up playback rate all preserved.

**Voice catalog.** Concept shifts from "ask the local rig what voices it has installed" to "the provider publishes a fixed known set." That set is small (seven English-US voices in the chosen tier) — fits directly as a known list in the app, no runtime fetch needed.

**Per-identity voice binding.** Each identity carries the name of the voice it speaks in. Migration is a hard reset: every existing identity's voice value clears the day this ships, because none of the current voice names exist on the new provider. Identities re-pick from the new catalog next time an owner opens them.

**Provider access, per instance.** Each Skynet instance uses the ambient cloud-account identity attached to its host machine — no static keys stored in the app, no per-user credential handoff. Each operator attaches the narrow voice-service policy to their host's role on their side; a repo-tracked deploy-time doc walks through those steps. Policy present → feature works. Policy absent → feature dark for that instance.

## Philosophy

- **The client contract is invariant.** Whatever shape the client speaks today for voice-in and voice-out stays exactly as it is. All translation to the new provider is a backend concern. This preserves the option to swap providers later without touching frontend code.
- **One provider, one tier, no ceremony.** Voice-out is always top-tier generative because Alice heard the quality difference and picked it flat. No user-facing engine toggle, no per-identity engine pick, no fallback tier. The mental model is: pick your voice, that's it.
- **One route through the backend, not two.** Backend always owns orchestration, even for short messages that would technically pass through unchanged. Uniform path — no short-vs-long branching in the client.
- **Real behavior over synthetic samples.** Provider choice was validated on real distribution — actual assistant messages Alice receives and actual voice clips from her own recording history, not fabricated test text. That standard carries into implementation: if any provider behavior is uncertain, exercise it on real distribution before locking assumptions.
- **Operator controls the cost gate.** The presence or absence of the narrow policy on an instance's host role IS the cost gate. No dashboards, no per-user quotas, no in-app spend caps — that's what the policy toggle covers.

## Prior context

- The current voice-in and voice-out paths already happen to speak the same wire shape most external providers use — a happy accident of the local rig having chosen an industry-standard shape. Voice-in on the client side is close to an endpoint swap; real work is on the backend translation layer.
- The old voice-out streaming pipeline is bespoke to the local rig's server-side chunking. The new pipeline moves chunking responsibility to Skynet's backend — same client experience, different owner of chunk boundaries.
- Cloud-account access on Alice's Skynet host was validated end-to-end during /open. The narrow exploratory-scoped policy is already attached to her host's role and produced the sample outputs Alice signed off on. The eventual production feature runs on the same mechanism.
- Skynet runs in two production places today — Alice's own instance and one managed by Stacy on the Aither company's box. Both need the new voice code and both need a policy attached on their side. The code itself is uniform between them.

## What would make it wrong

- Any client-side code path having to know which external provider is behind the backend. That says the provider-neutrality was broken.
- A message longer than the per-call ceiling producing audible pauses between chunks that a listener perceives as "the voice stopped mid-thought." Chunk-and-stitch should feel continuous.
- The migration silently mangling existing identity voice values instead of cleanly resetting them. The story is "voice cleared; re-pick next time you open the identity," not "voice still says the old name but nothing plays and there's no signal why."
- An operator having no way to turn the feature dark without editing app code. Not-attaching-the-policy has to be the off-switch, and the deploy doc has to name that explicitly.
- The deploy-time doc leaving operators guessing at what steps they need to take on their cloud side. It has to be complete enough that Stacy follows it end-to-end without pinging tabitha.
- Time-to-first-byte on voice-out being noticeably longer than today. The exploration confirmed the new provider stays under a few hundred milliseconds; that has to hold at ship.

## Scope edges

**In:**
- Voice-in swap end-to-end (recording → transcript via the new provider on the backend).
- Voice-out swap end-to-end (assistant text → played audio via the new provider on the backend, streaming preserved).
- Voice catalog reshape (fixed known set, no runtime fetch).
- Voice-value migration for existing identities (hard reset).
- Voice-value format validator update to match the new naming.
- Deploy-time in-repo doc covering per-instance operator setup on the cloud account side.
- Removal of the old local-rig endpoint configuration and integration paths (clean cutover, no dual-provider seam).

**Out:**
- Any provider besides the chosen one. No provider-selection UI, no config-driven dispatch, no adapter abstraction for a hypothetical third provider. Future flexibility explicitly deferred.
- Non-English voices and languages. Provider supports many; this shape covers English-US only.
- Cost visibility surfaces (dashboards, per-user quotas, spend caps). Policy-attach IS the cost gate.
- An in-app engine toggle or per-identity engine pick.
- Any change to the voice-record button, compose-box mic UI, or the cross-message interrupt behavior of the audio player. Those are pure client concerns and don't move.
- Bidirectional voice-conversational features (the "live phone call with an agent" pattern the provider offers as a separate product). Different shape entirely.

**Deferred, not tempting-but-no:**
- Per-voice sample-preview affordance (letting the user hear a voice before picking it). Nice-to-have; not required for this ship.

## Vehicle notes

**GSD phase, one phase.** Work crosses backend adapter code (two adapters, streaming lifecycle on both sides), frontend catalog reshape + validator update, migration for existing identity voice values, and a cross-tree deploy-time doc. Ceremony fits: atomic commits per touched surface, plan-checker catches "we forgot to remove the old integration path" class of miss, verify loop confirms chunk-and-stitch feels continuous at play-time.

**Exploration artifacts to reference during discuss-phase and plan-phase:** `~/.claude/roles/box-maintainer/bounties/more-versatile-stt-tts-support/` holds the validation samples Alice signed off on (real assistant messages fed to the voice-out service, real voice clips fed to the voice-in service, and the actual outputs). Plan-phase should read those to anchor the "real behavior over synthetic samples" philosophy.

**Coordination with Aither Infra:** Iris authored the narrow exploratory-scoped policy already attached to Alice's host. When shipping is imminent, ping her to re-scope from exploratory-name to a production name (she asked for that ping explicitly). Stacy on the Aither box picks up the new code via the standard cross-tree flow and follows the deploy doc on her side for her instance's cloud role.

---

## Close-Out

**Closed:** 2026-09-10
**Vehicle used:** GSD phase (Phase 98, 10 plans across 5 waves; two orchestrator-side inline fixes between waves — `fix(98-05)` Dirent type narrowing + `fix(98-07-followon)` roles-create validator swap)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Voice-in and voice-out end-to-end swapped to the two chosen external providers; local-rig integration paths removed cleanly.
- **Shape: voice-in lane** — present · Client contract unchanged (multipart blob upload); backend opens streaming session, pushes recording as a burst, returns transcript.
- **Shape: voice-out lane** — present · Backend orchestrator wraps single-call synth AND chunk-and-stitch for long text; client player unchanged in behavior.
- **Shape: voice catalog** — present · Fixed 7-voice known set inlined; no runtime fetch.
- **Shape: per-identity voice binding** — present · Hard-reset migration wired at backend boot; walks both identity and role frontmatter trees; explicit quote-strip line in place.
- **Shape: provider access per instance** — present · Ambient host-role credential chain (no static keys stored); operator-attaches-policy is the on/off switch.
- **Philosophy: client contract invariant** — present · Provider-agnostic client contract preserved; provider translation lives entirely on backend.
- **Philosophy: one provider, one tier, no ceremony** — present · No user-facing engine toggle, no per-identity engine pick.
- **Philosophy: one route through the backend** — present · Uniform backend orchestrator handles N=1 typical and N>1 long as the same code path.
- **Philosophy: real behavior over synthetic samples** — present · Exploration artifacts referenced in canonical refs; provider validated on real distribution during /open before commit.
- **Philosophy: operator controls the cost gate** — present · Policy-absence = feature-dark; no in-app spend surfaces.
- **Prior context: streaming ownership moves to backend** — present · Chunk boundaries owned by backend; client player consumes chunks unchanged.
- **Prior context: cross-instance uniform code** — present · Same code ships to both instances; per-instance operator config lives in the deploy doc.
- **What would make it wrong: client-side path knows provider** — guarded · Client-facing contract has no provider-specific branch.
- **What would make it wrong: chunk-and-stitch audible pauses** — cannot-verify (not readable) · Pipeline DESIGNED to keep audio continuous (sentence-boundary split, prefetch chunk N+1 while chunk N streams); actual perceived continuity is a run-time question that belongs to agent UAT, not /close.
- **What would make it wrong: migration silently mangles values** — guarded · Migration wraps everything in try/catch, never throws; boot-time one-shot idempotent; quote-strip guard load-bearing.
- **What would make it wrong: no operator off-switch** — guarded · Not-attaching-the-policy is the off-switch; explicitly named in the deploy doc.
- **What would make it wrong: deploy doc leaves operators guessing** — guarded · Doc is self-contained (204 lines), lists all four required policy actions inline, includes a verification command, and covers both t1000 and T800 sides.
- **What would make it wrong: TTFB noticeably slower** — cannot-verify (not readable) · Chosen provider validated at ~few-hundred-ms during exploration; run-time behavior belongs to agent UAT.
- **Scope edges: In-scope items** — all present · Voice-in swap, voice-out swap with streaming preserved, catalog reshape, hard-reset migration, validator update, deploy-time doc, clean removal of old integration paths.
- **Scope edges: Out-of-scope items honored** — present · No provider-selection UI/config/dispatch; no non-English voices; no cost dashboards / per-user quotas / spend caps; no in-app engine toggle; no changes to voice-record button or compose-box mic UI or cross-message interrupt behavior; no bidirectional voice-conversational features.
- **Scope edges: Deferred item (sample-preview) not implemented** — present · The pre-existing sample-preview button in the voice picker predates Phase 98 (patch #223 from Phase 20 per the reviewer's git-blame check); it is legacy code, not a Phase-98 addition.

### Additions (in the result, not in the shape)

None. The reviewer scanned the material for behaviors or features not in the shape and found none. The sample-preview button in the voice picker (which sits in the shape's "Deferred, not tempting-but-no" section) is pre-existing legacy code from Phase 20, not a Phase-98 addition — inclusion was a byproduct of inlining the catalog into the same file, not a new feature.

### Follow-ups

- Ping Iris pre-ship to re-scope her `PollyTranscribeExploratory` policy name on `termix-ssm-role` to a production name — deferred (already recorded in the shape's Vehicle notes + in the deploy doc's ship-motion checklist + in Plan 98-09 SUMMARY; not a shape divergence).
- Behavioral verification of chunk-and-stitch continuity + TTFB perception — deferred to agent UAT (/build step 5), which happens post-deploy against the running container.

### Notes

Two orchestrator-side inline fixes landed between waves and are worth naming as process observations, not shape divergences:
- `fix(98-05)`: Dirent type narrowing on readdir catch fallback — executor's `tsc --noEmit` ran on the frontend config which doesn't compile backend files; the post-wave-2 gate on the backend config caught it. Fleet-rule learning applied.
- `fix(98-07-followon)`: `roles-create.ts` validator swap — Plan 98-07 tightened the identity validator but the parallel `ROLE_VOICE_RE` on the role-create route was out-of-plan-scope; executor flagged it as deferred. Would have surfaced post-ship as "new roles with Polly voice IDs get 400-rejected." Fixed inline before Wave 4.

Both fixes preserved the shape's client-contract-invariant + clean-cutover philosophy. Neither was a divergence from the shape itself — both were plan-scope misses caught at the wave-boundary orchestrator gate.

The reviewer's return was a prose-formatted summary rather than the strict JSON contract the /close skill asks for, but the substantive review is complete and unambiguous. Every facet the reviewer walked was named; every out-of-scope commitment was explicitly checked against the material; no divergences requiring user adjudication were found.
