# Shape: choose the TTS provider per instance, like STT

**Opened:** 2026-10-08
**Vehicle:** inline
**Campaign:** tts-providers (`.planning/campaign-tts-providers.md`)

## What this is

Each Skynet instance gets a setting that names which service turns agent messages
into speech: Amazon Polly (the default, exactly today's behavior), OpenAI, or
ElevenLabs. It sits beside the existing speech-to-text provider setting and
behaves the same way. Every place in the app that speaks follows the active
provider, and every voice picker offers the active provider's voices. the user
wants the alternatives available even though she expects to stay on Polly for
now; the point is that switching becomes a one-setting change.

## Shape

- **The provider setting.** One per instance. Unset means Polly, byte-for-byte
  today's behavior. An unrecognised value, or a chosen provider missing its
  key, refuses clearly — speech is unavailable — and never quietly uses a
  different provider.
- **One common provider contract, many providers.** Every provider answers the
  same small set of questions: speak this text in this voice, what voices do
  you offer, which is your default, how much text fits in one request, and is
  this failure temporary (worth a retry) or a misconfiguration (speech
  unavailable). Everything else — the speaking paths, the voice-choice order,
  the pickers, message splitting, retries, logs — is written once against that
  contract and knows nothing provider-specific. Adding a fourth provider later
  means writing one new connection and adding it to the list of known
  providers, with no changes to the speaking paths or the app. This is the
  same structure speech-to-text got today.
- **Three provider connections.** Each takes text and a voice and returns audio
  in a form the existing player already plays; the player itself is not
  reworked. Each provider declares its own per-request text limit, and long
  messages are split to that limit instead of Polly's fixed one.
  - **Polly:** unchanged — generative engine, its fixed seven voices.
  - **OpenAI:** its fixed set of named voices. Defaults to its best-sounding
    model; an optional setting overrides the model.
  - **ElevenLabs:** the account's own voices, fetched live (today: the 21
    standard voices plus the account's three added ones). Defaults to its
    best-sounding model; an optional setting overrides the model.
- **Each provider's built-in default voice.** Polly: Joanna (as today).
  OpenAI: marin. ElevenLabs: River ("Relaxed, Neutral, Informative") — a
  standard voice, so present on every account. An optional instance setting
  overrides the default voice.
- **Every speaking path uses the active provider:**
  - the speak button on message bubbles (agent conversations and relay rooms)
  - hands-free voice mode reading replies aloud
  - the voice preview in the identity and role windows
  - speech that uses the user's fallback voice
- **Voice lists come from the server.** The app no longer carries its own
  built-in copy of Polly's seven voices; every picker (create role, create
  agent, identity window, role window, Agent voices preferences) asks the
  server for the active provider's list. The ElevenLabs list is remembered
  on the server for a few minutes rather than fetched on every picker open.
  If it can't be fetched, the picker still shows the currently saved voice by
  name plus a short line saying the list couldn't be loaded; nothing new can
  be picked, nothing else breaks.
- **How voices are saved.** Polly and OpenAI voices are saved by name, as today.
  ElevenLabs voices are saved by ElevenLabs's own stable voice code (names can
  change or collide); the app always displays the name, looked up from the
  list. The raw code is only ever seen in the identity or role file itself.
- **Saved voices are never rewritten.** Switching providers leaves every saved
  voice exactly as it was; switching back restores everyone's old voice.
- **Choosing which voice speaks — same order as today, skipping what the
  active provider doesn't have:** the identity's own voice, then its role's
  voice, then the user's personal fallback voice, then the provider's default.
  At each step a voice counts only if the active provider offers it.
  Speaking does not depend on the live ElevenLabs list being reachable: a
  saved ElevenLabs voice is still tried even if the list can't be fetched.
- **Pickers with an unavailable saved voice.** When the saved voice isn't
  offered by the active provider, the picker shows it greyed out with a note
  that it isn't available on the current voice service. It does not pretend
  the default was chosen, and it does not show blank. The note does not name
  the provider.
- **One personal fallback voice**, not one per provider; it gets the same
  greyed-out treatment when unavailable.
- **Failures are loud.** If the active provider fails (out of characters,
  revoked key, outage), the speak button shows its normal error state and
  hands-free mode says it couldn't speak. No fallback to another provider.
- **Logs** name the provider, voice, and model behind every speak request and
  every failure, and the voice-list fetches and their failures.
- **Docs and teaching.** Deploy docs and the example config describe the new
  settings. The id skill's description of the Agent voices pane and voice
  pickers is updated to match what the user now sees.

## Philosophy

- The default is today. An instance nobody touches must not change at all —
  same voices, same sound, same audio staying inside AWS for a BAA instance.
- Mirror speech-to-text. Same per-instance stance, same "never silently use a
  provider the operator didn't choose" rule.
- The user's choices are durable. Nothing the user picked is overwritten
  because an operator changed a box setting.
- Honest pickers. The picker shows what's actually saved, even when it can't
  be used right now.

## Prior context

- Speech-to-text became selectable per instance today (Bedrock default;
  ElevenLabs, Mistral, Groq). t1000 currently runs speech-to-text on ElevenLabs
  and already holds API keys for ElevenLabs, OpenAI, Mistral and Groq.
- Text-to-speech has been Polly-only since it replaced the earlier self-hosted
  engine: generative engine, seven fixed voices, the voice list duplicated
  between server and app, long messages split under Polly's ~3,000-character
  per-request limit, and audio streamed to a player that plays raw audio of
  whatever sample rate the stream announces.
- Voice choice today runs identity, then role, then the user's fallback voice
  (Agent voices preferences), then Joanna.
- Cost check (2026-10-08, list prices): at the user's likely ~3 million spoken
  characters a month, OpenAI ~$45, Polly ~$90, ElevenLabs ~$120–240. Her
  ElevenLabs account is on the free tier (10,000 characters a month). She is
  staying on Polly; this work is for availability.

## What would make it wrong

- An instance with no setting sounds or behaves any differently from today.
- A misconfigured or failing provider quietly falls back to a different
  provider — audio going somewhere the operator didn't choose.
- Switching provider rewrites or erases anyone's saved voice.
- A picker silently shows the default as selected when the saved voice is
  merely unavailable, so the user believes their choice was lost.
- Some speaking path (relay bubbles, hands-free mode, preview) still talks to
  Polly while the rest of the instance uses another provider.
- A long message cuts off partway on a non-Polly provider.
- Speech goes silent with no visible error when a provider fails.
- The app keeps a second, hard-coded voice list that drifts from the server.
- Adding another provider later would mean touching the speaking paths, the
  voice-choice order, or the app — provider knowledge has leaked out of the
  provider connections.

## Scope edges

- **In:** everything in Shape above.
- **Out:** choosing the provider per user; showing which provider is active
  in the app; Mistral or Groq as speech providers; an agent-side "speak this
  text" service (noted in the campaign as a candidate for a later build);
  OpenAI tone or style instructions; per-provider personal fallback voices;
  any cost guard or usage limit.
- **Tempting but no:** a fallback to Polly "just in case"; translating saved
  Polly voices into lookalike voices on other providers.

## Vehicle notes

Inline, in this session, by anchor-box-maintainer-2 — the user is evaluating a
new model on this approach. Track pieces with harness tasks. Standing role rules
still apply: scoped tests during work, full suite only as the deploy gate; stop
after commit and report — no push or deploy without the user's separate
greenlight. Mirror the speech-to-text provider work (landed today) for
structure.

---

## Close-Out

**Closed:** 2026-10-08
**Vehicle used:** inline (uncommitted working-tree changes on the feature branch; no commit, push or deploy)
**Overall verdict:** closed-hit (after two fix rounds: first pass closed-with-misses, second closed-partial)

### Shape features (conformance)

- **What this is** — present · One per-instance setting chooses Polly (default), OpenAI or ElevenLabs, beside the speech-to-text one; every speaking path and picker follows it.
- **Shape: The provider setting** — present · Unset means Polly; unknown value or missing/rejected key is "speech unavailable"; never another provider.
- **Shape: One common provider contract, many providers** — present · Speak, list voices, default, per-request limit, temporary-vs-misconfiguration; everything else written once against it.
- **Shape: Three provider connections** — present · Polly unchanged; OpenAI fixed voices; ElevenLabs live account voices; default models with override; per-provider limits; existing player untouched.
- **Shape: Each provider's built-in default voice** — present · Joanna, marin, River; optional override.
- **Shape: Every speaking path uses the active provider** — present · Bubbles (agent + relay), hands-free, previews, fallback-voice speech.
- **Shape: Voice lists come from the server** — present · App list gone; server remembers ElevenLabs list five minutes; list-down shows a "couldn't load" line and names the saved voice from the last good list. Create-role / create-agent dialogs have no picker today.
- **Shape: How voices are saved** — present · Names for Polly/OpenAI, codes for ElevenLabs; raw codes never on screen.
- **Shape: Saved voices are never rewritten** — present
- **Shape: Choosing which voice speaks** — present · Identity → role → fallback → default, skipping unavailable; ElevenLabs voice still tried with the list down.
- **Shape: Pickers with an unavailable saved voice** — present · Greyed, selected, "Not available on the current voice service", provider not named.
- **Shape: One personal fallback voice** — present
- **Shape: Failures are loud** — present · Notice on speak button; error cue + message in hands-free mode; no other provider.
- **Shape: Logs** — present · Provider, model and voice on every request, failure and retry line; list fetches/failures logged.
- **Shape: Docs and teaching** — present · Deploy doc + example config; id skill gains hands-free voice mode; Agent voices description unchanged per the user.
- **Philosophy** — present
- **Scope edges** — present · Nothing out-of-scope appeared.
- **What would make it wrong: An instance with no setting sounds or behaves any differently from today** — present · Polly sound unchanged; visible changes endorsed.
- **What would make it wrong: A misconfigured or failing provider quietly falls back to a different provider** — present
- **What would make it wrong: Switching provider rewrites or erases anyone's saved voice** — present
- **What would make it wrong: A picker silently shows the default as selected when the saved voice is merely unavailable** — present
- **What would make it wrong: Some speaking path still talks to Polly while the rest uses another provider** — present
- **What would make it wrong: A long message cuts off partway on a non-Polly provider** — present · Split to each provider's limit.
- **What would make it wrong: Speech goes silent with no visible error when a provider fails** — present
- **What would make it wrong: The app keeps a second, hard-coded voice list** — present
- **What would make it wrong: Adding another provider would mean touching the speaking paths, voice-choice order, or the app** — present

### Additions (in the result, not in the shape)

- Bubble speak button shows a "Couldn't speak this message" notice on failure (the shape assumed an existing error state that didn't exist) — endorsed-as-drift
- Relay-room speak buttons use role voice and the user's fallback before the default — endorsed-as-drift
- Preview button disabled while an unavailable voice is selected — endorsed-as-drift
- Picker entries show descriptions beside names — endorsed-as-drift
- App keeps a one-minute copy of the voice list — endorsed-as-drift
- Preview speak path splits long text into several requests — endorsed-as-drift
- Temporary speak failures retried (up to three attempts) — endorsed-as-drift
- "Saved voice" label for a voice the server has never been able to name — endorsed-as-drift
- Server remembers each provider's last good voice list, for naming only, until restart — endorsed-as-drift

### Follow-ups

- New roles are preset to a fixed Polly voice, skipped on other providers; decide later whether they should take the active provider's default — deferred

### Notes

All conformance settled by reading the uncommitted working tree. After a server restart with ElevenLabs unreachable before any successful list fetch, saved ElevenLabs voices show as "Saved voice" (the endorsed never-known-name case).
