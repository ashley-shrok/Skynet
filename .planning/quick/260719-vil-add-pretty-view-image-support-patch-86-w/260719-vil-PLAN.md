---
quick_id: 260719-vil
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/session-file-parser.ts
  - src/backend/claude-session/session-file-parser.test.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
  - src/ui/features/pretty-view/ImageBubble.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
autonomous: true
patch_label: "#86"
branch: feat/tab-title-from-tmux

must_haves:
  truths:
    - "A Read of a PNG in the Claude Code session (tool_result with base64 image content) surfaces as a visible image bubble in pretty view."
    - "The image bubble uses the assistant identity-hue treatment matching ChatMessage's assistant bubble exactly (hue-tinted gradient, hue border, hue outer glow) — not neutral gray."
    - "A tool_result carrying MULTIPLE images renders MULTIPLE <img> elements in ONE bubble."
    - "A turn carrying BOTH the canonical Anthropic path AND the CC-local convenience path emits only ONE image ref per underlying image (no duplication)."
    - "Text-only turns and turns whose only non-text content is tool_use/tool_result/thinking without image blocks remain unchanged in behavior (RENDER-01 hard-lock preserved for non-image tool_results)."
    - "Parser unit tests cover the six documented scenarios: canonical tool_result path, bare image content-block path, CC-local-only path, dedup between canonical+CC-local, mixed text+image, multi-image turn — plus a no-op regression case."
  artifacts:
    - path: src/backend/claude-session/session-file-parser.ts
      provides: "ImageMessage variant on ParsedLine + extractImageRefs() function"
      contains: "kind: \"image\""
    - path: src/backend/claude-session/session-file-parser.test.ts
      provides: "Parser unit tests covering image extraction scenarios"
      contains: "extractImageRefs"
    - path: src/backend/claude-session/claude-session-server.ts
      provides: "WS emit branch for kind:image → {type:\"image\", role, images, text, eventId, ts} frame, plus updated wire-protocol comment block"
      contains: "type: \"image\""
    - path: src/ui/api/claude-session-api.ts
      provides: "ImageEvent + ImageBlock types added to ClaudeSessionServerEvent discriminated union"
      contains: "ImageEvent"
    - path: src/ui/features/pretty-view/ImageBubble.tsx
      provides: "New component rendering one image event with assistant-identity-hue Glass treatment matching ChatMessage assistant bubble"
      contains: "ImageBubble"
    - path: src/ui/features/pretty-view/PrettyView.tsx
      provides: "WS switch case for type:image dispatching to <ImageBubble>, appended to the same message stream as text messages"
      contains: "case \"image\""
  key_links:
    - from: src/backend/claude-session/session-file-parser.ts
      to: src/backend/claude-session/claude-session-server.ts
      via: "kind:\"image\" ParsedLine consumed in onLine dispatcher"
      pattern: "parsed\\.kind === \"image\""
    - from: src/backend/claude-session/claude-session-server.ts
      to: src/ui/api/claude-session-api.ts
      via: "{type:\"image\", ...} WS frame → ImageEvent type"
      pattern: "type: \"image\""
    - from: src/ui/features/pretty-view/PrettyView.tsx
      to: src/ui/features/pretty-view/ImageBubble.tsx
      via: "case \"image\" in ws.onmessage switch → <ImageBubble> render"
      pattern: "<ImageBubble"
    - from: src/ui/features/pretty-view/ImageBubble.tsx
      to: src/ui/features/pretty-view/ChatMessage.tsx
      via: "aesthetic parity — same hsla(var(--pv-id-hue),...) gradient/border/shadow tokens"
      pattern: "hsla\\(var\\(--pv-id-hue\\)"
---

<objective>
Add pretty-view image support (patch #86, conceptually — patch-number is a commit-message label only for this quick; termix-patches.md write-up is out of scope per fleet directive).

Extend the JSONL parser to emit a new `kind:"image"` variant carrying inline base64 images, extend the claude-session WS server to emit those as a new `{type:"image"}` frame, and render them in pretty view via a new `ImageBubble` component styled to match `ChatMessage`'s assistant identity-hue treatment exactly.

Purpose: When Claude reads a PNG (avatar review, screenshot, etc.) the tool_result currently drops silently at the parser (RENDER-01 hard-lock, "aggressive minimalism"). Ashley (in pretty view) then can't see the image the agent just read. This patch lifts that restriction FOR IMAGES ONLY — non-image tool_results still drop as before.

Design de-risked by the prototype at `/home/ubuntu/.claude/identities/tina/bounties/pretty-view-image-support/proto/server.mjs` — the `extractImageRefs` logic and WS event shape are validated against 4 real Termix session JSONLs (7 image events on Amelia review). Port the LOGIC to TypeScript, not the JS itself.

Design flip: RESEARCH.md's Option B (HTTP endpoint) is superseded by WS-inline (Option A). The fork's pretty-view is WS-only on port 30011 with no HTTP surface to bolt onto, so inline-b64-over-existing-WS matches the pattern. Base64 payloads are typically ~150KB per PNG — acceptable inline for the read-only sessions pretty-view targets.

Output: A working end-to-end image bubble path — parser emits ImageMessage, WS server forwards as `type:"image"`, frontend renders as an identity-hue-tinted bubble with visible image(s) — plus 7-case parser unit test suite.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/ubuntu/termix/.planning/STATE.md
@/home/ubuntu/termix/CLAUDE.md
@/home/ubuntu/termix/src/backend/claude-session/session-file-parser.ts
@/home/ubuntu/termix/src/backend/claude-session/claude-session-server.ts
@/home/ubuntu/termix/src/ui/api/claude-session-api.ts
@/home/ubuntu/termix/src/ui/features/pretty-view/ChatMessage.tsx
@/home/ubuntu/termix/src/ui/features/pretty-view/PrettyView.tsx
@/home/ubuntu/.claude/identities/tina/bounties/pretty-view-image-support/proto/server.mjs
@/home/ubuntu/.claude/identities/tina/bounties/pretty-view-image-support/findings.md

## Existing test convention (observed)
- Runner: vitest (`npm test` runs `vitest run`; `npm run test:watch` for dev loop).
- Location: colocated `*.test.ts` next to source (e.g. `src/ui/features/pretty-view/commandTags.test.ts`).
- Config: `vitest.config.ts` at repo root.
- New parser test file MUST be: `src/backend/claude-session/session-file-parser.test.ts`.

## Sample JSONL for hand-verify (backend + fixtures)
- File: `/home/ubuntu/.claude/projects/-home-ubuntu/93ef065f-d5e5-4875-9d0a-cc05f3eb7ffb.jsonl`
- 442 lines; image events at lines 142, 295, 297 (and more — 7 total per recon).
- Grep to see all: `grep -n '"media_type":"image/png"' /home/ubuntu/.claude/projects/-home-ubuntu/93ef065f-d5e5-4875-9d0a-cc05f3eb7ffb.jsonl`
- DO NOT copy the file into the repo — it contains real session content. For the test fixtures, HAND-BUILD synthetic minimal JSONL turn objects mirroring the shape documented in the scope_detail (see findings.md and prototype for the exact structure).

## Assistant-bubble aesthetic tokens to mirror in ImageBubble (from ChatMessage.tsx lines 95-106)
- Row wrapper: `flex justify-start`
- Bubble base: `max-w-[85%]` (spec says min(85%,640px) — resolve to `max-w-[min(85%,640px)]`), `rounded-[var(--radius-pv-bubble)]`, `px-[18px] py-[14px]`
  - NOTE: spec asks for 12px padding — override to `px-3 py-3` (12px = tailwind `3`) instead of the text-bubble's 18/14. Images want tighter padding around the image edges.
- Backdrop: `backdrop-blur-xl saturate-150 [-webkit-backdrop-filter:blur(20px)_saturate(1.6)]`
- Border: `border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]`
- Background: `bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]`
- Shadow: `shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]`
- Text color for meta lines: `text-[#fbf5e8]` with `opacity-70` on the mono caption lines.
- The `!` important suffix from patch #81 shadcn-wrapper lesson is DEFENSIVE and NOT needed here — this is a plain `<div>` wrapper, not a shadcn UI primitive. Do NOT add `!` prefixes.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend parser with kind:"image" variant + extractImageRefs + unit tests</name>
  <files>src/backend/claude-session/session-file-parser.ts, src/backend/claude-session/session-file-parser.test.ts</files>
  <behavior>
    Unit test cases (session-file-parser.test.ts, using vitest describe/it/expect):
    - Test 1 (canonical tool_result path): JSONL turn with `type:"user"`, `message.content:[{type:"tool_result", tool_use_id:"toolu_A", content:[{type:"image", source:{type:"base64", data:"AAA", media_type:"image/png"}}]}]` → parseSessionLine returns `{kind:"image", role:"tool_result", images:[{data:"AAA", mediaType:"image/png", toolUseId:"toolu_A"}], text:"", eventId, ts}`.
    - Test 2 (bare image content-block path): `type:"user"`, `message.content:[{type:"image", source:{type:"base64", data:"BBB", media_type:"image/jpeg"}}]` → returns `{kind:"image", role:"user", images:[{data:"BBB", mediaType:"image/jpeg"}], text:"", ...}` (no toolUseId).
    - Test 3 (CC-local-only path): `type:"user"`, `message.content:[]` (or content omitted), `toolUseResult:{type:"image", file:{base64:"CCC", type:"image/png", originalSize:12345}}` → returns `{kind:"image", role:"tool_result", images:[{data:"CCC", mediaType:"image/png"}], ...}`.
    - Test 4 (dedup — canonical AND CC-local both present): a turn with a canonical tool_result image with data "DDD" AND `toolUseResult.file.base64:"DDD"` → returns exactly ONE image ref (the canonical one; the CC-local path is skipped because canonical scan produced results). `images.length === 1` and `images[0].data === "DDD"` and `images[0].toolUseId` is set (from canonical).
    - Test 5 (mixed text + image): `type:"assistant"`, `message.content:[{type:"text", text:"hello"}, {type:"image", source:{type:"base64", data:"EEE", media_type:"image/png"}}]` → returns `{kind:"image", role:"assistant", images:[{data:"EEE", mediaType:"image/png"}], text:"hello", ...}`.
    - Test 6 (multi-image single turn): tool_result with `content:[{type:"image", source:{...data:"F1"}}, {type:"image", source:{...data:"F2"}}]` → returns `{kind:"image", images:[{data:"F1",...}, {data:"F2",...}]}` with `images.length === 2`.
    - Test 7 (no-image regression): existing text-message case — `type:"assistant"`, `message.content:[{type:"text", text:"just words"}]` → returns `{kind:"message", role:"assistant", content:"just words", ...}` UNCHANGED. Confirms non-image path is untouched.
    - Test 8 (harness_wrapper still filters when no images): `type:"user"`, content = `"<system-reminder>foo</system-reminder>"` → `{kind:"skip", why:"harness_wrapper"}`. Confirms the wrapper filter still runs when imageRefs is empty.
    - Test 9 (harness_wrapper does NOT filter when images present): `type:"user"`, text = `"<system-reminder>foo</system-reminder>"` AND images present in the turn → returns `{kind:"image", text:"<system-reminder>foo</system-reminder>", images:[...]}`. Confirms harness_wrapper is bypassed when images are present (per scope_detail edge case).
  </behavior>
  <action>
    Extend `src/backend/claude-session/session-file-parser.ts`:

    1. Add exported types alongside `ConversationalMessage`:
       - `ImageBlock` = object with `data: string` (raw b64, no data-URI prefix), `mediaType: string`, `toolUseId?: string`.
       - `ImageMessage` = object with `kind: "image"`, `role: "user" | "assistant" | "tool_result"`, `images: ImageBlock[]`, `text: string`, `eventId: string`, `ts: number`.
    2. Extend the `ParsedLine` union to include `ImageMessage`.
    3. Update the top-of-file comment block: the HARD LOCK comment must be revised to note that IMAGES are now surfaced as a `kind:"image"` variant, while tool_use / non-image tool_result / thinking blocks remain dropped structurally. Keep the RENDER-01 reference but describe it as "aggressive minimalism, IMAGES EXCEPTED (patch #86)".
    4. Add exported function `extractImageRefs(obj)` that takes the parsed JSON object (typed as `Record<string, unknown>`) and returns `ImageBlock[]`. Port logic from the prototype's `extractImageRefs` (proto/server.mjs lines 40-85):
       - Scan `obj.message.content[]` when it's an array:
         - For blocks with `type === "tool_result"` and `content` array: iterate inner blocks; each with `type === "image"` and `source.type === "base64"` and `source.data` string → push `{data: source.data, mediaType: source.media_type ?? "image/png", toolUseId: outer.tool_use_id}` (toolUseId comes from the OUTER tool_result block).
         - For blocks with `type === "image"` and `source.type === "base64"` and `source.data` string → push `{data: source.data, mediaType: source.media_type ?? "image/png"}` (no toolUseId).
       - DEDUP: fall back to `obj.toolUseResult` scan ONLY when the canonical scan above yielded ZERO refs. Check `toolUseResult.type === "image"` and `toolUseResult.file.base64` string → push `{data: file.base64, mediaType: file.type ?? "image/png"}`. Do NOT include originalSize (out of scope for the wire type per scope_detail).
       - Preserve strict type guards throughout — all field accesses must narrow via `typeof x === "object"`, `Array.isArray`, `typeof x === "string"` checks, mirroring the existing extractText discipline in the file. No `any`.
    5. Update `parseSessionLine` main flow:
       - After the msg-null guard, compute BOTH `content = extractText(msg.content)` (unchanged) AND `imageRefs = extractImageRefs(obj)`.
       - Move the isMeta skip earlier or keep as-is — doesn't matter since meta is orthogonal (leave the existing order).
       - Adjust the empty-content skip: only skip on `content === ""` when `imageRefs.length === 0`. If images are present, DO NOT skip on empty text.
       - Adjust the harness_wrapper skip: only apply the wrapper-only skip when `imageRefs.length === 0`. If images are present, DO NOT skip on wrapper text (edge case per scope_detail).
       - If `imageRefs.length > 0`, return `{kind:"image", role, images: imageRefs, text: content, eventId, ts}`. Role derivation: if `type === "assistant"` → `"assistant"`; if `type === "user"` AND the content array contains any tool_result block with image → `"tool_result"`; if `type === "user"` with a bare image → `"user"`. Simplest rule: check whether ANY imageRef has a `toolUseId` — if so role is `"tool_result"`; otherwise use `isUser ? "user" : "assistant"`.
       - Otherwise fall through to the existing text-message return (unchanged).

    Create `src/backend/claude-session/session-file-parser.test.ts` using vitest (`import { describe, it, expect } from "vitest"`) and import `parseSessionLine` from `./session-file-parser.js` (matching existing test import style — check e.g. `src/backend/utils/field-crypto.test.ts` for the exact `.js`-suffix pattern used elsewhere in the backend). Each test constructs a synthetic JSONL object as a JS literal, `JSON.stringify`s it, passes to `parseSessionLine`, asserts the returned discriminated-union shape. Use short placeholder b64 strings ("AAA", "BBB", etc.) — real b64 shape is not what these tests are validating; they're validating extraction and discrimination.

    Verification: `npm test -- session-file-parser` runs the new test file with all 9 cases green.
  </behavior>
  <verify>
    <automated>cd /home/ubuntu/termix && npm test -- session-file-parser 2>&1 | tail -30</automated>
  </verify>
  <done>
    - `src/backend/claude-session/session-file-parser.ts` exports `ImageBlock`, `ImageMessage`, extended `ParsedLine`, and `extractImageRefs`.
    - Top-of-file HARD LOCK comment mentions the patch #86 image exception.
    - `session-file-parser.test.ts` runs all 9 tests (canonical, bare, CC-local, dedup, mixed text+image, multi-image, no-image regression, harness_wrapper without/with images) — all pass under `npm test -- session-file-parser`.
    - `npm run build` (or equivalent TypeScript check) succeeds — no `any`, no untyped indexing errors.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Emit type:"image" WS frame from claude-session-server, add ImageEvent to WS API union</name>
  <files>src/backend/claude-session/claude-session-server.ts, src/ui/api/claude-session-api.ts</files>
  <action>
    Backend — `src/backend/claude-session/claude-session-server.ts`:

    1. Update the wire-protocol comment block at the top of the file (the block ending "Any future scope creep here should touch this comment first."). Add a new line inside the `server -> client:` list, next to the existing `{type: "message", ...}` line:
       `{ type: "image", role, images, text, eventId, ts }        // per parsed JSONL turn carrying base64 image content (patch #86, WS-inline b64)`
       Where `images` is `Array<{ data: string, mediaType: string, toolUseId?: string }>` — data is raw base64 (no `data:` prefix; frontend adds it).
       Add a short paragraph under the wire-protocol section explaining: "Image frames carry inline base64 payloads. Payload size ~150KB per typical PNG Read is acceptable for the read-only sessions pretty-view targets; no HTTP fallback endpoint exists (WS-only architecture)."

    2. In the `onLine` handler, extend the terminal dispatch block that emits the text message frame. Locate the `if (parsed.kind === "message")` block near the end of `onLine` (currently around line 603-617). Immediately AFTER that block, add a parallel `if (parsed.kind === "image")` block that:
       - Constructs and sends `{ type: "image", role: parsed.role, images: parsed.images, text: parsed.text, eventId: parsed.eventId, ts: parsed.ts }` via `ws.send(JSON.stringify(...))`.
       - Wrapped in the same try/catch-empty pattern as the message send (guarding against mid-close WS).
       - Do NOT emit both `type:"message"` AND `type:"image"` for the same parsed line — the parser now returns exactly one kind per line, so the two if-branches are mutually exclusive.
    3. Do NOT touch the raw-line pre-scan loops for backgroundedAgents / backgroundedShells / plan_pending / task-notification / /exit — those operate on raw JSONL line content and are orthogonal to the parser's semantic classification. Image bubbles do NOT participate in any of those correlation maps.
    4. No changes to teardownPane, no changes to state machine, no changes to pollers. This is purely an additional emit branch and a comment update.

    Frontend types — `src/ui/api/claude-session-api.ts`:

    5. Add an exported `ImageBlock` type mirroring the parser's:
       `export type ImageBlock = { data: string; mediaType: string; toolUseId?: string; };`
    6. Add an exported `ImageEvent` type:
       `export type ImageEvent = { type: "image"; role: "user" | "assistant" | "tool_result"; images: ImageBlock[]; text: string; eventId: string; ts: number; };`
    7. Add `ImageEvent` to the `ClaudeSessionServerEvent` discriminated union, placed alphabetically-adjacent to `MessageEvent` (e.g. right after `MessageEvent` in the union list).
    8. Do NOT rename `MessageEvent` — the alias `ChatMessageEvent` used in PrettyView.tsx (`import { ... MessageEvent as ChatMessageEvent } from "@/api/claude-session-api"`) must remain valid.

    Verification:
    - TypeScript compile passes: `npm run build` succeeds (the union addition + new emit must be well-typed both sides).
    - The existing parser test suite still passes (no regressions).
    - Optional hand-verify (not required in `done`): run `wscat` against the local backend against a session with image events to confirm a `{type:"image",...}` frame lands on the wire. This is a nice-to-have not gated in `<verify>` because backend-live-test requires a running Termix dev instance + SSH creds.
  </action>
  <verify>
    <automated>cd /home/ubuntu/termix && npm run build 2>&1 | tail -20</automated>
  </verify>
  <done>
    - Wire-protocol comment block in claude-session-server.ts documents the new `type: "image"` frame with its shape and payload-size rationale.
    - onLine has an additional `if (parsed.kind === "image")` branch that sends the frame.
    - claude-session-api.ts exports `ImageBlock` and `ImageEvent` and includes `ImageEvent` in `ClaudeSessionServerEvent`.
    - `npm run build` succeeds — no TS errors from either side of the wire.
    - Existing `commandTags.test.ts` + all other tests still pass under `npm test`.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Create ImageBubble component + wire type:"image" case in PrettyView</name>
  <files>src/ui/features/pretty-view/ImageBubble.tsx, src/ui/features/pretty-view/PrettyView.tsx</files>
  <action>
    Create `src/ui/features/pretty-view/ImageBubble.tsx`:

    1. Component signature: `export function ImageBubble({ role, images, text, eventId, ts }: { role: "user" | "assistant" | "tool_result"; images: ImageBlock[]; text: string; eventId: string; ts: number; })`. Import `ImageBlock` from `@/api/claude-session-api`. Import `cn` from `@/lib/utils`.
    2. Aesthetic rule (per scope_detail Ashley 2026-07-19 design read): ALWAYS use the assistant identity-hue treatment, regardless of `role`. Semantically the Read was invoked by the assistant so the image lives on the assistant side. Left-aligned row wrapper (`flex justify-start`).
    3. Outer row: `<div className="flex justify-start">`.
    4. Inner bubble:
       - Layout: `max-w-[min(85%,640px)]`, `rounded-[var(--radius-pv-bubble)]`, `px-3 py-3` (12px padding per scope_detail), `flex flex-col gap-2`.
       - Glass: `backdrop-blur-xl saturate-150 [-webkit-backdrop-filter:blur(20px)_saturate(1.6)]`.
       - Border + bg (assistant identity-hue treatment, byte-identical to ChatMessage assistant branch): `border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]` + `bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]` + `text-[#fbf5e8]` + `shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.18)_inset,_0_0_0_0.5px_hsla(var(--pv-id-hue),70%,55%,0.2),_0_0_32px_hsla(var(--pv-id-hue),70%,52%,0.18)]`.
       - Font: same Inter override as ChatMessage (`font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]`).
    5. Bubble content (top-to-bottom):
       - Caption line: small monospace text, `text-xs font-mono opacity-70`, content: `` `${role === "tool_result" ? "tool_result" : role} · ${images.length} image${images.length === 1 ? "" : "s"}` ``.
       - Optional text line: only render when `text.trim() !== ""`. Class: `text-sm break-words`, content: the text as plain text (no markdown — image bubbles are not prose surfaces, per findings.md § patch #47 note). Preserve whitespace with `whitespace-pre-wrap`.
       - Images: iterate `images.map((img, i) => <img key={i} src={`data:${img.mediaType};base64,${img.data}`} alt={`image ${i + 1}`} className="max-w-full max-h-[480px] object-contain rounded" />)`. Use index-based key — image order within a single event is stable within the parser's emit, and the parent list already dedups on eventId.
       - Meta line: small monospace text, `text-xs font-mono opacity-70`, content: `` `${eventId.slice(0, 8)} · ${new Date(ts).toLocaleTimeString()}` `` (short event-id prefix + local time, mirroring the diagnostic-friendly-but-unobtrusive tone of other pretty-view metadata).
    6. Do NOT wire click-to-zoom (out of scope per constraints). Do NOT wire filename caption from tool_use correlation (out of scope). Do NOT add ! important overrides — this is a plain div wrapper, not shadcn.

    Wire in `src/ui/features/pretty-view/PrettyView.tsx`:

    7. Import the new component: `import { ImageBubble } from "./ImageBubble";` (place alphabetically next to `ChatMessage`).
    8. Import the WS event type: extend the existing `import { ... } from "@/api/claude-session-api"` block to also import `ImageEvent` and `ImageBlock`.
    9. Extend the message stream state. Current `messages` state is `useState<ChatMessageEvent[]>([])`. Redefine as a UNION:
       - Add a type alias near `Status`: `type StreamEvent = ChatMessageEvent | ImageEvent;`.
       - Change `useState<ChatMessageEvent[]>` to `useState<StreamEvent[]>`.
       - Rename `appendDedup`'s param types to `StreamEvent` (it already dedups on `eventId` which both event types have).
    10. Add a new `case "image":` in the `ws.onmessage` switch (parallel to the existing `case "message":`), appending the parsed image event to the same `messages` array via `appendDedup(prev, parsed)`. Do NOT create a separate state channel — image bubbles interleave with text messages in strict wire order (this is the whole point of Ashley seeing "the agent read this image" at the correct chronological position in the conversation).
    11. In the `messages.map((m) => ...)` render inside the scroll container, branch on `m.type`:
        - `m.type === "message"` → existing `<ChatMessage key={m.eventId} role={m.role} content={m.content} />`.
        - `m.type === "image"` → new `<ImageBubble key={m.eventId} role={m.role} images={m.images} text={m.text} eventId={m.eventId} ts={m.ts} />`.
    12. Do NOT touch the WipBubble render logic, PlanPendingBubble logic, harnessTasks / backgroundedAgents / backgroundedShells / planPending state, SessionHoldingOverlay, ComposeBox, IdentityBadge — all unchanged.
    13. The `session_changed` handler already `setMessages([])` — the fresh tail's `-n +1` replay will re-hydrate both text AND image events, so this reset works correctly for the union type without further changes.

    Verification:
    - `npm run build` succeeds.
    - `npm test` full suite still passes (no test regressions).
    - Hand-verify NOT gated (requires live dev server + Ashley's fleet SSH), but the CLAUDE.md GSD Workflow / Nginx caveat is not relevant here (no new backend HTTP routes — WS-only).
  </action>
  <verify>
    <automated>cd /home/ubuntu/termix && npm run build 2>&1 | tail -20 && npm test 2>&1 | tail -30</automated>
  </verify>
  <done>
    - `src/ui/features/pretty-view/ImageBubble.tsx` exists and renders the assistant identity-hue-tinted glass bubble matching ChatMessage assistant treatment.
    - `src/ui/features/pretty-view/PrettyView.tsx` has `case "image":` in the ws.onmessage switch, a `StreamEvent` union for `messages` state, and a `m.type === "image"` render branch in the map.
    - `npm run build` succeeds.
    - `npm test` (full suite) still passes.
    - Bubble aesthetic tokens match ChatMessage assistant branch byte-for-byte (gradient, border, shadow) apart from the 12px padding difference — same identity-hue treatment.
  </done>
</task>

</tasks>

<verification>
End-to-end verification (all automated):

1. `cd /home/ubuntu/termix && npm test -- session-file-parser` — 9 new tests pass, existing tests unchanged.
2. `cd /home/ubuntu/termix && npm run build` — clean TypeScript build across backend + frontend.
3. `cd /home/ubuntu/termix && npm test` — full test suite passes (no regressions in commandTags, terminal-syntax-highlighter, or any other pretty-view / backend test file).

Optional live-run hand-verification (NOT gated — requires deploy which is out of scope):
- Open pretty view against a pane with a recent PNG Read → verify:
  - image renders inline with visible pixels (not a broken-image icon)
  - bubble is left-aligned with the assistant identity hue (color-shifts per pane identity — Amelia vs Tina panes look different)
  - caption reads e.g. "tool_result · 1 image"
  - a multi-image tool_result (e.g. subagent returning 2 screenshots) renders both `<img>`s in ONE bubble
</verification>

<success_criteria>
All three tasks' `<done>` bullets satisfied. Verification block's three automated commands green.

Aesthetic acceptance criterion (visual, not gated): Ashley's identity-hue lives on the image bubble. Confirmed structurally by the ImageBubble's tokens being byte-identical to ChatMessage's assistant branch (gradient / border / shadow), differing only in padding (12px vs 18/14px). No neutral-gray fallback anywhere in the component.
</success_criteria>

<output>
Create `.planning/quick/260719-vil-add-pretty-view-image-support-patch-86-w/260719-vil-SUMMARY.md` when done.

Commit as a single patch conceptually labeled #86. Suggested commit message shape (per fork rebase-ability constraint — feature commits are numbered):

```
feat(pretty-view): image support (patch #86, WS-inline b64)

Extend the JSONL parser with a kind:"image" variant, forward it as a
new {type:"image"} WS frame, and render as an ImageBubble matching
ChatMessage's assistant identity-hue treatment. Base64 payloads travel
inline over the existing WS (WS-only pretty-view architecture — no
HTTP endpoint to bolt onto). Non-image tool_results still drop
structurally (RENDER-01 hard-lock preserved).
```

Branch: stay on `feat/tab-title-from-tmux` — this adds to the existing 13-commit stack, do NOT create a new branch, do NOT deploy (per constraints: no build/docker/deploy; termix-patches.md write-up deferred to pin time).
</output>
