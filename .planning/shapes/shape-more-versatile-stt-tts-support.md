# Shape: more-versatile-stt-tts-support

**Opened:** 2026-09-10
**Vehicle:** GSD phase

## What this is

Skynet's voice-in (mic recording turned into text) and voice-out (assistant messages read aloud) currently terminate at a self-hosted model rig on Ashley's personal PC over the tailnet. That machine is going away as a model host — she's reclaiming it. This shape moves both sides of voice onto external cloud providers so nothing depends on the personal PC anymore.

Chosen providers, based on hands-on quality validation against real Skynet distribution: **Amazon Polly** for voice-out (top-tier generative engine, Ashley confirmed the quality matches or beats her local rig) and **Amazon Transcribe** streaming for voice-in.

## Shape

Two lanes, one philosophy — the client speaks the same shape it already speaks; the backend owns the whole translation to the new provider.

**Voice-in lane.** User records a clip in the compose box (unchanged UI). Recording lands at the backend as a blob upload — same client contract as today. Backend opens a streaming session with the external transcription service, pushes the recording as a burst, receives the transcript, returns it to the client. The client cannot tell whether the endpoint behind it is the local rig or a cloud provider.

**Voice-out lane.** Assistant message text goes from client to backend. Backend fires a synthesis call at the external voice provider — one call for typical messages, chunk-and-stitch on the backend side for messages that exceed the provider's per-call length ceiling — and streams the resulting audio back to the client as it arrives. Client audio player unchanged: decode-and-play as chunks land, cross-message single-speaker interrupt, sped-up playback rate all preserved.

**Voice catalog.** Concept shifts from "ask the local rig what voices it has installed" to "the provider publishes a fixed known set." That set is small (seven English-US voices in the chosen tier) — fits directly as a known list in the app, no runtime fetch needed.

**Per-identity voice binding.** Each identity carries the name of the voice it speaks in. Migration is a hard reset: every existing identity's voice value clears the day this ships, because none of the current voice names exist on the new provider. Identities re-pick from the new catalog next time an owner opens them.

**Provider access, per instance.** Each Skynet instance uses the ambient cloud-account identity attached to its host machine — no static keys stored in the app, no per-user credential handoff. Each operator attaches the narrow voice-service policy to their host's role on their side; a repo-tracked deploy-time doc walks through those steps. Policy present → feature works. Policy absent → feature dark for that instance.

## Philosophy

- **The client contract is invariant.** Whatever shape the client speaks today for voice-in and voice-out stays exactly as it is. All translation to the new provider is a backend concern. This preserves the option to swap providers later without touching frontend code.
- **One provider, one tier, no ceremony.** Voice-out is always top-tier generative because Ashley heard the quality difference and picked it flat. No user-facing engine toggle, no per-identity engine pick, no fallback tier. The mental model is: pick your voice, that's it.
- **One route through the backend, not two.** Backend always owns orchestration, even for short messages that would technically pass through unchanged. Uniform path — no short-vs-long branching in the client.
- **Real behavior over synthetic samples.** Provider choice was validated on real distribution — actual assistant messages Ashley receives and actual voice clips from her own recording history, not fabricated test text. That standard carries into implementation: if any provider behavior is uncertain, exercise it on real distribution before locking assumptions.
- **Operator controls the cost gate.** The presence or absence of the narrow policy on an instance's host role IS the cost gate. No dashboards, no per-user quotas, no in-app spend caps — that's what the policy toggle covers.

## Prior context

- The current voice-in and voice-out paths already happen to speak the same wire shape most external providers use — a happy accident of the local rig having chosen an industry-standard shape. Voice-in on the client side is close to an endpoint swap; real work is on the backend translation layer.
- The old voice-out streaming pipeline is bespoke to the local rig's server-side chunking. The new pipeline moves chunking responsibility to Skynet's backend — same client experience, different owner of chunk boundaries.
- Cloud-account access on Ashley's Skynet host was validated end-to-end during /open. The narrow exploratory-scoped policy is already attached to her host's role and produced the sample outputs Ashley signed off on. The eventual production feature runs on the same mechanism.
- Skynet runs in two production places today — Ashley's own instance and one managed by Stacy on the Aither company's box. Both need the new voice code and both need a policy attached on their side. The code itself is uniform between them.

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

**Exploration artifacts to reference during discuss-phase and plan-phase:** `~/.claude/roles/box-maintainer/bounties/more-versatile-stt-tts-support/` holds the validation samples Ashley signed off on (real assistant messages fed to the voice-out service, real voice clips fed to the voice-in service, and the actual outputs). Plan-phase should read those to anchor the "real behavior over synthetic samples" philosophy.

**Coordination with Aither Infra:** Iris authored the narrow exploratory-scoped policy already attached to Ashley's host. When shipping is imminent, ping her to re-scope from exploratory-name to a production name (she asked for that ping explicitly). Stacy on the Aither box picks up the new code via the standard cross-tree flow and follows the deploy doc on her side for her instance's cloud role.
