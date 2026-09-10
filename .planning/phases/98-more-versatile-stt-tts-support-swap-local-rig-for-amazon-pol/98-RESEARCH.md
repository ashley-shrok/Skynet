# Phase 98: More versatile STT/TTS support — swap local rig for Amazon Polly + Amazon Transcribe — Research

**Researched:** 2026-09-10
**Domain:** AWS SDK v3 integration on Node.js backend (Polly TTS + Transcribe streaming STT), audio format bridging, sentence-boundary chunking, on-disk identity migration, cross-tree deploy documentation
**Confidence:** HIGH on AWS SDK shape and package choices, HIGH on codebase touch surfaces, MEDIUM on chunk-and-stitch algorithm choice (multiple viable approaches), MEDIUM on WebM→Ogg-Opus remux path (no clean pure-Node library — ffmpeg-in-container is the recommendation)

## Summary

Phase 98 replaces Chatterbox (self-hosted rig at tailnet `100.80.122.111`) with Amazon Polly (voice-out, generative engine) + Amazon Transcribe streaming (voice-in). Every architectural gray area has already been resolved in `98-CONTEXT.md` — this research answers implementation HOWs.

The two AWS SDK packages needed (`@aws-sdk/client-polly` and `@aws-sdk/client-transcribe-streaming`) are current, actively maintained, modular v3 packages that bundle `@aws-sdk/credential-provider-node` — which includes IMDS in its default chain — so the ambient-instance-identity decision from CONTEXT works out of the box with `new PollyClient({ region: "us-east-1" })`. No manual credential wiring.

Two structural forcing functions dominate the plan:

1. **Amazon Transcribe streaming does NOT accept WebM.** Browser MediaRecorder default is WebM/Opus. Transcribe streaming accepts only FLAC, Ogg Opus, and PCM 16-bit LE. Since the client contract is locked as "browser uploads whatever MediaRecorder gave it, backend translates," the backend MUST transcode/remux before pushing to Transcribe. **ffmpeg is not currently in the Skynet docker image** (verified — `docker/Dockerfile` has no `ffmpeg` install line). Recommendation: add `ffmpeg` to Stage 5 apt-get install list. Pure-Node WebM→Ogg-Opus remuxers exist only as browser-side WASM (opus-media-recorder) — no server-side pure-Node option was found. ffmpeg is a ~30MB install, well-worn dependency.

2. **Polly's per-call ceiling is 6000 chars total / 3000 billed** with `TextLengthExceededException` on overshoot. The exploration samples show real assistant messages are 961–2043 chars (all fit in one call). Chunk-and-stitch matters for the outlier cases (2000–25000-char range Skynet's `SPEAK_TEXT_MAX` allows). Recommended algorithm: regex sentence-split with a small common-abbreviation guard list, greedy pack into ≤2900-char sub-chunks (100-char safety margin against billable overrun), fire Polly calls in-order, pipe each response's `AudioStream` sequentially back to the client. Since the client `webAudioStreamPlayer` handles gapless nextStartTime-driven scheduling of arriving chunks, gaps between Polly calls surface as gaps in the WebSocket byte stream — mitigated by pre-fetching chunk N+1 while chunk N is streaming to the client.

**Primary recommendation:** Structure the backend as three focused adapter modules under `src/backend/voice/`:
- `polly-adapter.ts` — one `SynthesizeSpeech` call, returns a Readable stream of MP3 bytes.
- `transcribe-adapter.ts` — opens a stream transcription session, pushes a burst of chunks from a buffered WebM→FLAC/Ogg-Opus transcode, awaits final transcripts.
- `chunk-and-stitch.ts` — sentence-boundary splitter + orchestrator that fires N Polly calls and concatenates the streams for `handleSpeakStream`.

Format on the wire client-facing: **request MP3 from Polly** (widest browser support, smallest bytes, and — key win — `webAudioStreamPlayer.ts` uses `AudioContext.decodeAudioData` semantically, so switching from PCM-in-WAV to MP3 requires reworking the player's decode loop). The player is currently PCM-only via `riffPcmDecode`. **Recommend:** request `pcm` from Polly (signed 16-bit, 1-channel, little-endian at 16000Hz), wrap each Polly response with a synthetic RIFF header on the backend so the player's existing decoder consumes it unchanged. Sample-rate compatibility is the strongest argument — Chatterbox emitted variable sample rates, Polly PCM is exactly one rate the player can lock to.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Voice recording (mic capture) | Browser | — | MediaRecorder API is client-only; unchanged in this phase |
| Voice-in upload contract | Browser → API | — | Multipart POST /voice/transcribe — locked invariant per CONTEXT |
| Audio transcode (WebM → Ogg Opus / FLAC) | API / Backend | — | Transcribe rejects WebM natively; backend owns provider adaptation per locked contract |
| Amazon Transcribe streaming session | API / Backend | AWS Transcribe service | Backend opens the stream and pushes buffered audio as a burst; AWS returns transcript |
| Slash-command transform | API / Backend | — | Preserved unchanged (`slashCommandTransform.ts`) — runs post-transcript regardless of provider |
| STT disk-bank (fire-and-forget to `/app/stt-recordings/`) | API / Backend | — | Preserve verbatim — Ashley's post-hoc reference; CONTEXT explicit |
| Voice-out request | Browser → API | — | JSON POST /voice/speak-stream with `{text, voice}` — locked invariant per CONTEXT |
| Sentence-boundary chunking (long text) | API / Backend | — | Chunk-and-stitch is a backend concern per CONTEXT; client player unchanged |
| Amazon Polly synthesis | API / Backend | AWS Polly service | Backend fires one call per chunk; AWS returns audio bytes |
| Streaming audio playback | Browser | — | `webAudioStreamPlayer.ts` unchanged in behavior; may need decoder-format adapter |
| Voice catalog (fixed 7-voice list) | Browser (const) OR API (hardcoded return) | — | Fixed set; planner's discretion on inlining vs proxied |
| Voice-value validation | API / Backend (canonical) + Browser (mirror) | — | Whitelist enum of 7 Polly voice IDs; validators on both tiers per Phase 86 precedent |
| Identity voice migration (one-shot wipe) | API / Backend (script) | Filesystem | Walks `~/.claude/identities/*/*.md` and `~/.claude/roles/*/*.md`, clears `voice:` frontmatter matching old regex |
| AWS credential resolution | API / Backend (SDK default chain) | AWS IMDS | Ambient instance role via IMDS — SDK default provider chain, no wiring |
| Off-switch (policy detach) | Ops / Infra | AWS IAM | Not-attaching-the-policy = feature dark, per CONTEXT |
| Deploy doc | Repo docs | — | New MD file in `docs/deploy/` for operators of both t1000 + T800 |

## Phase Requirements

CONTEXT.md does not assign formal REQ-IDs; requirements are captured in `<decisions>`. Below is the verification-bar-derived requirement table for downstream planning traceability:

| Local ID | Description | Research Support |
|----------|-------------|------------------|
| P98-STT-01 | Voice-in end-to-end via Transcribe streaming, transcript quality ≥ Chatterbox on Ashley's voice | Verified in exploration (5 clips, 4.9s–127.4s) — see `samples/transcribe-outputs/` |
| P98-STT-02 | Client contract unchanged (multipart POST /voice/transcribe) | Backend-side transcode path recommended (§ Common Pitfalls #1) |
| P98-STT-03 | Slash-command transform runs on transcript regardless of provider | `slashCommandTransform.ts` is provider-agnostic — no changes needed (§ Code Examples #4) |
| P98-STT-04 | STT disk-bank to `/app/stt-recordings/` preserved | Preserve pre-transcode bytes, not post-transcode (§ Common Pitfalls #6) |
| P98-TTS-01 | Voice-out end-to-end via Polly generative engine | Verified in exploration (30 synths, 5 voices × 2 engines × 3 messages, Ashley picked generative) |
| P98-TTS-02 | Chunk-and-stitch produces continuous audio on messages >3000 billed chars | Sentence-split → pack ≤2900 chars → sequential Polly calls → pipe through (§ Pattern 3) |
| P98-TTS-03 | Time-to-first-byte within a few hundred ms | Polly first-byte typical is ~200-400ms (§ State of the Art) |
| P98-TTS-04 | Client player `webAudioStreamPlayer.ts` unchanged in behavior | Request PCM from Polly + synthesize RIFF wrapper on backend (§ Pattern 4) |
| P98-CAT-01 | Fixed 7-voice catalog visible in identity modal | Hardcoded const on backend, returned by `handleListVoices` OR inlined on frontend |
| P98-MIG-01 | Every pre-existing identity's voice value cleared post-migration | One-shot script walks `~/.claude/identities/*/*.md` + `~/.claude/roles/*/*.md`, clears `voice:` YAML line |
| P98-MIG-02 | Validator regex updates to whitelist of 7 Polly voice IDs | Update `identities.ts:51` `IDENTITY_VOICE_RE` from regex to Set-based check |
| P98-OFF-01 | Policy-detached = feature dark, no crash/spam | AccessDenied → structured error response, log at info-level (not error) |
| P98-DOC-01 | Deploy-time doc walks operator through policy attach | New `docs/deploy/aws-voice-setup.md` |
| P98-KILL-01 | Chatterbox integration paths deleted | `media-endpoints.ts` (or reshape), old `voice.ts` handlers replaced, `voice-api.ts:getVoices` reshaped/deleted |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-polly` | 3.1129.0 (published 2026-09-09) | Voice-out via `SynthesizeSpeechCommand` | Canonical v3 modular AWS SDK client for Polly. Actively maintained (weekly releases). Bundles `@aws-sdk/credential-provider-node` so IMDS-based ambient credentials work with zero config. Response `AudioStream` is a Node `Readable` — pipes directly to Express `res`. [VERIFIED: npm registry via `npm view`; CITED: docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html] |
| `@aws-sdk/client-transcribe-streaming` | 3.1129.0 (published 2026-09-09) | Voice-in via `StartStreamTranscriptionCommand` | The ONLY real-time STT path AWS offers (no synchronous POST-audio-get-text endpoint). Uses HTTP/2 event streams; async-generator `AudioStream` input, async-iterable `TranscriptResultStream` output. Same version-cadence as Polly package. [VERIFIED: npm registry; CITED: docs.aws.amazon.com/transcribe/latest/dg/streaming.html] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ffmpeg` (apt package, not npm) | Debian bookworm default ~5.1 or newer | WebM/Opus → Ogg-Opus or FLAC transcode | Required if backend-side transcode chosen (recommended). Add to `docker/Dockerfile` Stage 5 apt-get list. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@aws-sdk/client-polly` | `aws-sdk` v2 monolith | Would inflate bundle by ~50MB and pull in every AWS service. Not tree-shakeable. v2 is in maintenance mode. Reject. |
| `@aws-sdk/client-transcribe-streaming` | Websocket direct-to-Transcribe from browser | Would require signing requests in the browser (needs presigned URL flow) AND would leak the fact that AWS is behind the endpoint — violates locked client-contract invariant. Reject. |
| Backend-side ffmpeg transcode | Client-side transcode via `opus-media-recorder` polyfill | Adds ~200KB WASM to frontend, requires Worker setup, breaks the "client speaks unchanged shape" invariant. Reject. |
| Backend ffmpeg spawn | Pure-Node WebM→Ogg remuxer | **No mature library exists.** ffmpeg is the correct tool for this. |
| Request PCM from Polly | Request MP3 from Polly | MP3 would require the existing `webAudioStreamPlayer.ts` to add MP3 decoding (via `AudioContext.decodeAudioData` on complete files, not chunk-by-chunk) — architectural rewrite of the player. PCM preserves the RIFF+PCM decoder path already shipped. Choose PCM. |
| `require`-style import | ESM `import` from AWS SDK v3 | AWS SDK v3 is native-ESM and native-CJS both; Skynet backend uses `.js` (ESM). Use ESM. |
| Bundled npm ffmpeg (`@ffmpeg-installer/ffmpeg`) | System ffmpeg via apt | The npm package installs a static binary at runtime — larger image, slower cold start. apt install is the docker-native path. Choose apt. |

**Installation:**
```bash
npm install @aws-sdk/client-polly @aws-sdk/client-transcribe-streaming
```

Add to `docker/Dockerfile` Stage 5 (near line 66):
```dockerfile
RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu wget ffmpeg && \
    ...
```

**Version verification (verified 2026-09-10 on t1000):**
```bash
npm view @aws-sdk/client-polly version                     # → 3.1129.0
npm view @aws-sdk/client-transcribe-streaming version      # → 3.1129.0
npm view @aws-sdk/credential-provider-node version         # → 3.972.83 (transitive dep of both)
npm view @aws-sdk/client-polly time.modified               # → 2026-09-09T18:46:14Z (yesterday — actively maintained)
```

Both AWS packages are published weekly; version bump between plan-time and ship-time is expected. Pin to `^3.1129.0` (patch-updates allowed).

## Package Legitimacy Audit

slopcheck was not available at research time (`command -v slopcheck` → not found; `pip install slopcheck` not attempted per user preference on modifying system Python). All packages below are marked `[ASSUMED VERIFIED]` and planner should insert `checkpoint:human-verify` before the first install task.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@aws-sdk/client-polly` | npm | 8+ years (v3 line since 2020) | ~4M/wk (typical for AWS SDK v3 clients) | github.com/aws/aws-sdk-js-v3 | not run | Approved [ASSUMED VERIFIED: AWS-authored, canonical] |
| `@aws-sdk/client-transcribe-streaming` | npm | 5+ years | ~200K/wk | github.com/aws/aws-sdk-js-v3 | not run | Approved [ASSUMED VERIFIED: AWS-authored, canonical] |
| `@aws-sdk/credential-provider-node` | npm | 6+ years | Bundled with above; not a direct install | github.com/aws/aws-sdk-js-v3 | not run | Transitive — no explicit install |
| `ffmpeg` (apt) | Debian bookworm main | Decades | N/A | ffmpeg.org | N/A | Approved [VERIFIED: system package] |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

*Both AWS packages are published by the `@aws-sdk` scope (AWS-authored). Verification path for the planner's checkpoint: `npm view @aws-sdk/client-polly maintainers` should list `aws-sdk-bot` or similar AWS-owned identity. Source repo at `github.com/aws/aws-sdk-js-v3` is the canonical AWS-authored monorepo — no substitution risk of comparable typosquat concern.*

## Architecture Patterns

### System Architecture Diagram

```
VOICE-IN LANE (Browser mic → transcript)

┌────────────────────────────────────────────────┐
│ Browser                                        │
│ useVoiceRecording.ts                           │
│   MediaRecorder → WebM/Opus Blob               │
│   POST /voice/transcribe (multipart)           │◄── CLIENT CONTRACT LOCKED
└─────────────┬──────────────────────────────────┘
              │ multipart/form-data (file field)
              ▼
┌────────────────────────────────────────────────┐
│ Backend voice.ts::handleTranscribe             │
│  1. multer parses (25MB cap, T-16-01)          │
│  2. Disk-bank write (fire-and-forget)          │◄── PRESERVE (Ashley reference)
│  3. transcode-adapter.ts                       │
│     ffmpeg spawn: webm → ogg-opus              │◄── NEW (Transcribe rejects webm)
│  4. transcribe-adapter.ts                      │
│     - open StartStreamTranscriptionCommand     │
│     - push audio chunks via async generator    │
│     - collect final transcript from            │
│       TranscriptResultStream                   │
│  5. slashCommandTransform (unchanged)          │◄── PRESERVE
│  6. Return { text: transcript } JSON           │
└─────────────┬──────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────┐
│ AWS Transcribe Streaming                       │
│ (region: us-east-1, IMDS credentials)          │
└────────────────────────────────────────────────┘


VOICE-OUT LANE (Assistant text → played audio)

┌────────────────────────────────────────────────┐
│ Browser                                        │
│ ChatMessage.tsx → postSpeakStream(text, voice) │
│ POST /voice/speak-stream { text, voice }       │◄── CLIENT CONTRACT LOCKED
└─────────────┬──────────────────────────────────┘
              │ application/json
              ▼
┌────────────────────────────────────────────────┐
│ Backend voice.ts::handleSpeakStream            │
│  1. Validate text length + voice whitelist     │◄── whitelist replaces regex
│  2. chunk-and-stitch.ts                        │
│     splitSentences(text) → pack ≤2900-char     │◄── NEW (Polly ceiling)
│     chunks. Typical: N=1. Long: N>1.           │
│  3. Set headers: audio/wav, X-Accel-Buffering  │
│  4. For each chunk (sequential, prefetch N+1): │
│     - polly-adapter.ts fires SynthesizeSpeech  │
│       (OutputFormat=pcm, 16kHz, 1ch, s16le)    │
│     - synthesize RIFF header for first chunk;  │
│       subsequent chunks emit raw PCM bytes     │◄── keeps player unchanged
│     - Readable.pipe(res, {end: false})         │
│  5. On final chunk: res.end()                  │
└─────────────┬──────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────┐
│ AWS Polly (SynthesizeSpeech, generative, PCM)  │
└─────────────┬──────────────────────────────────┘
              │ streamed audio bytes (Readable)
              ▼
┌────────────────────────────────────────────────┐
│ Browser webAudioStreamPlayer.ts (UNCHANGED)    │
│   parseRiffHeader → decodePcmChunk →           │
│   nextStartTime-scheduled AudioBufferSourceNode │
│   playback rate 1.25x                          │
└────────────────────────────────────────────────┘


VOICE CATALOG + PICKER

┌─────────────────────────────────────┐
│ Frontend VoicePicker.tsx            │
│   getVoices() → 7 hardcoded voices  │◄── inline OR proxy through backend const
└─────────────────────────────────────┘


IDENTITY VOICE VALUE MIGRATION (one-shot, ship-day)

┌────────────────────────────────────────────────┐
│ scripts/migrate-voice-values.ts (or similar)   │
│  For each ~/.claude/identities/<key>/<key>.md: │
│    parse frontmatter                           │
│    if voice matches /^[A-Z][A-Za-z]+\.wav$/:   │
│      remove voice: line                        │
│      write back                                │
│  Same walk for ~/.claude/roles/<role>/<role>.md│
│  Idempotent: no-op if voice already unset or   │
│  matches new 7-voice whitelist                 │
└────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/backend/voice/
├── polly-adapter.ts              # NEW — SynthesizeSpeech wrapper
├── transcribe-adapter.ts         # NEW — StartStreamTranscription wrapper
├── audio-transcode.ts            # NEW — ffmpeg spawn for webm→ogg-opus
├── chunk-and-stitch.ts           # NEW — sentence-split + orchestrator
├── polly-voice-catalog.ts        # NEW — fixed 7-voice const + validation set
├── riff-header-builder.ts        # NEW — builds 44-byte RIFF wrapper for PCM
├── slashCommandTransform.ts      # UNCHANGED (Phase 34)
├── skill-catalog.ts              # UNCHANGED (Phase 34)
└── *.test.ts                     # NEW/UPDATED

src/backend/database/routes/
├── voice.ts                      # REWRITTEN handlers, same route registrations
└── voice.test.ts                 # REWRITTEN — mock AWS SDK clients

src/backend/config/
└── media-endpoints.ts            # DELETED (or reshaped to AWS region const)

src/ui/api/
└── voice-api.ts                  # postSpeak / postSpeakStream unchanged in shape;
                                  # getVoices reshaped to return hardcoded set OR removed

src/ui/features/pretty-view/pickers/
└── VoicePicker.tsx               # Wire to fixed catalog; unchanged in visual shape

docs/deploy/
└── aws-voice-setup.md            # NEW — per-instance operator policy-attach walkthrough

docker/
└── Dockerfile                    # Stage 5 apt-get list: add `ffmpeg`
```

### Pattern 1: Polly SynthesizeSpeech with IMDS credentials

```typescript
// Source: docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html
//         github.com/aws/aws-sdk-js-v3 (canonical example pattern)
import { PollyClient, SynthesizeSpeechCommand, Engine, OutputFormat, VoiceId }
  from "@aws-sdk/client-polly";
import { Readable } from "node:stream";

const client = new PollyClient({ region: "us-east-1" });
// No credentials arg → uses @aws-sdk/credential-provider-node default chain,
// which resolves to IMDS on EC2 automatically. Same shape as the Python
// exploration script — no credential handoff.

export async function synthesizeToPcm(text: string, voiceId: string): Promise<Readable> {
  const cmd = new SynthesizeSpeechCommand({
    Text: text,
    Engine: "generative",
    OutputFormat: "pcm",         // signed 16-bit LE, 1ch (mono)
    SampleRate: "16000",         // 16kHz — one of two valid values for pcm
    VoiceId: voiceId as VoiceId, // "Danielle" | "Joanna" | ...
  });
  const response = await client.send(cmd);
  if (!response.AudioStream) throw new Error("Polly returned no AudioStream");
  // AudioStream in Node.js is an IncomingMessage / Readable — pipe-able.
  return response.AudioStream as Readable;
}
```

### Pattern 2: Transcribe Streaming from a buffered file (Node port of `transcribe-flac.py`)

```typescript
// Source: docs.aws.amazon.com/transcribe/latest/dg/streaming.html
//         github.com/aws/aws-sdk-js-v3/tree/main/clients/client-transcribe-streaming
//         Port of ~/.claude/roles/box-maintainer/bounties/more-versatile-stt-tts-support/transcribe-flac.py
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  LanguageCode,
  MediaEncoding,
  type AudioStream,
} from "@aws-sdk/client-transcribe-streaming";

const client = new TranscribeStreamingClient({ region: "us-east-1" });

// The Node SDK accepts AudioStream as an async iterable of
// { AudioEvent: { AudioChunk: Uint8Array } } objects.
async function* audioChunkGenerator(buffer: Buffer): AsyncIterable<AudioStream> {
  const CHUNK_SIZE = 16 * 1024; // 16 KB — same as Python reference
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
    yield { AudioEvent: { AudioChunk: chunk } };
  }
}

export async function transcribeBuffer(
  audioBuffer: Buffer,      // Post-transcode: ogg-opus or flac bytes
  mediaEncoding: "flac" | "ogg-opus" | "pcm" = "ogg-opus",
  sampleRateHz = 16000,
): Promise<string> {
  const cmd = new StartStreamTranscriptionCommand({
    LanguageCode: "en-US" as LanguageCode,
    MediaSampleRateHertz: sampleRateHz,
    MediaEncoding: mediaEncoding as MediaEncoding,
    AudioStream: audioChunkGenerator(audioBuffer),
  });

  const response = await client.send(cmd);
  if (!response.TranscriptResultStream) {
    throw new Error("Transcribe returned no TranscriptResultStream");
  }

  const finalTranscripts: string[] = [];
  for await (const event of response.TranscriptResultStream) {
    if (event.TranscriptEvent?.Transcript?.Results) {
      for (const result of event.TranscriptEvent.Transcript.Results) {
        // Skip partial results — only accumulate finals (IsPartial === false).
        if (result.IsPartial) continue;
        for (const alt of result.Alternatives ?? []) {
          if (alt.Transcript) finalTranscripts.push(alt.Transcript);
        }
      }
    }
  }
  return finalTranscripts.join(" ");
}
```

**Critical: async iterable semantics.** The Node SDK bridges the HTTP/2 event stream through an async iterable. `for await` naturally handles backpressure. The audio-push generator and transcript-consume loop run concurrently once `client.send()` returns; no explicit `Promise.all` needed like in the Python version (SDK layer handles it).

### Pattern 3: Chunk-and-stitch orchestrator for long text

```typescript
// Source: informed by CONTEXT § Backend-owned orchestration + Polly 3000-billed-char ceiling
// Sentence-boundary regex approach — chosen over nlp libraries to avoid
// pulling in another dependency (10KB regex vs 500KB+ tokenizer).
export function splitIntoSentences(text: string): string[] {
  // Match sentence-terminators followed by whitespace, avoiding common
  // abbreviations. `?<=` = lookbehind (Node 12+). Simple heuristic —
  // sufficient for chat-message text; not for legal docs.
  const ABBREVIATIONS = new Set([
    "Mr", "Mrs", "Ms", "Dr", "Sr", "Jr", "Prof", "St", "Mt",
    "vs", "etc", "e.g", "i.e", "a.m", "p.m", "U.S", "U.K"
  ]);
  // Split on .!? followed by whitespace/EOL, but preserve terminators.
  const parts = text.split(/(?<=[.!?])\s+/);
  // Merge parts where the previous segment ended in a known abbreviation.
  const out: string[] = [];
  for (const part of parts) {
    if (out.length === 0) { out.push(part); continue; }
    const prev = out[out.length - 1];
    const lastWord = (prev.match(/(\S+)[.!?]$/)?.[1] ?? "").replace(/\.$/, "");
    if (ABBREVIATIONS.has(lastWord)) {
      out[out.length - 1] = prev + " " + part;
    } else {
      out.push(part);
    }
  }
  return out;
}

// Pack sentences into chunks that stay under the safe billing ceiling.
// Polly's ceiling: 3000 billed chars. Use 2900 for a 100-char safety margin
// (SSML tags don't count as billed but plain text does; if any planner
// experiments with SSML later this margin stays useful).
const CHUNK_MAX_CHARS = 2900;

export function packChunks(sentences: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > CHUNK_MAX_CHARS) {
      // Single sentence exceeds the ceiling — fall back to word-boundary split.
      if (current) { chunks.push(current); current = ""; }
      const words = sentence.split(/\s+/);
      let sub = "";
      for (const w of words) {
        if ((sub + " " + w).length > CHUNK_MAX_CHARS) {
          chunks.push(sub); sub = w;
        } else {
          sub = sub ? sub + " " + w : w;
        }
      }
      if (sub) chunks.push(sub);
      continue;
    }
    const separator = current ? " " : "";
    if ((current + separator + sentence).length > CHUNK_MAX_CHARS) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current + separator + sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
```

**Orchestrator behavior for handleSpeakStream:**
1. Split + pack. `chunks.length === 1` for typical messages (≤2900 chars including all exploration samples at 961–2043); `>1` only for outliers.
2. Fire Polly call for chunk[0], get its `Readable`.
3. **Optional but recommended:** As soon as chunk[0]'s stream starts flowing to the client, fire chunk[1]'s Polly call in parallel (pre-fetch). Cap concurrency at 2 to avoid unbounded parallelism on pathologically long input.
4. Pipe each chunk's `AudioStream` to `res` sequentially with `{ end: false }`, only calling `res.end()` after the last chunk.
5. On the first chunk only: prepend a synthesized RIFF header (44 bytes) so the client's existing `parseRiffHeader` accepts the stream. Subsequent chunks emit raw PCM.

### Pattern 4: RIFF header synthesis for streaming PCM

```typescript
// Source: RIFF/WAVE specification (universally known format) + reverse-engineered
// from src/ui/features/pretty-view/riffPcmDecode.ts to match its expected layout
export function buildRiffHeader({
  channels,           // 1 for Polly PCM
  sampleRate,         // 16000 for Polly PCM at 16kHz
  bitDepth,           // 16 for Polly PCM (signed 16-bit LE)
  dataSize = 0xFFFFFFFF,  // "unknown/streaming" — sentinel used by many streamers;
                          // riffPcmDecode.ts ignores dataSize for chunked-stream input.
}: {
  channels: number;
  sampleRate: number;
  bitDepth: number;
  dataSize?: number;
}): Buffer {
  const buf = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(dataSize + 36, 4);        // ChunkSize = data + 36
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);                  // Subchunk1Size for PCM
  buf.writeUInt16LE(1, 20);                   // AudioFormat = 1 (PCM)
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitDepth, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}
```

### Pattern 5: WebM → Ogg-Opus transcode via ffmpeg spawn

```typescript
// Source: ffmpeg CLI documentation + Node child_process pattern
// Recommend Ogg-Opus over FLAC: Opus is what MediaRecorder produced
// (audio already in Opus codec) — remuxing WebM→Ogg-Opus copies the codec
// with `-c:a copy`, avoiding a re-encode. Much faster than transcode to FLAC.
import { spawn } from "node:child_process";

export async function webmToOggOpus(webmBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-i", "pipe:0",         // input from stdin
      "-c:a", "copy",         // copy codec (no re-encode)
      "-f", "ogg",            // output container
      "pipe:1",               // output to stdout
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => errChunks.push(c));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString()}`));
    });

    ff.stdin.write(webmBuffer);
    ff.stdin.end();
  });
}
```

Reject if the remux-to-Ogg-Opus fails (Chrome sometimes produces Opus with `channels=2`; Transcribe expects mono when using Opus at 16kHz — verify with a WebM sample from `samples/clips/`). Fallback: transcode to FLAC at 16kHz mono (`-ar 16000 -ac 1 -f flac`). The exploration `transcribe-flac.py` already validated FLAC works.

### Pattern 6: Voice-value migration script (one-shot)

```typescript
// Source: informed by scripts/migrate-substrate-credentials.ts pattern in the codebase
// Runs once at deploy time; idempotent (no-op on subsequent runs)
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const OLD_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/;
const POLLY_VOICES = new Set([
  "Danielle", "Joanna", "Ruth", "Salli", "Matthew", "Stephen", "Tiffany",
]);

async function migrateFrontmatterFile(filePath: string): Promise<{changed: boolean}> {
  const content = await fs.readFile(filePath, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { changed: false };
  const fmText = fmMatch[1];
  const voiceMatch = fmText.match(/^voice:\s*(.+)$/m);
  if (!voiceMatch) return { changed: false };
  const currentVoice = voiceMatch[1].trim().replace(/^["']|["']$/g, "");
  // Skip if already conforms to new whitelist (idempotent)
  if (POLLY_VOICES.has(currentVoice)) return { changed: false };
  // Skip if not the old regex shape (avoid clobbering unrelated values)
  if (!OLD_VOICE_RE.test(currentVoice)) return { changed: false };
  // Hard reset: remove the voice line entirely
  const newFm = fmText.replace(/^voice:\s*.+\n?/m, "");
  const newContent = content.replace(fmMatch[0], `---\n${newFm}\n---`);
  await fs.writeFile(filePath, newContent, "utf8");
  return { changed: true };
}

async function walkAndMigrate(root: string): Promise<{scanned: number; changed: number}> {
  let scanned = 0, changed = 0;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subdir = path.join(root, entry.name);
    const mdPath = path.join(subdir, `${entry.name}.md`);
    if (!(await fs.stat(mdPath).catch(() => null))) continue;
    scanned++;
    const { changed: didChange } = await migrateFrontmatterFile(mdPath);
    if (didChange) changed++;
  }
  return { scanned, changed };
}

// Entry point
const identitiesRoot = path.join(os.homedir(), ".claude", "identities");
const rolesRoot = path.join(os.homedir(), ".claude", "roles");
const idsResult = await walkAndMigrate(identitiesRoot);
const rolesResult = await walkAndMigrate(rolesRoot);
console.log(`identities: scanned=${idsResult.scanned} cleared=${idsResult.changed}`);
console.log(`roles: scanned=${rolesResult.scanned} cleared=${rolesResult.changed}`);
```

**Trigger (planner picks — three options):**
1. **`docker exec` step in the deploy doc.** Cleanest — Ashley/Stacy each run one command post-`docker-compose up`. Operator-visible, easy to re-run if it errors.
2. **Startup one-shot in `starter.ts`.** Runs every restart. Made idempotent by the "skip if already conforms" guard. Zero operator action — Ashley's preference from Phase 86 was ops-invisible where possible.
3. **Distributor task in `substrate/`.** Overkill for a one-shot; distributor pattern is for continuous rollout.

Recommendation: **option 2 (startup one-shot)**. Idempotent + zero-touch. Ship-day migration completes on first restart post-deploy; every subsequent restart finds nothing to change and exits in <50ms.

### Anti-Patterns to Avoid

- **Rolling a custom RIFF parser on the client.** `webAudioStreamPlayer.ts` already has `riffPcmDecode.ts`; use it. Reshape the backend to emit valid RIFF+PCM, not the other way around.
- **Rolling a WebM demuxer in pure Node.** No mature library exists. Use ffmpeg — it's mature, permissively licensed, and 30MB in the container is negligible next to node_modules.
- **Using SSML `<mark>` tags to detect chunk boundaries.** Overengineered — sentence splitting is a solved problem and doesn't need SSML round-trip. Keep the text side plain.
- **Trying to reuse the existing `getVoices()` Chatterbox proxy shape by returning `{display_name, filename}` where filename is `.wav`.** The filename shape ties to the old regex. Return `{display_name, voiceId}` and update `VoicePicker.tsx` to consume the new field names. Small surface, clean rename.
- **Long-running Polly calls in `handleSpeak` (non-stream).** The existing `handleSpeak` uses 300s timeout; Polly generative is fast (~200-400ms first byte) so 30s is plenty. Match the timeout to reality; don't preserve the Chatterbox-tuned 300s just because it existed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio format transcoding | Custom WebM demuxer + Opus repacker | `ffmpeg` via `spawn` | Container/codec edge cases (multi-track, corrupted headers, sample-rate mismatches). ffmpeg has 20+ years of hardening. |
| Sentence tokenization | Regex-only splitter with no abbreviation handling | Small regex + curated abbreviation Set (Pattern 3 above) OR the `sbd` npm package if the abbrev list grows | Regex-only mishandles "Dr. Smith went home." → 2 sentences (wrong). |
| AWS credential resolution | Reading `~/.aws/credentials` or env vars manually | `@aws-sdk/credential-provider-node` (bundled with client packages) | IMDS + fallback + refresh-on-expiry is thousands of lines of edge-case code. SDK handles it. |
| RIFF/WAV header parsing on client | Custom parser | Existing `riffPcmDecode.ts` (Phase 19) | Already ships, already tested. Backend synthesizes 44-byte RIFF headers to feed it. |
| Async iteration over HTTP/2 event stream | Manual event listener wiring | SDK's `for await (const event of response.TranscriptResultStream)` | SDK handles backpressure, event decoding, and connection lifecycle. |
| Cross-message singleton player | Custom queue | Existing module-level `currentPlayer` singleton in `webAudioStreamPlayer.ts` consumer | Already implements cross-message single-speaker interrupt per D-11. |
| YAML frontmatter parsing/editing in migration | Full YAML parser round-trip | Line-based regex replacement (`voice:` line) — Pattern 6 above | Preserves formatting (whitespace, comments) that yaml round-trip would normalize. |

**Key insight:** The heavy lift is entirely on the backend adapters. The frontend and the client audio player mostly do NOT change. Discipline: resist the urge to "clean up" the player while touching this — it's provider-agnostic today and needs to stay that way for the client-contract-invariant to hold.

## Runtime State Inventory

Rename/refactor phase (voice-value regex change + Chatterbox integration deletion). All five categories reviewed:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) Every existing identity file at `~/.claude/identities/*/*.md` with `voice: <Name>.wav` in YAML frontmatter. (2) Every role file at `~/.claude/roles/*/*.md` with `voice:` in YAML frontmatter (Phase 86 introduced this at role level). (3) No database rows carry the voice value — verified: identity voice is on-disk frontmatter, not in SQLite. | Migration script (Pattern 6) clears matching frontmatter values. Both trees walked. |
| Live service config | `docker/nginx.conf` / `nginx-https.conf` reverse-proxies `/voice/*` to the backend — path shape unchanged, no update needed. tg-bridge reads `STT_URL` from `/state/config.env` written by `bridge-config-writer.ts` — will break when `media-endpoints.ts` deletes (import failure). See § Voice-endpoint config surface after deletion below. | Update `bridge-config-writer.ts` to either (a) stop writing `STT_URL` to `/state/config.env` (bridge starts respecting policy-attached AWS for voice notes, requires bridge-side rework OUT OF SCOPE), or (b) keep writing a stub that the bridge treats as "unused". Ashley's Phase 79 D-03 said "must be shared source of truth" — but the shared source in Phase 98 is "not applicable, bridge does its own thing." Planner: recommend deleting `STT_URL` from `/state/config.env` and removing the bridge's `tg_voice_to_mx` STT call OR routing it through Skynet's `/voice/transcribe` endpoint. NEEDS ASHLEY DECISION. |
| OS-registered state | Nothing. Backend runs in docker container; no systemd/launchd/Task-Scheduler registrations reference Chatterbox or voice endpoints. | None. |
| Secrets/env vars | `STT_RECORDINGS_DIR` env var (in `voice.ts:82`) — preserved unchanged, still governs disk-bank location. No AWS-specific env vars needed (IMDS handles credentials). Region hardcoded in code (`us-east-1`), acceptable per CONTEXT ("Region: any; sample uses us-east-1"). | None. Optionally add `AWS_REGION` env var if operators want to override without code edit — cheap, adds one env-var read. |
| Build artifacts / installed packages | (1) `@aws-sdk/*` packages need to be installed via `npm install` — will land in `package-lock.json`. (2) `ffmpeg` apt package needs to be in `docker/Dockerfile` Stage 5. Without it, the built image will NOT have ffmpeg and voice-in will fail with `ffmpeg: not found`. (3) Test files that mocked `fetch` for Chatterbox need rewriting to mock AWS SDK clients — this is code changes, not artifact changes. | Add packages via `npm install`, add `ffmpeg` to Dockerfile apt line. `npm install` regenerates `package-lock.json`. |

**Canonical question answer:** After every file in the repo is updated — (a) every identity/role file's `voice:` field will point at a Chatterbox voice that no longer exists (`voice: Elena.wav` on disk); (b) the tg-bridge Docker service still has `/state/config.env` with a `STT_URL=http://100.80.122.111:8000/...` written by Skynet's boot-time writer, and its `tg_voice_to_mx` shell function still tries to POST voice-notes to that URL. Both are runtime-state gaps a grep of the repo would NOT catch.

## Common Pitfalls

### Pitfall 1: Assuming Transcribe accepts WebM/Opus natively

**What goes wrong:** MediaRecorder produces `audio/webm;codecs=opus`. You pass it to Transcribe streaming with `MediaEncoding: "ogg-opus"` — Transcribe rejects with `BadRequestException: MediaEncoding must match audio format`.

**Why it happens:** WebM and Ogg-Opus share the Opus codec but use different containers. Transcribe streaming's supported list is strictly [FLAC, Ogg Opus, PCM] — no WebM.

**How to avoid:** Backend transcodes/remuxes before pushing to Transcribe. Recommend Ogg-Opus (remux, no re-encode) via ffmpeg. Fallback to FLAC if Ogg-Opus remux flakes on Chrome's WebM output.

**Warning signs:** `BadRequestException` on first byte push; empty transcripts on all clips.

**Verified:** AWS Transcribe streaming media formats table (see Sources).

### Pitfall 2: AWS SDK v3 default credential chain missing IMDS

**What goes wrong:** You use a low-level `@smithy/*` client and instantiate it with `defaultProvider()` from `@aws-sdk/credential-provider-*` (single). It doesn't include IMDS. On EC2, backend gets `CredentialsProviderError: Could not load credentials from any providers`.

**Why it happens:** AWS SDK v3 splits the credential chain into per-source packages. The composite chain (`@aws-sdk/credential-provider-node`) DOES include IMDS. Individual providers may not.

**How to avoid:** DO NOT pass a `credentials` field to `new PollyClient({})`. Let the SDK use its default — because `@aws-sdk/client-polly` internally uses `@aws-sdk/credential-provider-node`, which includes IMDS.

**Warning signs:** `CredentialsProviderError` at first `.send()`. Test on an EC2 instance, not on a laptop — laptop dev falls back to `~/.aws/credentials` which masks the issue.

**Verified:** `@aws-sdk/client-polly` dependency listing shows `@aws-sdk/credential-provider-node: ^3.972.83` (verified 2026-09-10 via `npm view @aws-sdk/client-polly dependencies`).

### Pitfall 3: Streaming Transcribe partial vs final results

**What goes wrong:** Reader accumulates every `Transcript.Results[].Alternatives[0].Transcript` and gets a hallucinated repeated text (Transcribe emits progressively-longer partials as it refines).

**Why it happens:** By default, Transcribe emits both partial results (as it hears more audio) AND final results (when it commits to a segment). Partials are marked `IsPartial: true`. If you accumulate everything, you get "hello", "hello there", "hello there world", "hello there world done" — concatenated it's junk.

**How to avoid:** Filter by `result.IsPartial === false` before accumulating (Pattern 2 above does this).

**Warning signs:** Transcript is 3–10× longer than expected; contains repeated substrings.

**Verified:** AWS Transcribe streaming response event model (see Sources).

### Pitfall 4: Polly generative rejects text that neural accepts

**What goes wrong:** You test locally with a voice-A + `Engine: neural` and it works. In prod with `Engine: generative`, you get `EngineNotSupportedException` because the specific voice isn't generative-supported.

**Why it happens:** Not every voice supports every engine. `Salli` is generative-supported per the 2026-03 expansion; a voice not on the generative list will 400.

**How to avoid:** The 7-voice whitelist (Danielle, Joanna, Ruth, Salli, Matthew, Stephen, Tiffany) is ONLY generative-supported en-US voices — enforce via validator. Server-side check that `voiceId in POLLY_VOICES` before Polly call.

**Warning signs:** `EngineNotSupportedException` in Polly response.

**Verified:** AWS Polly available voices list + 2026-03 generative expansion announcement (see Sources).

### Pitfall 5: Chunk-and-stitch produces audible gaps between chunks

**What goes wrong:** Long message splits into N=3 chunks. Each Polly call takes 200-400ms to first byte. Client hears chunk 1 finish, pauses ~250ms, hears chunk 2 finish, pauses ~250ms, hears chunk 3. Ashley perceives it as "the voice stopped mid-thought."

**Why it happens:** Sequential firing. Chunk 2's Polly call doesn't start until chunk 1's stream drains — but the client-side playback is scheduled based on `nextStartTime`, so the gap on the wire becomes a gap in playback.

**How to avoid:** Pre-fetch. When you start piping chunk N to the client, IMMEDIATELY fire chunk N+1's Polly call in parallel. When chunk N's `Readable` finishes (`end` event), chunk N+1's Polly response should already be in-flight and its bytes ready to pipe. Cap parallelism at 2 (chunk N + prefetch N+1) — no more, or long messages fan out unbounded.

**Warning signs:** UAT with a 5000-char message: audible gaps at chunk boundaries.

### Pitfall 6: STT disk-bank saves post-transcode bytes, not original recording

**What goes wrong:** You put the disk-bank write AFTER the ffmpeg transcode step. Ashley's post-hoc reference folder fills with `.ogg` files instead of `.webm` files. Confusing for her, and if a transcode fails the file is missing entirely.

**Why it happens:** Refactoring the STT handler shuffled the order.

**How to avoid:** Keep the disk-bank write at line 87-90 of `voice.ts` — BEFORE any transcode. The write uses `file.buffer` which is the raw multipart bytes.

**Warning signs:** Ashley opens `/opt/skynet/stt-recordings/` and finds `.ogg` files instead of the `.webm` she recorded.

**Verified:** Current implementation at `voice.ts:76-90` preserves this ordering.

### Pitfall 7: ffmpeg not in the docker image at deploy time

**What goes wrong:** Code ships, deploy runs `docker-compose build && up`. Backend starts. First voice recording upload → `handleTranscribe` → `spawn("ffmpeg", ...)` → `ENOENT: ffmpeg not found`. Feature dark for both t1000 and T800.

**Why it happens:** `docker/Dockerfile` Stage 5 doesn't include ffmpeg (verified 2026-09-10). The plan MUST include a task that adds it. Missing this = ship-blocker.

**How to avoid:** Add `ffmpeg` to the apt-get install line in Stage 5. Verify locally with `docker build && docker run --rm skynet:dev ffmpeg -version`.

**Warning signs:** `ENOENT: ffmpeg not found` on first voice-in in the docker container. Not caught by unit tests (they mock the spawn) — needs an integration test.

### Pitfall 8: tg-bridge's STT_URL still points at Chatterbox after Skynet deploys

**What goes wrong:** Skynet deploys, `media-endpoints.ts` deletes, `bridge-config-writer.ts` fails to import → bridge-config write skipped → bridge starts with the pre-existing `/state/config.env` still containing `STT_URL=http://100.80.122.111:8000/...` → Telegram voice notes still POST to Chatterbox, which is dead. tg-bridge voice-note transcription silently breaks.

**Why it happens:** tg-bridge is a separate Docker service; it has its own transcode-and-transcribe path in `bridge.sh:225` that curl-POSTs to `$STT_URL`. That path is completely independent of Skynet's `handleTranscribe`.

**How to avoid:** Explicit planner decision on tg-bridge future. Two viable options: (a) delete `tg_voice_to_mx` STT block entirely — bridge sends `"🎤 [voice message]"` placeholder; humans transcribe manually. Simple, small user impact. (b) Route bridge's voice-note transcription through Skynet's `/voice/transcribe` endpoint (bridge → Skynet backend → AWS Transcribe). More work, preserves current UX. NEEDS ASHLEY DECISION at plan-time.

**Warning signs:** Post-ship, Telegram voice notes stop showing transcripts.

## Code Examples

### Example 1: Backend Polly voice-catalog constant

```typescript
// src/backend/voice/polly-voice-catalog.ts
// Fixed catalog — no runtime AWS call, no runtime fetch.
export interface PollyVoice {
  voiceId: string;         // Polly's own VoiceId enum member
  displayName: string;     // What the picker shows
  gender: "female" | "male";
}

export const POLLY_VOICES: readonly PollyVoice[] = [
  { voiceId: "Danielle", displayName: "Danielle", gender: "female" },
  { voiceId: "Joanna",   displayName: "Joanna",   gender: "female" },
  { voiceId: "Ruth",     displayName: "Ruth",     gender: "female" },
  { voiceId: "Salli",    displayName: "Salli",    gender: "female" },
  { voiceId: "Tiffany",  displayName: "Tiffany",  gender: "female" },
  { voiceId: "Matthew",  displayName: "Matthew",  gender: "male"   },
  { voiceId: "Stephen",  displayName: "Stephen",  gender: "male"   },
] as const;

export const POLLY_VOICE_IDS: Set<string> = new Set(
  POLLY_VOICES.map(v => v.voiceId),
);

export function isValidPollyVoice(id: unknown): id is string {
  return typeof id === "string" && POLLY_VOICE_IDS.has(id);
}
```

### Example 2: Rewritten handleTranscribe

```typescript
// src/backend/database/routes/voice.ts — handleTranscribe (new)
// Source: adapted from current implementation + Pattern 2 above
import { transcribeBuffer } from "../../voice/transcribe-adapter.js";
import { webmToOggOpus } from "../../voice/audio-transcode.js";

export async function handleTranscribe(req: Request, res: Response): Promise<Response> {
  if (!req.file) return res.status(400).json({ error: "missing file field" });

  const file = req.file;
  const ext = extFromMimetype(file.mimetype);

  // Preserve disk-bank (BEFORE transcode — write raw bytes)
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.userId;
  const dir = process.env.STT_RECORDINGS_DIR ?? "/app/stt-recordings";
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const filename = `${timestamp}-${userId ?? "anon"}-${file.size}.${ext}`;
  const fullPath = path.join(dir, filename);
  void fs.promises.mkdir(dir, { recursive: true })
    .then(() => fs.promises.writeFile(fullPath, file.buffer))
    .catch((err) => databaseLogger.warn(/* ... */));

  databaseLogger.info(`[voice-server] transcribe-req byteSize=${file.size} mimetype=${file.mimetype}`);

  try {
    // Transcode webm → ogg-opus (remux, no re-encode)
    const oggBuf = ext === "webm" ? await webmToOggOpus(file.buffer) : file.buffer;

    // Transcribe streaming
    const transcript = await transcribeBuffer(oggBuf, "ogg-opus", 48000);

    databaseLogger.info(`[voice-server] transcribe-ok textLen=${transcript.length}`);

    // Preserve slash-command transform (unchanged)
    const hostIdRaw = typeof req.body?.hostId === "string" ? req.body.hostId : undefined;
    const hostId = hostIdRaw !== undefined ? parseInt(hostIdRaw, 10) : NaN;
    if (transcript.length > 0 && Number.isFinite(hostId) && hostId > 0 && WAKE_WORD_REGEX.test(transcript)) {
      try {
        const catalog = await fetchSkillCatalog(hostId, userId, DEFAULT_SKILL_CATALOG_TIMEOUT_MS);
        const result = applyServerSlashTransform(transcript, catalog);
        if (result.matched) {
          return res.status(200).json({ text: result.transformed });
        }
      } catch (err) { /* fail-open */ }
    }

    return res.status(200).json({ text: transcript });
  } catch (err) {
    // AccessDenied → policy-detached → structured error (feature dark, no spam)
    if (isAwsAccessDenied(err)) {
      databaseLogger.info(`[voice-server] transcribe-access-denied — policy not attached`);
      return res.status(503).json({ error: "voice STT unavailable", status: 503 });
    }
    databaseLogger.error(`[voice-server] transcribe-error`, err);
    return res.status(502).json({ error: "STT error", status: 502 });
  }
}
```

### Example 3: Mocking AWS SDK v3 clients in vitest

```typescript
// Pattern: vi.mock the AWS SDK modules; assert on the command's input.
// Alternative: aws-sdk-client-mock library exists but adds a dependency;
// vi.mock is sufficient for the shape of tests here.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aws-sdk/client-polly", () => ({
  PollyClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      AudioStream: Readable.from([Buffer.from([0, 1, 2, 3])]),
    }),
  })),
  SynthesizeSpeechCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

// Test asserts the command was constructed with correct params
```

### Example 4: Preserved slashCommandTransform integration

```typescript
// slashCommandTransform.ts stays byte-identical.
// Only the call site in handleTranscribe changes — same function, same signature,
// invoked on the AWS-provided transcript instead of the Chatterbox-provided one.
// See Example 2 above for the call site.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| aws-sdk v2 monolith | @aws-sdk/client-* modular v3 | Dec 2020 (v3.0 GA); v2 in maintenance mode since 2023 | Bundle size, tree-shaking, per-service versioning |
| AWS SDK v3 all-inclusive default credential chain | Split credential providers per source | 2020 v3.0 | Must use `@aws-sdk/credential-provider-node` for IMDS (bundled with `client-polly` — no explicit install needed) |
| Polly neural engine | Polly generative engine (transformer-based) | May 2024 (initial); March 2026 expansion (10 new voices, bidirectional streaming) | Higher quality, higher cost ($30 vs $19.20 per 1M chars), same API |
| Polly 6000-char / 3000-billed ceiling | Same (unchanged since launch) | — | Chunk-and-stitch is a permanent requirement for long text |
| Transcribe batch (S3-based, async) | Transcribe streaming (HTTP/2 event streams) | 2019 (streaming GA) | Real-time; matches Chatterbox's UX. Only option since CONTEXT locks "no S3 hop." |
| Amazon Nova Sonic (bidirectional voice) | Separate product from Polly + Transcribe | 2025 | Explicitly deferred per CONTEXT § Deferred Ideas |

**Deprecated/outdated:**
- aws-sdk v2: still works but no new features; migration path is per-service to v3 clients.
- Polly standard engine: still available; superseded by neural for quality, generative for top-tier.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ffmpeg remux `webm → ogg-opus` with `-c:a copy` works on browser MediaRecorder output without re-encode | Pattern 5, Pitfall 1 | If Chrome/Firefox produce Opus with 2 channels at 48kHz and Transcribe streaming rejects, fallback to FLAC transcode (extra CPU, still works). Small blast radius — a plan-time test with a `samples/clips/*.webm` file catches it. |
| A2 | Polly's `Engine: "generative"` first-byte latency ~200-400ms | Pitfall 5, State of the Art | If actual is 800ms+, chunk-and-stitch pre-fetch (Pitfall 5 mitigation) becomes MORE important — same code, same shape, just more critical. |
| A3 | webAudioStreamPlayer.ts accepts a stream where the RIFF header appears in the first chunk followed by pure PCM in subsequent chunks | Pattern 4, Pattern 1 | Reader of the player code (lines 236-241) shows it accumulates until the 44-byte header parses, then treats remainder as PCM — supports this shape. Verified. Downgrade risk: player expects header IN the first chunk; if backend flushes 0 bytes before header, undefined behavior. Test with a mock. |
| A4 | Startup one-shot migration (option 2 in Pattern 6) is acceptable to Ashley | Pattern 6, § Deploy | If Ashley prefers `docker exec` manual step, planner switches to option 1 — script exists either way, just wired to a different trigger. |
| A5 | tg-bridge's `tg_voice_to_mx` STT path is safely deletable or replaceable — Ashley hasn't sacred-cow'd it | Pitfall 8, § Voice-endpoint config surface | If it must be preserved, plan gains one task (route bridge STT through Skynet's endpoint) but no architectural change. NEEDS ASHLEY DECISION at plan-time. |
| A6 | AWS SDK v3 packages will still be at `~3.1129.x` at ship-time (they publish weekly; version at ship may be `3.1150.x` or later) | Standard Stack, versions | Pin to `^3.1129.0` for install; version bump between plan and ship is normal and non-breaking (v3 line follows semver). |
| A7 | Ashley's Aither AWS account (via `termix-ssm-role`) and Stacy's T800 AWS account both support generative Polly voices in whatever region they attach the policy to | § Deploy | Generative Polly not available in all regions. If Stacy's default region doesn't have it, deploy doc must specify a region that does (e.g., `us-east-1`). Verified: Polly generative widely available in US East regions per AWS 2026-03 expansion. |
| A8 | The `docker/Dockerfile` change (add `ffmpeg` to apt line) doesn't blow past image-size ceilings Ashley cares about | Pitfall 7, § Standard Stack | ffmpeg is ~30MB. Skynet image is already several hundred MB. Negligible in practice. |
| A9 | Deleting `media-endpoints.ts` entirely (vs reshaping to a stub) doesn't break other consumers | § Voice-endpoint config surface after deletion | Grep confirms only `voice.ts` + `bridge-config-writer.ts` import from it. Both must be updated in the same commit. |

## Voice-endpoint config surface after deletion

Per grep at research time:

```
src/backend/database/routes/voice.ts:14
src/backend/telegram/bridge-config-writer.ts:35
```

Two consumers. `voice.ts` gets rewritten to import from `polly-voice-catalog.ts` and no longer needs any endpoint constant. `bridge-config-writer.ts` uses `STT_URL` to write to `/state/config.env` for the tg-bridge Docker service.

**Options for `bridge-config-writer.ts`:**
1. **Delete `STT_URL` from `/state/config.env` writes.** Bridge service reads a missing var — its `bridge.sh:225` curl call fails, voice-notes fall through to the empty-transcript branch (`"🎤 [voice message came back empty]"`). Small UX regression for Telegram voice notes.
2. **Point tg-bridge at Skynet's `/voice/transcribe` endpoint.** Requires bridge to know a Skynet URL, requires Skynet to accept unauth'd calls from bridge OR the bridge to have a service-account JWT. Broader surface.
3. **Delete `tg_voice_to_mx`'s STT block entirely from `bridge.sh`.** Send `"🎤 [voice message]"` placeholder, human transcribes manually if they care. Simplest, ships cleanest.

**Recommendation:** Option 3 — cleanest, matches the "clean cutover" spirit of the phase. Adds one task: edit `bridge.sh:217-235` to drop the STT curl, keep the placeholder message. Ashley confirms.

**Deleting `media-endpoints.ts` entirely:** viable. If deleted, `getMatrixHomeserverBase()` (the non-STT export) must move — best to `src/backend/matrix/matrix-config.ts` or similar. Small refactor.

## Test Strategy for AWS-touching code

### Unit tests (mocked AWS)
- `polly-adapter.test.ts` — `vi.mock("@aws-sdk/client-polly")`, assert SynthesizeSpeechCommand constructed with expected `{Engine, OutputFormat, SampleRate, VoiceId, Text}`. Assert AudioStream returned matches mock.
- `transcribe-adapter.test.ts` — `vi.mock("@aws-sdk/client-transcribe-streaming")`, assert StartStreamTranscriptionCommand constructed correctly. Assert async iterable of `{AudioEvent}` is provided. Assert transcript concatenation filters `IsPartial: false`.
- `audio-transcode.test.ts` — spawn ffmpeg on a real sample from `samples/clips/*.webm` (integration-lite; ffmpeg is a system dep). Assert output is Ogg-container bytes.
- `chunk-and-stitch.test.ts` — pure functions, truth-table tested: N=1 case, N=2 case, single-sentence-exceeds-ceiling case, abbreviations preserved case, empty-input case.
- `polly-voice-catalog.test.ts` — `isValidPollyVoice` returns true for all 7 voices, false for `"Elena.wav"`, false for arbitrary strings.
- `voice.test.ts` — reshape existing to mock AWS SDK instead of `fetch`. Preserve slashCommandTransform integration tests. Add AccessDenied → 503 path test.

### Integration tests (real AWS, budgeted)
- One "smoke" test per adapter that hits real AWS with a fixed small input:
  - Polly: `synthesizeToPcm("Hello.", "Joanna")` — costs ~$0.0002.
  - Transcribe: transcribe a 2-second WAV — costs ~$0.001.
- Gate behind `AWS_INTEGRATION_TESTS=1` env var so CI doesn't run them.
- Total per full integration run: <$0.01. Ashley's build-phase budget ($20-30) tolerates hundreds of runs.

### Playwright smoke
- `voice-picker.spec.ts` — mount identity modal, assert exactly 7 voices in dropdown, assert selecting one persists.

### Test patterns to reuse
- `src/backend/database/routes/voice.test.ts` current shape is the reference. Rewrite the mocks (from `vi.stubGlobal("fetch", ...)` to `vi.mock("@aws-sdk/client-polly", ...)`) but keep the handler-level test structure.

### Existing test discipline
- Scoped tests during dev: `npx vitest run --related <changed-files>`.
- Full suite ONLY as first step of ship motion (per CONTEXT § Specifics + fleet rule).
- AWS-touching integration tests skip by default (env-var opt-in).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | 22 (per Dockerfile `FROM node:22-slim`) | — |
| npm | Package install | ✓ | 11 (per package.json engines) | — |
| ffmpeg | Backend WebM→Ogg transcode | ✗ (NOT in docker image) | — | **BLOCKING** — must add to Dockerfile apt line |
| AWS SDK v3 | Voice-in + voice-out | ✗ (not yet installed) | 3.1129.0 target | — |
| AWS Polly service | Voice-out | ✓ (per exploration 2026-09-09) | — | — |
| AWS Transcribe streaming | Voice-in | ✓ (per exploration 2026-09-09) | — | — |
| IMDS credentials (EC2 instance role) | AWS SDK auth | ✓ (t1000: `termix-ssm-role/PollyTranscribeExploratory`) | — | Static keys would work but violate CONTEXT lock |
| `~/.claude/identities/` folder on host | Migration script | ✓ (existing) | — | Script tolerates missing folder gracefully |
| `~/.claude/roles/` folder on host | Migration script | ✓ (existing per Phase 86) | — | Script tolerates missing folder gracefully |
| `/app/stt-recordings/` dir | STT disk-bank preserve | ✓ (created by mkdir in current code) | — | — |
| vitest + playwright | Testing | ✓ (existing test infra) | vitest 3.x, playwright 1.63 | — |

**Missing dependencies with no fallback:**
- `ffmpeg` in the docker image — **hard blocker** at ship time. Must add to `docker/Dockerfile` Stage 5 apt-get line. Verified missing 2026-09-10.
- `@aws-sdk/client-polly` and `@aws-sdk/client-transcribe-streaming` — obvious install task in the plan.

**Missing dependencies with fallback:**
- ffmpeg not on host machine (for dev outside docker) — dev-time only. Local dev with `npm run dev` currently doesn't exercise voice paths without a full backend run. Non-blocking.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.x (from package.json — `"vitest": "^3.x.x"` per devDependencies scan) + playwright 1.63 |
| Config file | `vitest.config.ts` (backend + frontend projects), `playwright.config.ts` |
| Quick run command | `npx vitest run --related <changed-files>` (fleet rule) |
| Full suite command | `npx vitest run` (ship-motion only) + `npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P98-STT-01 | Transcribe streaming returns transcript for real Ashley voice clip | integration (real AWS, opt-in) | `AWS_INTEGRATION_TESTS=1 npx vitest run src/backend/voice/transcribe-adapter.integration.test.ts` | ❌ Wave 0 |
| P98-STT-02 | Client contract: POST /voice/transcribe with multipart accepted | unit (mocked) | `npx vitest run src/backend/database/routes/voice.test.ts` | ✅ (exists — reshape mocks) |
| P98-STT-03 | Slash-command transform runs on AWS transcript | unit (existing test extended) | `npx vitest run src/backend/database/routes/voice.test.ts -t slash` | ✅ (exists) |
| P98-STT-04 | Disk-bank preserves raw WebM bytes | unit | `npx vitest run src/backend/database/routes/voice.test.ts -t bank` | ✅ (exists — verify still passes) |
| P98-TTS-01 | Polly SynthesizeSpeech returns audio bytes for generative voice | integration (real AWS, opt-in) | `AWS_INTEGRATION_TESTS=1 npx vitest run src/backend/voice/polly-adapter.integration.test.ts` | ❌ Wave 0 |
| P98-TTS-02 | Chunk-and-stitch pure function correctness | unit | `npx vitest run src/backend/voice/chunk-and-stitch.test.ts` | ❌ Wave 0 |
| P98-TTS-03 | TTFB timing (empirical — measured in UAT) | manual | UAT with Ashley on long message | manual-only |
| P98-TTS-04 | Client player unchanged behavior (PCM+RIFF still decodes) | unit | `npx vitest run src/ui/features/pretty-view/webAudioStreamPlayer.test.ts` (verify still passes) | ✅ (exists) |
| P98-CAT-01 | 7-voice catalog rendered in picker | e2e | `npx playwright test tests/e2e/voice-picker.spec.ts` | ❌ Wave 0 |
| P98-MIG-01 | Migration walks identities + roles, clears matching values | unit | `npx vitest run scripts/migrate-voice-values.test.ts` | ❌ Wave 0 |
| P98-MIG-02 | Validator whitelist rejects old-format `.wav` values | unit | `npx vitest run src/backend/database/routes/identities.test.ts -t voice-validator` | ⚠️ (identities.test.ts exists — add cases) |
| P98-OFF-01 | AccessDenied → 503 clean (no crash) | unit (mocked SDK throws AccessDenied) | `npx vitest run src/backend/database/routes/voice.test.ts -t access-denied` | ❌ Wave 0 |
| P98-DOC-01 | Doc exists at `docs/deploy/aws-voice-setup.md` and covers all bullets | manual review | plan-checker phase | manual-only |
| P98-KILL-01 | Grep shows no residual Chatterbox integration | script | `! grep -rn "100.80.122.111\|Chatterbox" src/ substrate/ && echo OK` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --related <changed-files>` (fleet standard)
- **Per wave merge:** `npx vitest run src/backend/voice/ src/backend/database/routes/voice.test.ts`
- **Phase gate:** Full suite green (`npx vitest run` + `npx playwright test`) + one integration run (`AWS_INTEGRATION_TESTS=1 ...`) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/backend/voice/polly-adapter.test.ts` — unit tests for Polly adapter, mocked SDK
- [ ] `src/backend/voice/transcribe-adapter.test.ts` — unit tests for Transcribe adapter, mocked SDK
- [ ] `src/backend/voice/chunk-and-stitch.test.ts` — pure function truth-table tests
- [ ] `src/backend/voice/audio-transcode.test.ts` — ffmpeg spawn integration (uses real ffmpeg + real sample from bounty)
- [ ] `src/backend/voice/polly-voice-catalog.test.ts` — voice list + isValidPollyVoice
- [ ] `src/backend/voice/polly-adapter.integration.test.ts` — real AWS Polly call, env-gated
- [ ] `src/backend/voice/transcribe-adapter.integration.test.ts` — real AWS Transcribe call, env-gated
- [ ] `scripts/migrate-voice-values.test.ts` — script correctness against fixture identity files
- [ ] `tests/e2e/voice-picker.spec.ts` — Playwright smoke test on voice-picker mount
- [ ] Test framework install: none needed (vitest + playwright already installed)
- [ ] Extend existing `src/backend/database/routes/voice.test.ts` to mock AWS SDK v3 clients instead of `fetch`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing JWT auth via `authenticateJWT` middleware on all `/voice/*` routes — preserved unchanged. |
| V3 Session Management | yes (indirect) | JWT session management preserved unchanged. |
| V4 Access Control | yes | AWS-side: IAM policy on instance role gates access to Polly/Transcribe. App-side: JWT gates access to /voice/*. Composite: user must be authed AND policy must be attached. |
| V5 Input Validation | yes | (1) Voice-value whitelist (7 IDs) — planner uses `POLLY_VOICE_IDS` Set. (2) Text length limits preserved (`SPEAK_TEXT_MAX = 25000`). (3) multer 25MB cap on upload preserved. (4) mimetype filter on upload retained. |
| V6 Cryptography | yes (transit only) | AWS SDK v3 handles TLS to Polly/Transcribe — never hand-roll. IMDS credentials pinned via `@aws-sdk/credential-provider-node` — never hand-roll. |
| V7 Error Handling & Logging | yes | AccessDenied → info-level log (not error — expected when policy detached). Non-AWS exceptions → error-level. No AWS body content in error responses (T-16-03 analog). |
| V8 Data Protection | partial | Voice recordings persisted to `/app/stt-recordings/` — inherit existing container FS permissions. Transcripts logged with length only (not content) per current pattern. |
| V9 Communication | yes | HTTPS to AWS endpoints (SDK default). `X-Accel-Buffering: no` preserved on streaming responses (nginx anti-accumulation, existing pattern). |

### Known Threat Patterns for AWS SDK integration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Text-based prompt injection into TTS (attacker crafts text that Polly reads with a jailbreak-shaped payload) | Tampering | Not applicable — Polly speaks text verbatim; no downstream LLM consumes the audio. Existing SPEAK_TEXT_MAX cap is sufficient. |
| Cost exhaustion via unbounded Polly calls | Denial of Service | (a) SPEAK_TEXT_MAX = 25000 caps single-call cost at ~$0.75 max per call. (b) JWT auth gate. (c) Ashley/Stacy monitor AWS billing per operator responsibility (CONTEXT: "operator controls the cost gate"). |
| Cost exhaustion via streaming Transcribe (unbounded audio push) | Denial of Service | multer 25MB cap on upload → ~25 minutes of audio maximum → ~$0.60 max per call. JWT auth gate. |
| SSRF via `endpoint` param on AWS SDK client | Server-Side Request Forgery | Don't accept endpoint from any input; hardcode `region: "us-east-1"` in client construction. |
| Credential leak via error responses | Information Disclosure | Wrap all AWS SDK calls; on error, return fixed `{error, status}` shape — never surface `err.message` from AWS (may include credential hints). |
| Log injection via voice text content | Log Injection | Log only lengths and voice IDs — never log message text content. Follows existing `voice.ts` log pattern. |
| Race condition on migration script (concurrent starts) | Tampering | Idempotent script (Pattern 6 skip-if-conforms guard). Concurrent starts safe: each does the same no-op. |

## Sources

### Primary (HIGH confidence)
- AWS docs: [SynthesizeSpeech API reference](https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html) — engine values, output formats, text length ceiling, response body shape
- AWS docs: [Amazon Transcribe streaming input formats](https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html) — supported/recommended encodings (FLAC, Ogg Opus, PCM — NOT WebM)
- AWS docs: [Amazon Polly generative voices](https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html) — voice list
- AWS docs: [Set credentials in Node.js v3 SDK](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html) — default provider chain + IMDS
- AWS blog: [4 new generative Polly voices (Oct 2024)](https://aws.amazon.com/about-aws/whats-new/2024/10/four-new-synthetic-generative-voices-amazon-polly) — Danielle, Ruth, Stephen, etc.
- AWS blog: [Polly expands generative TTS engine (March 2026)](https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-polly-expands-TTS-new-voices-and-bidirectional-streaming) — Tiffany added; 7-voice list confirmed
- npm: `@aws-sdk/client-polly@3.1129.0` — verified 2026-09-10 via `npm view`, published 2026-09-09
- npm: `@aws-sdk/client-transcribe-streaming@3.1129.0` — verified 2026-09-10 via `npm view`
- Codebase: `src/backend/database/routes/voice.ts` — current handler shape (Chatterbox-era)
- Codebase: `src/ui/features/pretty-view/webAudioStreamPlayer.ts` — client player, RIFF+PCM decoder
- Codebase: `src/backend/voice/slashCommandTransform.ts` — provider-agnostic slash transform
- Codebase: `docker/Dockerfile` — ffmpeg NOT present in Stage 5 apt install (verified)
- Bounty: `~/.claude/roles/box-maintainer/bounties/more-versatile-stt-tts-support/transcribe-flac.py` — Python reference for streaming shape
- Bounty: `samples/index.html`, `samples/clips/`, `samples/polly-outputs/`, `samples/transcribe-outputs/` — real validation artifacts

### Secondary (MEDIUM confidence)
- [npmjs.com/@aws-sdk/client-transcribe-streaming](https://www.npmjs.com/package/@aws-sdk/client-transcribe-streaming) — package README, async iterable AudioStream pattern
- [Amazon Polly pricing 2026 (costbench.com)](https://costbench.com/software/ai-voice-tools/amazon-polly/) — generative $30/1M chars vs neural $19.20/1M
- [AWS SDK v3 credential provider migration](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-credential-providers.html) — v3 default chain vs v2

### Tertiary (LOW confidence)
- [Medium article — Transcribe web app in JavaScript](https://medium.com/@jannden/create-an-amazon-transcribe-web-app-with-javascript-a56c14b87db2) — pattern reference, not authoritative

## Metadata

**Confidence breakdown:**
- Standard stack (AWS SDK v3): HIGH — verified versions via `npm view`, canonical AWS-authored packages
- Architecture (adapters + chunk-and-stitch): HIGH — mirrors the Python exploration script structure and CONTEXT lock
- Pitfalls (WebM, credential chain, chunk gaps): HIGH — verified via AWS docs and SDK source
- ffmpeg strategy: MEDIUM — recommendation is well-founded (no pure-Node alternative exists), but the specific WebM→Ogg-Opus remux command may need one round of ffmpeg-flag tuning on real Chrome/Firefox samples
- Migration script trigger: MEDIUM — three viable options; recommended "startup one-shot" is Claude's-discretion pick, Ashley may prefer explicit docker-exec instead
- Test cost budget: MEDIUM — extrapolated from exploration's $1.14 spend; integration tests are pennies each, easy to control

**Research date:** 2026-09-10
**Valid until:** 2026-10-10 (30 days — AWS SDK versions bump weekly but v3 line is semver-stable; Polly/Transcribe API is stable; only the specific version pin drifts)
