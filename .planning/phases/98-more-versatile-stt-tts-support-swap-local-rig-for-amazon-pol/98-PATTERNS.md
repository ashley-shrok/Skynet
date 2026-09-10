# Phase 98: More versatile STT/TTS support — Pattern Map

**Mapped:** 2026-09-10
**Files analyzed:** 13 new / 8 heavily-modified / 2 deletions / 1 doc
**Analogs found:** 21 / 22 (only the deploy-time markdown has no direct in-repo analog — closest is `substrate/services/tg-bridge/README.md` operator-flow style)

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/backend/voice/polly-adapter.ts` | service (external SDK wrapper) | streaming (SDK → Node Readable) | `src/backend/matrix/matrix-admin-client.ts` (external-service SDK wrapper) + `src/backend/database/routes/voice.ts:280` (streaming) | role-match |
| `src/backend/voice/transcribe-adapter.ts` | service (external SDK wrapper) | streaming (async-iterable bidirectional) | `src/backend/ssh/opkssh-auth.ts:339` (streaming subprocess with async lifecycle) | role-match |
| `src/backend/voice/audio-transcode.ts` | utility (subprocess wrapper) | transform (bytes-in → bytes-out) | `src/backend/ssh/opkssh-auth.ts:339` (spawn pattern) | role-match |
| `src/backend/voice/chunk-and-stitch.ts` | utility (pure text processing) | transform | `src/backend/voice/slashCommandTransform.ts` (pure kernel, exhaustively truth-table-testable) | exact |
| `src/backend/voice/polly-voice-catalog.ts` | config / static-const module | request-response (in-process) | `src/backend/distributor/catalog.ts` (`FLEET_SUBSTRATE_CATALOG: readonly CatalogEntry[]`) + `src/backend/relay-sessions/observation-loop.ts:60` (`BACKOFF_LADDER_MS: readonly number[]`) | exact |
| `src/backend/voice/riff-header-builder.ts` | utility (pure byte-buffer builder) | transform | `src/backend/voice/slashCommandTransform.ts` (pure, no I/O — testable in isolation) | role-match |
| `src/backend/voice/voice-migration.ts` (startup one-shot) | service (bootstrap script) | file-I/O (frontmatter walk + rewrite) | `src/backend/telegram/bridge-config-writer.ts:354` (`ensureBridgeConfigWritten` — startup one-shot, never throws, fire-and-forget from `starter.ts`) + `src/backend/claude-session/identity-artifact-reader.ts:2604` (`writeIdentityFile` tmp+rename LOCAL branch) | exact |
| `src/backend/database/routes/voice.ts` (REWRITTEN) | controller (route handlers) | request-response + streaming | itself pre-rewrite (preserve outer shape); handler bodies replaced with adapter calls | exact |
| `src/backend/telegram/bridge-config-writer.ts` (MODIFIED) | service (config file writer) | file-I/O (atomic tmp+rename) | itself — remove `STT_URL` from output; add Skynet base URL + service-auth token if planner picks route-through-Skynet | in-place |
| `substrate/services/tg-bridge/bridge.sh:225` (MODIFIED) | shell service (external HTTP client) | request-response | `bridge.sh:225` itself (curl+jq HTTP block) OR delete outright per RESEARCH § Pitfall 8 option 3 | in-place |
| `src/ui/features/pretty-view/pickers/VoicePicker.tsx` (MODIFIED) | component (picker with inlined const) | request-response → in-process | itself (drop `getVoices()` fetch, inline the 7-voice `POLLY_VOICES` array) | in-place |
| `src/ui/api/voice-api.ts` (MODIFIED) | api client | request-response | itself (drop `getVoices` export) | in-place |
| `src/backend/database/routes/identities.ts:51` (MODIFIED) | validator | validation | itself (swap `IDENTITY_VOICE_RE` regex for whitelist `Set<string>` check) | in-place |
| `src/backend/database/routes/identity-birth.ts:381` (MODIFIED) | controller (default voice) | validation | itself (update `DEFAULT_VOICE` const or fallback in `parsedVoice`) | in-place |
| `src/backend/database/routes/identity-clone.ts` (MODIFIED) | controller | validation | itself (voice value passthrough uses new whitelist) | in-place |
| `src/backend/config/media-endpoints.ts` (DELETE or reshape) | config | — | — (delete outright; `getMatrixHomeserverBase()` moves to `src/backend/matrix/`) | N/A |
| `src/backend/starter.ts:278` (MODIFIED) | bootstrap | fire-and-forget | itself (add `void import(".../voice-migration.js").then(m => m.ensureVoiceValuesMigrated()).catch(...)` sibling to the `ensureBridgeConfigWritten` block already at line 278) | exact |
| `docker/Dockerfile:67` (MODIFIED) | container build | build | itself (existing `apt-get install -y nginx gettext-base openssl ca-certificates gosu wget` line — add `ffmpeg`) | in-place |
| `docs/deploy/aws-voice-setup.md` (NEW) | operator doc | narrative | `substrate/services/tg-bridge/README.md` (numbered-list operator-flow style) + `TESTING.md` (short-form ops doc convention) | role-match |
| `src/backend/voice/*.test.ts` (multiple NEW) | test | — | `src/backend/database/routes/voice.test.ts` (function-level, no Express harness; vi.mock for external clients) | exact |
| `src/backend/voice/*.integration.test.ts` (2 NEW) | integration test | real-AWS | none in repo (env-gated pattern) — closest is `src/backend/claude-session/*.integration.test.ts` name convention | naming-only |
| `tests/e2e/voice-picker.spec.ts` (NEW) | e2e test | Playwright | any existing spec under `tests/e2e/` — smoke.spec.ts | role-match |

## Pattern Assignments

### `src/backend/voice/polly-adapter.ts` (service, streaming)

**Analog:** `src/backend/database/routes/voice.ts:280-383` (handleSpeakStream — for the Readable-pipe pattern) + AWS SDK v3 canonical pattern.

**Import + client-construction pattern** — this repo pattern for external clients is a single module-level singleton with no options. Mirror `getMatrixAdminCreds()` shape from `src/backend/matrix/matrix-admin-creds-store.ts` (dynamically imported lazily by other consumers, see `src/backend/config/media-endpoints.ts:52-57`):
```typescript
// polly-adapter.ts — module-level client, no per-call construction
import { PollyClient, SynthesizeSpeechCommand, type VoiceId }
  from "@aws-sdk/client-polly";
import { Readable } from "node:stream";
import { databaseLogger } from "../utils/logger.js";

const pollyClient = new PollyClient({ region: "us-east-1" });
// NO credentials arg — @aws-sdk/credential-provider-node default chain
// picks up IMDS on EC2 automatically. See RESEARCH § Pitfall 2.
```

**Streaming Readable-pipe pattern** — copy the `Readable.fromWeb(...).pipe(res)` shape from `voice.ts:359-360` (current handleSpeakStream) but source the Readable from the SDK response:
```typescript
// voice.ts:359-360 (current — pattern to preserve at call site):
const { Readable } = await import("node:stream");
Readable.fromWeb(response.body as ...).pipe(res);
```
Rewrite Polly adapter to return a Node Readable directly:
```typescript
export async function synthesizeToPcm(text: string, voiceId: string): Promise<Readable> {
  const cmd = new SynthesizeSpeechCommand({
    Text: text, Engine: "generative", OutputFormat: "pcm",
    SampleRate: "16000", VoiceId: voiceId as VoiceId,
  });
  const response = await pollyClient.send(cmd);
  if (!response.AudioStream) throw new Error("Polly returned no AudioStream");
  return response.AudioStream as Readable;
}
```

**Error / logging pattern** — copy the `voice.ts:190-201` structure verbatim: `databaseLogger.error(...)` with `{ operation: "voice_..." }` metadata block, discriminated on error type. Add an `isAwsAccessDenied(err)` guard (new — check `err.name === "AccessDeniedException"` or `err.$metadata?.httpStatusCode === 403`) so policy-detached failures log at `info` level (not `error`) per RESEARCH § V7.

**Pitfall specific to this file:**
- Do NOT pass `credentials:` to `new PollyClient(...)`. Passing anything explicit disables the IMDS-inclusive default chain and breaks prod (RESEARCH § Pitfall 2). Unit tests should verify construction is credential-arg-less.
- Backend static-const modules in this repo use `readonly` arrays with type annotations — see `src/backend/distributor/catalog.ts:98`. Adapter modules DO NOT need `as const`; the type comes from the SDK.

---

### `src/backend/voice/transcribe-adapter.ts` (service, streaming — async iterable)

**Analog:** No exact match — closest is the exploration Python reference at `~/.claude/roles/box-maintainer/bounties/more-versatile-stt-tts-support/transcribe-flac.py` and the AWS SDK v3 canonical pattern documented in RESEARCH § Pattern 2.

**Import + async-iterable audio push pattern** (from RESEARCH § Pattern 2, lines 297-352):
```typescript
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  type AudioStream,
} from "@aws-sdk/client-transcribe-streaming";

const client = new TranscribeStreamingClient({ region: "us-east-1" });

async function* audioChunkGenerator(buffer: Buffer): AsyncIterable<AudioStream> {
  const CHUNK_SIZE = 16 * 1024;
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    yield { AudioEvent: { AudioChunk: buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length)) } };
  }
}
```

**Partial-vs-final result filter** — critical, do not skip (see RESEARCH § Pitfall 3):
```typescript
for await (const event of response.TranscriptResultStream) {
  for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
    if (result.IsPartial) continue;   // ← MUST filter partials
    for (const alt of result.Alternatives ?? []) {
      if (alt.Transcript) finalTranscripts.push(alt.Transcript);
    }
  }
}
```

**Pitfall specific to this file:**
- The client and command imports are separate — do not `import * as tsc from "@aws-sdk/client-transcribe-streaming"` (bundle bloat and tree-shake defeat).
- The `AudioStream` async-iterable must be constructed BEFORE `client.send(cmd)` — the SDK begins reading it as soon as `send()` returns. Buffer the entire post-transcode blob before constructing the generator.

---

### `src/backend/voice/audio-transcode.ts` (utility, transform via subprocess)

**Analog:** `src/backend/ssh/opkssh-auth.ts:339-344` (only in-repo spawn pattern, though it's long-lived not stdio-piped).

**Spawn shape from analog** (lines 331-344):
```typescript
const args = ["login", "--print-key", "--disable-browser-open", ...];
const opksshProcess = spawn(binaryPath, args, {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});
```

**Transcode pattern** (adapted for stdin/stdout piping — RESEARCH § Pattern 5):
```typescript
import { spawn } from "node:child_process";

export async function webmToOggOpus(webmBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-i", "pipe:0",       // stdin
      "-c:a", "copy",       // codec copy — no re-encode
      "-f", "ogg",
      "pipe:1",             // stdout
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
    ff.stdin.end(webmBuffer);
  });
}
```

**Pitfall specific to this file:**
- `ffmpeg` must be present in `docker/Dockerfile` Stage 5 apt line. If missing → `ENOENT` at first voice-in in prod. See RESEARCH § Pitfall 7 (SHIP BLOCKER).
- Fallback: if `-c:a copy` fails on any browser's WebM (Chrome multi-channel Opus), retry with `-ar 16000 -ac 1 -f flac` to full-transcode to FLAC. Both are accepted by Transcribe.
- Unit tests can mock `spawn`; integration test SHOULD use a real webm sample from `~/.claude/roles/box-maintainer/bounties/more-versatile-stt-tts-support/samples/clips/*.webm`.

---

### `src/backend/voice/chunk-and-stitch.ts` (utility, pure text transform)

**Analog:** `src/backend/voice/slashCommandTransform.ts` — EXACT structural match. Both are pure kernels, both are truth-table-testable, both are consumed by `voice.ts` handlers.

**Import + module header pattern** (from `slashCommandTransform.ts:1-70`):
```typescript
/**
 * Phase 98 Plan XX — Polly chunk-and-stitch (pure kernel).
 *
 * This module is the pure text splitter — no I/O, no async, no side effects.
 * It's consumed by handleSpeakStream to keep individual Polly SynthesizeSpeech
 * calls under the 3000-billed-char ceiling (§ RESEARCH Pattern 3).
 *
 * Design invariants:
 *   - Sentence-boundary split via lookbehind regex, with abbreviation guards.
 *   - CHUNK_MAX_CHARS = 2900 (100-char safety margin under Polly's 3000-billed ceiling).
 *   - splitIntoSentences and packChunks are separate exports for testability.
 */
```

**Core split-and-pack pattern** (from RESEARCH § Pattern 3, lines 362-422): copy verbatim into the file. Two exported functions:
- `splitIntoSentences(text: string): string[]`
- `packChunks(sentences: string[]): string[]`

Both are pure functions matching the `applyServerSlashTransform` style at `slashCommandTransform.ts:181`.

**Test shape** — copy `slashCommandTransform.test.ts` truth-table structure (many `it("case: ...")` blocks, each with a fixed input and expected output).

**Pitfall specific to this file:**
- Do NOT pull in an NLP tokenizer package (adds 500KB+ to bundle). The abbreviation set of ~15 entries handles chat-message text; overengineering here is anti-pattern per RESEARCH § Anti-Patterns.
- Empty-input edge case: `splitIntoSentences("")` MUST return `[]`, not `[""]`. Testable.

---

### `src/backend/voice/polly-voice-catalog.ts` (config, static-const)

**Analog:** `src/backend/distributor/catalog.ts:98` (`FLEET_SUBSTRATE_CATALOG: readonly CatalogEntry[]`) — canonical repo pattern for typed static-const arrays.

**Convention from analog** (lines 92-105):
```typescript
/**
 * The N-row hand-maintained catalog. [Description of ordering rule.]
 */
export const FLEET_SUBSTRATE_CATALOG: readonly CatalogEntry[] = [
  {
    slug: "id-skill",
    bundledPath: "/app/fleet-substrate/skills/id/SKILL.md",
    installPath: "~/.claude/skills/id/SKILL.md",
    restartHook: null,
  },
  ...
];
```

**Pattern to write** (from RESEARCH § Example 1, lines 699-727):
```typescript
export interface PollyVoice {
  voiceId: string;         // Polly's own VoiceId enum member
  displayName: string;
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

export const POLLY_VOICE_IDS: Set<string> = new Set(POLLY_VOICES.map(v => v.voiceId));
export function isValidPollyVoice(id: unknown): id is string {
  return typeof id === "string" && POLLY_VOICE_IDS.has(id);
}
```

**Pitfall specific to this file:**
- Backend static-const modules in this repo use `readonly` on the array type — see `distributor/catalog.ts:98` and `relay-sessions/observation-loop.ts:60` (`BACKOFF_LADDER_MS: readonly number[]`). `as const` on the outer literal is fine, but `readonly Foo[]` in the type annotation is the house convention.
- CONTEXT locks "frontend inlines the const" but the shape file also allows keeping `handleListVoices` returning this const. If handler is kept, `voice.ts` imports `POLLY_VOICES` from here. If handler dropped, this module still exists (backend needs `POLLY_VOICE_IDS` for validation regardless — see `identities.ts:51` update below).
- The frontend cannot `import` from `src/backend/*`; the frontend must own its OWN copy of the same array in `VoicePicker.tsx`. Two-source-of-truth is acceptable here (7 static strings, low drift risk).

---

### `src/backend/voice/riff-header-builder.ts` (utility, pure byte-buffer builder)

**Analog:** `src/backend/voice/slashCommandTransform.ts` for the "pure, no imports, no side effects" module shape.

**Core pattern** (from RESEARCH § Pattern 4, lines 434-466): copy verbatim. Single exported function:
```typescript
export function buildRiffHeader({
  channels, sampleRate, bitDepth, dataSize = 0xFFFFFFFF,
}: { channels: number; sampleRate: number; bitDepth: number; dataSize?: number; }): Buffer {
  const buf = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(dataSize + 36, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
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

**Pitfall specific to this file:**
- Reverse-engineer the field layout from `src/ui/features/pretty-view/riffPcmDecode.ts` (the consumer) — do NOT trust the RIFF spec alone. The player's parser may be lenient/strict about specific fields (see RESEARCH § Anti-Pattern: don't rewrite the player's parser; instead ensure the header matches what it expects).
- Header is written ONCE at start of the response stream (before the first chunk of PCM). Subsequent Polly chunks in the same stream emit raw PCM only. Coordination happens in `handleSpeakStream`.

---

### `src/backend/voice/voice-migration.ts` (service, startup one-shot)

**Analog:** `src/backend/telegram/bridge-config-writer.ts:354-398` (`ensureBridgeConfigWritten` — startup one-shot pattern) + `src/backend/claude-session/identity-artifact-reader.ts:2604-2617` (`writeIdentityFile` tmp+rename LOCAL branch).

**Startup entry-point shape** (from `bridge-config-writer.ts:350-398`):
```typescript
/**
 * Startup one-shot. Called fire-and-forget from starter.ts after DB init.
 * Wraps everything in try/catch; NEVER re-throws.
 */
export async function ensureVoiceValuesMigrated(): Promise<void> {
  try {
    const result = await walkAndMigrateAll();
    databaseLogger.info("ensureVoiceValuesMigrated: complete", {
      operation: "voice_migration_complete",
      identitiesScanned: result.identities.scanned,
      identitiesChanged: result.identities.changed,
      rolesScanned: result.roles.scanned,
      rolesChanged: result.roles.changed,
    });
  } catch (err) {
    databaseLogger.warn("ensureVoiceValuesMigrated: unhandled error at startup", {
      operation: "voice_migration_startup_error",
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}
```

**LOCAL tmp+rename write pattern** — copy from `identity-artifact-reader.ts:2609-2616`:
```typescript
// LOCAL branch — tmp+rename, mirrors writeIdentityWakeupUpdate lines 713-718
const root = getLocalIdentitiesRoot();
const filePath = path.join(root, identityKey, identityKey + ".md");
const tmpPath = filePath + ".tmp";
await fs.writeFile(tmpPath, contents, "utf-8");
await fs.rename(tmpPath, filePath);
```

**Walk pattern** — from RESEARCH § Pattern 6 (lines 505-560): copy the `walkAndMigrate(root)` function verbatim; call it once for `getLocalIdentitiesRoot()` and once for `getLocalRolesRoot()` (both imported from `identity-artifact-reader.ts`).

**Wire from `starter.ts:278`** — copy the sibling block already present for `ensureBridgeConfigWritten`:
```typescript
// starter.ts — add right below the bridge-config-writer block at :278
void import("./voice/voice-migration.js")
  .then((m) => m.ensureVoiceValuesMigrated())
  .catch((err) => {
    systemLogger.warn("ensureVoiceValuesMigrated failed at startup", {
      operation: "voice_migration_startup_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
  });
```

**Pitfall specific to this file:**
- Idempotency guard MUST be there: `if (POLLY_VOICES.has(currentVoice)) return { changed: false };` — every restart re-runs this; on already-migrated boxes it must no-op fast (<50ms).
- Use `getLocalIdentitiesRoot()` + `getLocalRolesRoot()` (both exported from `identity-artifact-reader.ts:217, 237`) — do NOT hardcode `~/.claude/identities`. The env-var override `IDENTITIES_HOST_DIR` / `ROLES_HOST_DIR` is load-bearing for the docker bind-mount.
- Line-based regex on frontmatter (not full yaml round-trip) — preserves user's whitespace/quoting. Pattern from RESEARCH § Pattern 6 uses `fmText.replace(/^voice:\s*.+\n?/m, "")`.
- NEVER throw from `ensureVoiceValuesMigrated` — starter.ts fires fire-and-forget and would otherwise crash the process. Wrap everything in try/catch (mirror `bridge-config-writer.ts:389-397`).
- Frontmatter absence is fine (skip the file). Old regex mismatch is fine (skip — avoid clobbering unrelated `voice:` values that happen to differ). Only wipe values that match `/^[A-Z][A-Za-z]+\.wav$/`.

---

### `src/backend/database/routes/voice.ts` (REWRITE)

**Analog:** itself pre-rewrite. Preserve outer route registrations (lines 425-471); replace handler bodies with adapter calls.

**Router + middleware pattern to preserve** (lines 43-53, 425-471) — do not touch:
```typescript
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post("/transcribe", authenticateJWT, upload.single("file"), (req, res) => { void handleTranscribe(req, res); });
router.post("/speak", authenticateJWT, express.json({ limit: "64kb" }), (req, res) => { void handleSpeak(req, res); });
router.post("/speak-stream", authenticateJWT, express.json({ limit: "64kb" }), (req, res) => { void handleSpeakStream(req, res); });
router.get("/voices", authenticateJWT, (req, res) => { void handleListVoices(req, res); });
```

**Disk-bank pattern (PRESERVE VERBATIM)** — lines 76-90 must stay in place, BEFORE any transcode. This writes raw multipart bytes; if transcode is inserted after this, Ashley's `.webm` files stay `.webm` on disk (see RESEARCH § Pitfall 6):
```typescript
// PRESERVE — must run BEFORE any ffmpeg transcode
const dir = process.env.STT_RECORDINGS_DIR ?? "/app/stt-recordings";
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const filename = `${timestamp}-${userId ?? "anon"}-${file.size}.${ext}`;
const fullPath = path.join(dir, filename);
void fs.promises.mkdir(dir, { recursive: true })
  .then(() => fs.promises.writeFile(fullPath, file.buffer))
  .catch((err) => { databaseLogger.warn(...); });
```

**Slash-command transform integration (PRESERVE VERBATIM)** — lines 138-181 must run on the AWS transcript exactly as they run on the Chatterbox transcript today. Only change is the source of `rawText`:
```typescript
// After transcribeBuffer(...) returns, feed the transcript through the SAME
// slash-transform block currently at voice.ts:138-181. Do NOT modify the
// transform module (slashCommandTransform.ts) — CONTEXT locks it unchanged.
```

**Voice-value validation (UPDATE)** — replace the regex at line 216 + 304:
```typescript
// OLD: if (!VOICE_FILENAME_RE.test(req.body.voice)) { ... }
// NEW: import { isValidPollyVoice } from "../../voice/polly-voice-catalog.js";
if (req.body.voice !== undefined) {
  if (typeof req.body.voice !== "string" || !isValidPollyVoice(req.body.voice)) {
    return res.status(400).json({ error: "body.voice must be one of the supported Polly voice IDs" });
  }
}
```

**Error handling pattern (PRESERVE + EXTEND)** — the try/catch/AbortError structure at lines 183-201 stays; ADD an AccessDenied branch BEFORE the catchall so policy-detached returns `503` at info-level (not error-level spam):
```typescript
if (isAwsAccessDenied(err)) {   // NEW helper — check err.name === "AccessDeniedException"
  databaseLogger.info("[voice-server] transcribe-access-denied — policy not attached",
    { operation: "voice_transcribe_access_denied" });
  return res.status(503).json({ error: "voice STT unavailable", status: 503 });
}
```

**Streaming pipe pattern (PRESERVE at chunk-and-stitch orchestration site)** — lines 351-360:
```typescript
res.status(200);
res.setHeader("Content-Type", "audio/wav");
res.setHeader("X-Accel-Buffering", "no");     // ← nginx anti-buffering — MUST preserve
// For each chunk: readable.pipe(res, { end: false }); call res.end() only after last chunk.
```

**Pitfall specific to this file:**
- Do NOT preserve the 300s timeout from the old handleSpeak (`voice.ts:230`). Polly first-byte is 200-400ms; a 30s cap is generous (RESEARCH § Pitfall / Anti-Patterns).
- Remove the `STT_URL`/`TTS_URL`/`TTS_STREAM_URL`/`VOICES_URL` import from line 14 — replace with the adapter imports.
- `DEFAULT_VOICE = "Elena.wav"` at line 38 → change to a valid Polly voice (e.g. `"Joanna"`) OR remove the constant if identities are expected to always carry an explicit voice.
- `SPEAK_TEXT_MAX = 25000` at line 39 stays — this is now the trigger for chunk-and-stitch (a message near 25000 chars will produce ~9 Polly calls at 2900 chars each).

---

### `src/backend/telegram/bridge-config-writer.ts` (MODIFIED)

**Analog:** itself. Two edits, per the tg-bridge decision locked 2026-09-10.

**STT_URL import removal** — line 33-34 currently:
```typescript
import { STT_URL, getMatrixHomeserverBase } from "../config/media-endpoints.js";
```
Change to:
```typescript
import { getMatrixHomeserverBase } from "../matrix/matrix-config.js";  // moved from media-endpoints.ts
// STT_URL import DELETED — bridge now hits Skynet's own /voice/transcribe.
```

**config.env write body** — lines 106-109 currently:
```typescript
const body =
  `# Written by Skynet at boot — Phase 79 Plan 04. Do not edit by hand.\n` +
  `MATRIX_ROOT=${homeserverBase}\n` +
  `STT_URL=${STT_URL}\n`;
```
Change to:
```typescript
const body =
  `# Written by Skynet at boot — Phase 98. Do not edit by hand.\n` +
  `MATRIX_ROOT=${homeserverBase}\n` +
  `SKYNET_BASE=${skynetBaseUrl}\n` +
  `SKYNET_BRIDGE_TOKEN=${bridgeToken}\n`;
```
(Planner picks the token-mint mechanism — bridge-scoped JWT via `AuthManager` is the closest analog; see `authManager.createAuthMiddleware()` at `voice.ts:46`. Shared secret env-var is simpler but requires operator handoff.)

**Bash-source safety check** — preserve lines 90-104; update the variable names but keep the `.includes("#") || .includes("\n")` guards for whatever values are written.

**Pitfall specific to this file:**
- The atomic tmp+rename pattern at lines 111-115 MUST stay — half-written config.env crashes the bridge (`bridge.sh:73` sources the file).
- `ensureBridgeConfigWritten` NEVER throws (line 389 comment) — new failure modes (Skynet base URL resolution, token minting) must return `{ ok: false, reason }` not throw.

---

### `substrate/services/tg-bridge/bridge.sh:225` (MODIFIED)

**Analog:** the block itself (`tg_voice_to_mx` at lines 217-235) plus other curl-POST call sites in `bridge.sh`.

**Current shape** (line 225):
```bash
text=$(curl -s --max-time 90 -X POST "$STT" -F "file=@$dest;type=audio/ogg" -F "model=large-v3" | jq -r '.text // empty')
```

**Two options per RESEARCH § Pitfall 8** (locked to option: route through Skynet per CONTEXT § Telegram bridge STT):
```bash
# NEW — route through Skynet's authenticated /voice/transcribe endpoint
text=$(curl -s --max-time 120 -X POST "$SKYNET_BASE/voice/transcribe" \
  -H "Authorization: Bearer $SKYNET_BRIDGE_TOKEN" \
  -F "file=@$dest;type=audio/ogg" \
  | jq -r '.text // empty')
```

**Config-source pattern to update** — lines 75-84 currently source `STT_URL`; update to source `SKYNET_BASE` + `SKYNET_BRIDGE_TOKEN`:
```bash
# Current lines 75-84:
if [ -z "${MATRIX_ROOT:-}" ] || [ -z "${STT_URL:-}" ]; then
  echo "[tg-bridge] FATAL: MATRIX_ROOT or STT_URL missing from $CONFIG_FILE"
  exit 1
fi
ROOT="$MATRIX_ROOT"
BASE="$ROOT/_matrix/client/v3"
STT="$STT_URL"
# Update to:
if [ -z "${MATRIX_ROOT:-}" ] || [ -z "${SKYNET_BASE:-}" ] || [ -z "${SKYNET_BRIDGE_TOKEN:-}" ]; then
  echo "[tg-bridge] FATAL: MATRIX_ROOT / SKYNET_BASE / SKYNET_BRIDGE_TOKEN missing from $CONFIG_FILE"
  exit 1
fi
ROOT="$MATRIX_ROOT"
BASE="$ROOT/_matrix/client/v3"
```

**Pitfall specific to this file:**
- The bridge's config-check at line 75 is fail-loud — if `SKYNET_BASE` is missing the container exits with FATAL. Config-writer changes and bridge changes MUST ship together or the bridge will crash-loop after the first Skynet redeploy.
- `substrate/services/tg-bridge/README.md:22` documents the config schema — update it in the same commit (see README pattern above).
- Timeout bumps from 90s to 120s because Skynet's `/voice/transcribe` adds transcode + Transcribe streaming latency on top of what Chatterbox did in one hop.

---

### `src/ui/features/pretty-view/pickers/VoicePicker.tsx` (MODIFIED)

**Analog:** itself pre-modify.

**Current fetch-on-mount pattern** (lines 24-31):
```typescript
useEffect(() => {
  let cancelled = false;
  getVoices()
    .then((list) => { if (!cancelled) setVoices(list); })
    .catch(() => { if (!cancelled) setVoices([]); });
  return () => { cancelled = true; };
}, []);
```

**Replace with inlined const** (drop the effect entirely):
```typescript
// Phase 98: fixed catalog inlined — no runtime fetch.
// Mirror of src/backend/voice/polly-voice-catalog.ts POLLY_VOICES.
// Two sources of truth acceptable (7 static strings, low drift risk).
const POLLY_VOICES: readonly { voiceId: string; displayName: string }[] = [
  { voiceId: "Danielle", displayName: "Danielle" },
  { voiceId: "Joanna",   displayName: "Joanna"   },
  { voiceId: "Ruth",     displayName: "Ruth"     },
  { voiceId: "Salli",    displayName: "Salli"    },
  { voiceId: "Tiffany",  displayName: "Tiffany"  },
  { voiceId: "Matthew",  displayName: "Matthew"  },
  { voiceId: "Stephen",  displayName: "Stephen"  },
];
```

**Option list pattern to update** (lines 93-97) — key on `voiceId` not `filename`:
```typescript
{POLLY_VOICES.map((v) => (
  <option key={v.voiceId} value={v.voiceId} style={{ background: "#1a1c26", color: "#f0ebe0" }}>
    {v.displayName}
  </option>
))}
```

**Import to drop** — line 3:
```typescript
// OLD: import { getVoices, postSpeak, SAMPLE_PHRASE } from "@/api/voice-api";
// NEW: import { postSpeak, SAMPLE_PHRASE } from "@/api/voice-api";
```

**Pitfall specific to this file:**
- The `useState<{ display_name: string; filename: string }[]>` type on line 20 uses old-Chatterbox field names — update to `{ voiceId: string; displayName: string }[]` OR replace with a plain `const` outside the component.
- `value=""` default option (line 92) reads "(default)"; verify default falls back to a valid Polly voice on the backend, not to `Elena.wav`.

---

### `src/ui/api/voice-api.ts` (MODIFIED)

**Analog:** itself pre-modify.

**Delete `getVoices` export** — lines 53-60 removed entirely.

**Preserve `postSpeak` and `postSpeakStream`** — client contract locked, no changes to signatures. Only the `voice` string values change (Polly voice IDs instead of `.wav` filenames), which is transparent to this module.

**Pitfall specific to this file:**
- `handleApiError(error, "list voices")` on line 58 disappears with `getVoices` — verify no orphan imports of `getVoices` remain in the codebase (`grep -rn "getVoices" src/ui/`).

---

### `src/backend/database/routes/identities.ts:51` (MODIFIED)

**Analog:** itself pre-modify.

**Regex replacement** — line 51:
```typescript
// OLD:
const IDENTITY_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/;
// NEW:
import { isValidPollyVoice } from "../../voice/polly-voice-catalog.js";
// (constant deleted — validation moves to whitelist function)
```

**Validation call-site update** — lines 479-487:
```typescript
// OLD:
if (
  meta.voice !== undefined && meta.voice !== null &&
  (typeof meta.voice !== "string" || !IDENTITY_VOICE_RE.test(meta.voice))
) {
  return res.status(400).json({ error: "voice must match [A-Z][A-Za-z]+\\.wav" });
}
// NEW:
if (
  meta.voice !== undefined && meta.voice !== null &&
  (typeof meta.voice !== "string" || !isValidPollyVoice(meta.voice))
) {
  return res.status(400).json({ error: "voice must be one of the supported Polly voice IDs" });
}
```

**Pitfall specific to this file:**
- The `IDENTITY_VOICE_RE` constant is used only at line 482 — one call site. Grep confirms no other references.
- The migration script (`voice-migration.ts`) MUST run BEFORE any user hits PUT /identities/:key with an old-shape value, or validation will 400 the existing frontmatter value. Since the migration is startup one-shot, this is naturally sequenced (starter.ts fires it during bootstrap before routes accept traffic).

---

### `src/backend/database/routes/identity-birth.ts:381` + `identity-clone.ts` (MODIFIED)

**Analog:** the routes themselves.

**identity-birth.ts** — line 381 uses `parsedVoice` which trickles up from `voice` at line 95. The default in `voice.ts:38` (`DEFAULT_VOICE = "Elena.wav"`) needs to be either dropped or updated. Recommend dropping and letting frontmatter carry null when no voice picked.

**identity-clone.ts** — lines 294, 341, 345, 397, 682-683 do value passthrough of `voice`. The whitelist check should be centralized via `isValidPollyVoice` from `polly-voice-catalog.ts`. Line 15 comment says "≤100 chars"; update the guardrail.

**Pitfall specific to these files:**
- `identity-birth.ts:381` writes to frontmatter unconditionally; if `parsedVoice` is `null`, the yaml serializer should OMIT the key (not write `voice: null`). Verify against existing behavior — the tests at `identity-birth.test.ts:243` use `voice: "Elena.wav"` — update to a Polly voice or null.
- `identity-clone.ts:682` writes `voice` frontmatter pair only if non-empty (`if (voice !== null && voice.trim().length > 0)`) — this shape is preserved verbatim.

---

### `src/backend/config/media-endpoints.ts` (DELETE)

**Analog:** none — deletion.

**Pre-work required:** `getMatrixHomeserverBase()` (lines 51-57) has ONE non-STT consumer (`bridge-config-writer.ts:34`). Move it to `src/backend/matrix/matrix-config.ts` (new file) OR inline it directly into `bridge-config-writer.ts`. Grep confirms only two importers of `media-endpoints.ts`:
```
src/backend/database/routes/voice.ts:14
src/backend/telegram/bridge-config-writer.ts:35
```
Both are rewritten in this phase — safe to delete the file.

**Pitfall specific to this deletion:**
- The `media-endpoints.test.ts` sibling file (`src/backend/config/media-endpoints.test.ts`) must be deleted alongside.
- The Phase 79 rationale docstring (lines 1-17) referenced Ashley's verbatim quote about shared source of truth — that's superseded by Phase 98's clean-cutover decision, no doc update needed elsewhere.

---

### `src/backend/starter.ts:278` (MODIFIED)

**Analog:** the existing `ensureBridgeConfigWritten` block at lines 278-285.

**Sibling block to add** (immediately after line 285):
```typescript
// Phase 98 — one-shot voice-value migration.
// Walks ~/.claude/identities/*/*.md and ~/.claude/roles/*/*.md,
// clears any voice: frontmatter value matching the old Chatterbox
// regex /^[A-Z][A-Za-z]+\.wav$/. Idempotent — no-ops after first
// successful run (identity/role files with already-conformant voice
// values are skipped).
void import("./voice/voice-migration.js")
  .then((m) => m.ensureVoiceValuesMigrated())
  .catch((err) => {
    systemLogger.warn("ensureVoiceValuesMigrated failed at startup", {
      operation: "voice_migration_startup_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
  });
```

**Pitfall specific to this file:**
- Ordering matters — the migration should run BEFORE any HTTP traffic hits routes; starter.ts's structure already gates HTTP-accepting on later blocks (see line 300+ reconcile-loop starts). The fire-and-forget nature means migration completes ~parallel to route bringup; that's acceptable (validator rejection of old-shape values in the millisecond gap is a UAT non-issue).

---

### `docker/Dockerfile:67` (MODIFIED)

**Analog:** line 67 itself — the existing Stage 5 apt-get install list.

**Current line:**
```dockerfile
RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu wget && \
```

**Modified:**
```dockerfile
RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu wget ffmpeg && \
```

**Pitfall specific to this file:**
- **SHIP BLOCKER** per RESEARCH § Pitfall 7 — omitting this makes voice-in fail with `ENOENT: ffmpeg not found` on first upload.
- ffmpeg is ~30MB (RESEARCH § A8 — negligible vs current image size).
- Verify locally after change: `docker build -f docker/Dockerfile -t skynet:dev . && docker run --rm skynet:dev ffmpeg -version`.
- Stage 1 (line 5) and Stage 4 (line 43) build stages do NOT need ffmpeg — only the runtime Stage 5.

---

### `docs/deploy/aws-voice-setup.md` (NEW)

**Analog:** `substrate/services/tg-bridge/README.md` — numbered-list operator-flow style + TESTING.md brevity convention.

**No `docs/` directory exists at repo root** — this phase creates it. First doc under `docs/deploy/`. If planner prefers avoiding a new top-level directory, alternate placements: `substrate/services/tg-bridge/README.md`-style co-location under `src/backend/voice/DEPLOY.md`, or append a section to top-level README.md.

**Structure pattern to follow** (from `substrate/services/tg-bridge/README.md`):
```markdown
# AWS voice setup (Polly + Transcribe)

Phase 98 — per-instance operator setup for the AWS-backed voice endpoints.
Each Skynet instance (t1000, T800, ...) uses its own AWS account and its own
IAM role; policy attach is a per-operator step, not shipped in code.

## What this covers

- [...]

## Prerequisites

- [...]

## Steps

1. [step 1 with exact command]
2. [step 2 with exact command]
3. Verify: `aws polly describe-voices --engine generative --language-code en-US`

## The policy JSON

\`\`\`json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "polly:SynthesizeSpeech",
        "polly:DescribeVoices",
        "transcribe:StartStreamTranscription",
        "transcribe:StartStreamTranscriptionWebSocket"
      ],
      "Resource": "*"
    }
  ]
}
\`\`\`

## What happens if the policy is absent

Feature dark: [describe AccessDenied → 503 UX].

## Region

Hardcoded to us-east-1. To change: edit ...

## For t1000 (Ashley's instance)

Policy is already attached (Iris 2026-09-09, `termix-ssm-role/PollyTranscribeExploratory`).
Pre-ship: ping Iris to re-scope name from `-Exploratory` to production.

## For T800 (Stacy's instance)

Follow the steps above unmodified. If uncertainty, [contact path].
```

**Pitfall specific to this file:**
- Doc must be self-contained — CONTEXT explicitly says Ashley/Stacy can each execute without pinging tabitha.
- Ship-checklist item (from CONTEXT § Specifics): pre-ship, ping Iris to re-scope policy name from `-Exploratory` to production. This coordination lives in the doc AND in the ship checklist.

---

### `src/backend/voice/*.test.ts` (NEW — multiple)

**Analog:** `src/backend/database/routes/voice.test.ts` — the exemplar for function-level backend tests with mocked external clients.

**Function-level test shape** (from `voice.test.ts:47-60`):
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// Mock external clients at top of file with vi.mock(...)
import { handleTranscribe, handleSpeak, ... } from "./voice.js";
// Minimal Express mock (MockRes/MockReq types) — no Express harness
```

**AWS SDK v3 mock pattern** (from RESEARCH § Example 3):
```typescript
vi.mock("@aws-sdk/client-polly", () => ({
  PollyClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      AudioStream: Readable.from([Buffer.from([0, 1, 2, 3])]),
    }),
  })),
  SynthesizeSpeechCommand: vi.fn().mockImplementation((input) => ({ input })),
}));
```

**fs mock pattern** (from `voice.test.ts:27-45`):
```typescript
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    default: { ...actual, promises: { ...actual.promises, writeFile: vi.fn(async () => undefined), mkdir: vi.fn(async () => undefined) } },
    promises: { ...actual.promises, writeFile: vi.fn(async () => undefined), mkdir: vi.fn(async () => undefined) },
  };
});
```

**Integration test naming convention** — `*.integration.test.ts` (e.g., `polly-adapter.integration.test.ts`), env-gated with `AWS_INTEGRATION_TESTS=1`.

**Pitfall specific to these files:**
- Tests MUST assert the client was constructed with no `credentials` arg (RESEARCH § Pitfall 2 — passing credentials disables IMDS chain).
- `chunk-and-stitch.test.ts` is pure-function only — no mocks needed, mirror `slashCommandTransform.test.ts` truth-table style.
- Integration tests are opt-in via env var so CI (and dev machines without AWS creds) skip them.

---

### `tests/e2e/voice-picker.spec.ts` (NEW — Playwright)

**Analog:** any existing spec under `tests/e2e/` — `smoke.spec.ts` mentioned in `TESTING.md:11` as the pre-deploy gate.

**Pattern to follow:** mount the identity modal, assert dropdown contains exactly 7 options with the expected voice IDs, select one, reload, assert selection persisted.

**Pitfall specific to this file:**
- e2e tests are NOT gated by AWS creds — the picker is purely UI + backend persistence; no Polly call is made during the picker workflow itself. Only clicking the "sample" button triggers a Polly call, so the spec should either skip the sample interaction or mock the `/voice/speak` response at the network layer via Playwright's `page.route(...)`.

---

## Shared Patterns

### Authentication (JWT middleware)

**Source:** `src/backend/utils/auth-manager.ts` — `AuthManager.getInstance().createAuthMiddleware()`.
**Apply to:** All `/voice/*` route registrations (already applied — preserve verbatim during rewrite).
```typescript
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
router.post("/transcribe", authenticateJWT, upload.single("file"), handler);
```
- Ordering invariant (T-16-04): `authenticateJWT` BEFORE `multer.upload.single(...)` so 401s reject before body parse.

### Structured logging

**Source:** `src/backend/utils/logger.ts` — `databaseLogger.info/warn/error(msg, { operation: "..." })`.
**Apply to:** Every adapter, every handler, the migration script.
- Every log line has `operation:` metadata for grep + observability.
- `[voice-server]` prefix in message strings for `voice.ts` handlers (preserve — Ashley's log-tail habit).
- `.info` for expected states (including AccessDenied — feature dark is not an error), `.warn` for degraded states (bank-write fail), `.error` for unexpected exceptions.
- NEVER log message text content — only lengths and voice IDs (RESEARCH § Security § Log Injection).

### External-service error handling (AWS SDK)

**Source:** RESEARCH § Pitfall 2 + § V7 — new pattern for this phase, no analog in repo.
**Apply to:** Every backend adapter (`polly-adapter.ts`, `transcribe-adapter.ts`).
```typescript
// Helper (new — add to polly-adapter.ts or a shared aws-errors.ts):
export function isAwsAccessDenied(err: unknown): boolean {
  return err instanceof Error &&
    ("name" in err && (err as { name: string }).name === "AccessDeniedException"
     || ("$metadata" in err && (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 403));
}
// Handler-level catchall in voice.ts:
if (isAwsAccessDenied(err)) return res.status(503).json({ error: "voice ... unavailable", status: 503 });
// (info-level log — NOT error — since this is expected policy-detached state)
```

### Atomic tmp+rename file writes

**Source:** `src/backend/claude-session/identity-artifact-reader.ts:2609-2616` (LOCAL branch of `writeIdentityFile`) + `src/backend/telegram/bridge-config-writer.ts:113-115`.
**Apply to:** `voice-migration.ts` frontmatter rewrites, any config.env writes.
```typescript
const tmpPath = filePath + ".tmp";
await fs.writeFile(tmpPath, contents, "utf-8");
await fs.rename(tmpPath, filePath);
```

### Startup one-shot pattern (fire-and-forget from starter.ts)

**Source:** `src/backend/telegram/bridge-config-writer.ts:354-398` + `src/backend/starter.ts:278-285`.
**Apply to:** `voice-migration.ts::ensureVoiceValuesMigrated`.
- ALWAYS wraps everything in try/catch, NEVER re-throws.
- Called with `void import(...).then(m => m.ensureX()).catch(...)` — fire-and-forget from starter.ts.
- Returns void, side-effects via file writes + structured logging.

---

## No Analog Found

Files with no close in-repo analog (planner should use RESEARCH.md patterns or new-to-repo pattern):

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `docs/deploy/aws-voice-setup.md` | operator doc | narrative | No prior `docs/deploy/` directory exists in the repo; house doc style is co-located per-service READMEs (`substrate/services/tg-bridge/README.md`) or top-level short-form (`TESTING.md`). Planner picks path + style; closest tonal analog is the tg-bridge README's numbered-step operator flow. |
| `src/backend/voice/*.integration.test.ts` | integration test | real-AWS | No existing `*.integration.test.ts` pattern in `src/backend/voice/` — closest is `src/backend/claude-session/claude-session-server.aside.integration.test.ts` (same naming, but tests Claude session I/O not external cloud services). Env-gating pattern is new to repo. |

---

## Metadata

**Analog search scope:**
- `src/backend/voice/` — all files (existing analogs for pure kernels)
- `src/backend/database/routes/` — voice.ts, identities.ts, identity-birth.ts, identity-clone.ts
- `src/backend/telegram/` — bridge-config-writer.ts (external-service config-writer pattern)
- `src/backend/matrix/` — matrix-admin-client.ts (external-service SDK wrapper analog)
- `src/backend/ssh/` — opkssh-auth.ts (only spawn() pattern in the tree)
- `src/backend/distributor/`, `src/backend/fleet-status/`, `src/backend/relay-sessions/` — static-const module patterns
- `src/backend/claude-session/` — identity-artifact-reader.ts (frontmatter read/write + LOCAL roots)
- `src/backend/starter.ts` — startup one-shot wiring convention
- `substrate/services/tg-bridge/` — bash service + README doc style
- `docker/Dockerfile` — apt-get install pattern
- `src/ui/features/pretty-view/`, `src/ui/api/` — frontend picker + api client shapes
- Top-level: `README.md`, `TESTING.md`, `SECURITY.md`, `CONTRIBUTING.md`

**Files scanned:** ~40 (Read tool) + ~250 (Bash grep/find)
**Pattern extraction date:** 2026-09-10
