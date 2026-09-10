# Phase 97 — Discussion Log

**Note:** This phase's discussion happened INLINE with Ashley via `/build more-versatile-stt-tts-support` → `/open` on 2026-09-09 → 2026-09-10, NOT via `/gsd:discuss-phase` interactive elicitation. Per the `/build` skill directive ("If the vehicle is a GSD phase, seed discuss-phase from the shape file — don't re-do the discovery work `/open` already did"), CONTEXT.md was seeded directly from the shape file rather than re-eliciting gray areas.

The authoritative agreed-shape is `.planning/shapes/shape-more-versatile-stt-tts-support.md`. Every implementation decision in CONTEXT.md traces back to it.

## Discussion beats (paraphrased from `/open` session)

### Beat 1 — Ashley's pitch
Skynet's STT and TTS currently terminate at her personal PC's self-hosted models over the tailnet. She's reclaiming that PC for gaming, so needs to move both to external cloud APIs. She flagged that the voice catalog is plumbed throughout — probably needs reshaping to fit whoever the external provider is. Explicit uncertainty about how hard it'll be.

### Beat 2 — Discussion
- Codebase mapped end-to-end via Explore agent: STT & TTS-non-streaming already speak OpenAI-format on the client contract (happy accident of Chatterbox choosing the same wire shape); streaming TTS is Chatterbox-bespoke.
- Provider tradeoff surfaced: OpenAI (URL-swap-ish, small catalog), ElevenLabs (huge catalog, expensive), AWS (Polly + Transcribe — cheaper, larger neural catalog, real integration effort). Ashley picked AWS: *"it is the shape that's going to work great for the two instances of Skynet that exist in the world today that are both managed by me."*
- Discussion on Amazon Transcribe: no synchronous "POST audio, get transcript" endpoint at AWS; streaming is the only real-time option, so backend translation is more work than the OpenAI story would have been. Ashley accepted.
- Discussion on Polly 6000/3000-char per-call ceiling. Ashley pushed back on my characterization that it wouldn't bite in daily use: *"It is felt in daily use when you get giant messages from agents very often, so don't tell me what I experienced."* — chunk-and-stitch is a mainline concern, not an edge case.
- Ashley proposed unifying the backend path (rather than short-vs-long branching): *"rather than have one route where the client is doing TTS and one route where the backend is doing it, I wonder if it might just make more sense to have the backend do it and keep it simple."* Agreed — locked as "one route, all backend."
- Discussion on validating quality on real distribution before committing. Ashley asked me to DM Isabella (Aither Infra) for AWS test-drive access. Isabella forwarded to Iris (aither-infra-maintainer, who owns AWS work), who counter-proposed a better mechanism than what I asked for: attach a scoped inline policy to t1000's existing instance role (`termix-ssm-role`) so backend uses ambient IMDS creds instead of static keys. Attached in 30s.

### Beat 3 — Grill
- **Q: engine choice (neural vs generative per-identity, per-play, or global default)?** A (after Ashley heard the A/B): *"yeah, definitely generative, because it sounded way better."* Locked: always generative, no toggle.
- **Q: multi-instance scope (t1000 first, or both t1000 + T800 day-one)?** A: neither — Ashley's standing policy is "we just make sure to include what would need to be done at deploy time or just before it in the repo itself somewhere so that you can do those steps when it deploys over here and Stacy can follow those steps over on her side." Locked: uniform code, per-instance operator config via in-repo doc.

### Real-distribution validation
- Copied 3 real assistant messages Ashley attached + 5 real voice clips from `/opt/skynet/stt-recordings/` (durations 4.9s to 127.4s).
- Ran 30 Polly synths across 5 voices × 2 engines × 3 messages; served over tailnet at `http://100.99.149.8:8899/` (Skynet passthrough URLs had a client-side issue, fell back to plain tailnet HTTP per Ashley's request).
- Ran 5 Amazon Transcribe streaming runs via `amazon-transcribe` Python SDK on FLAC-transcoded clips.
- Ashley listened through, greenlit generative-engine flat: *"I think it's doing a better job than my personal models anyway, so I approve."*
- Exploration spend: $1.14 total (Polly $1.05 + Transcribe $0.09).

### Vehicle decision
- Recommended: single GSD phase (backend adapters + frontend catalog reshape + migration + cross-tree deploy doc = phase-shaped work). Ashley agreed: *"thumbs up."*

## Deferred ideas surfaced during `/open`

Captured in CONTEXT.md `<deferred>` section:
- Multi-language voices
- Provider-selection UI / adapter abstraction for hypothetical future providers
- Per-voice sample-preview affordance in identity modal
- In-app cost visibility surfaces
- Amazon Nova Sonic bidirectional voice-conversation shape
- Fall-back to secondary provider on AWS outage
- In-app engine toggle (neural fallback)

## Follow-up items outside the phase

- Ping Iris pre-ship to re-scope her `PollyTranscribeExploratory` policy name on `termix-ssm-role` to a production name. She asked for that ping explicitly. Not in the phase — coordination detail in the ship checklist.

---

*Discussion completed inline via `/build` on 2026-09-09 → 2026-09-10.*
