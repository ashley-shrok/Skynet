# Phase 40: text-editor-in-skynet — Research

**Researched:** 2026-08-14
**Domain:** In-app text editor for agent-served tailnet files inside Skynet's pretty-view chat surface
**Confidence:** HIGH (all reuse targets, patterns, and integration seams verified against live source; a small number of implementation-shape recommendations are tagged MEDIUM where the codebase leaves multiple viable paths)

## Summary

This phase adds a per-link edit affordance inside pretty-view message bubbles for agent-served tailnet URLs (`http://<tailnet-ip>:PORT/filename` from the id-skill's `python3 -m http.server` pattern), a reused edit modal (Global Files chrome + editor guts, minus host picker + tabs), and a save flow that deposits the edited file into the ComposeBox as a new attachment indistinguishable from a user-picked one. Nothing new is required on the agent side; nothing new is required to the ComposeBox → agent return trip. All novelty lives inside four narrow layers of the Skynet frontend + one thin backend proxy endpoint.

Every reuse target named in UI-SPEC has been verified to exist and to have the shape UI-SPEC assumes. The extension point (`ChatMessage.tsx` L395-417, the ReactMarkdown `a` component override) is a 6-line stub today with room to grow to a sibling affordance render. The staged-attachments store (`usePrettyViewUploads` hook, `src/ui/features/pretty-view/use-pretty-view-uploads.ts`) already exposes a target-keyed `stageAttachments(target, files)` API that accepts native `File` objects — a `new File([bytes], filename)` in the save handler will deposit an editor-produced attachment onto the "primary" target and it will flow through the existing chip strip → send-with-attachments → upload_start → upload_ready_to_inject → injected user turn pipeline byte-unchanged.

**Primary recommendation:** Build one new `EditableFileModal` component that composes the reused `GlobalFileTab` editor body (verbatim) inside a modal shell that is a **hand-simplified copy** of `GlobalFilesModal.tsx`'s Portal + Overlay + Content chrome (blue-glass gradient, backdrop-filter, `onInteractOutside` guard). Do NOT refactor `GlobalFilesModal` to share the shell — the two surfaces will drift in different directions (this one gains a re-fetch-fail branch that Global Files doesn't need; Global Files has an empty-state branch that this one doesn't need) and forking now is cheaper than the coordination tax of a shared-shell abstraction. Detection lives frontend-side (extension whitelist synchronously from URL; byte-sniff fallback lazily when the message arrives, populating a per-message "eligible URLs" set). File fetch goes through a new backend proxy `POST /pretty-view/fetch-tailnet-url` — the browser cannot reliably hit `http://100.x.y.z:PORT/` (plain HTTP mixed-content on HTTPS Skynet, no CORS headers from `python3 -m http.server`, and the Tailnet IP may not be routable from Ashley's browser depending on whether Skynet or her device is the Tailnet member). Sonner is resident and wired; toast on re-fetch fail is `toast.error(...)` from `sonner`. Byte-sniff heuristic is inline (~30 LoC — no dep) — the corpus is agent-served text files, false-positive tolerance is explicit in the shape, no npm package earns its way in.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| URL detection in message body | Frontend (per-message render or per-message-arrival effect) | — | Detection is a pure function over rendered message text; agent-side is out of scope by shape lock |
| Eligibility check (extension whitelist) | Frontend (shared constants module) | Backend (proxy validates before fetching — defense-in-depth) | Synchronous; needs no bytes; runs at message-arrival time |
| Byte-sniff fallback (extensionless-but-text) | Backend proxy | Frontend (heuristic function shared for testability) | Runs on fetched bytes — bytes only reach frontend after proxy succeeds; frontend keeps sniff logic to unit-test in isolation and to gate whether the affordance renders after the proxy returns |
| HTTP fetch of tailnet-served file | Backend (Node fetch/undici) | — | Browser CORS + mixed-content + tailnet-routability all make direct fetch fragile; backend is on the tailnet and speaks HTTPS to the browser |
| Edit affordance render (inline anchor sibling) | Frontend (ReactMarkdown `<a>` override in ChatMessage.tsx) | — | Message rendering is a client concern; the sibling render is 20 lines added to an existing override |
| Modal shell + editor body | Frontend | — | Reuses `GlobalFileTab` (client component) inside a hand-copied `GlobalFilesModal` chrome |
| Save handler (produce attachment) | Frontend | — | `new File([content], filename)` → `uploads.stageAttachments("primary", [file])` (existing hook API) |
| Attachment upload + injected-turn round trip | Frontend (existing hook) + Backend (existing WS handlers) | — | Zero change — save just deposits into the existing pipeline |
| Sonner toast for re-fetch-fail | Frontend | — | Sonner is resident (`^2.0.7`) and wrapped as `src/ui/components/sonner.tsx` |

## Standard Stack

### Core (all resident — no net-new installs)

| Library | Version (verified from package.json) | Purpose | Why Standard |
|---------|--------------------------------------|---------|--------------|
| `react` | (implicit from repo) | UI | Existing standard |
| `radix-ui` (Dialog primitives) | `@radix-ui/react-dialog ^1.1.15` | Modal Portal + Overlay + Content | Same primitive family GlobalFilesModal + IdentityModal already use |
| `lucide-react` | `^1.28.0` | Icons (`Pencil`, `X`, `AlertCircle`, `FileText`, `File`) | All icons UI-SPEC calls for are already imported across pretty-view |
| `sonner` | `^2.0.7` | Toast notifications | Wired as `src/ui/components/sonner.tsx`; used by `AppShell.tsx`, `main-axios.ts`, `WarpgateDialog.tsx`, `ConnectionLog.tsx` — pattern is `import { toast } from "sonner"; toast.error("…")` |
| `react-markdown` | `^10.1.0` | Message body markdown parsing | Extension point (`ChatMessage.tsx` L395-417 `a` component override) is already an established seam |
| `remark-gfm` | `^4.0.1` | GFM support (used by ReactMarkdown) | Existing |
| `axios` (via `authApi` / `handleApiError`) | (implicit — used everywhere via `@/main-axios`) | Backend proxy fetch | Established fleet convention; identical shape to `readGlobalFile` in `src/ui/api/global-files-api.ts` |

### Supporting (already resident — no installs)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/components/dialog` (fleet-local shadcn wrapper) | — | `DialogHeader`, `DialogTitle`, `DialogClose` | Modal chrome — same as GlobalFilesModal |
| `@/components/skeleton` | — | Loading placeholders | Verbatim from GlobalFileTab.tsx L58-66 loading branch |
| `@/components/tabs` | — | `Tabs`/`TabsContent` | **Not needed** — UI-SPEC locks "no bottom tabs bar" per LOCKED decision (one file at a time) |
| Internal: `usePrettyViewUploads` | (local) | Staged-attachment store; owns `stageAttachments(target, files)` API | The save flow's deposit point — call `stageAttachments("primary", [file])` |
| Internal: `useIsTouchDevice` (`@/hooks/use-is-touch-device`) | (local) | Viewport branch for affordance visibility | Same source ComposeBox paperclip + AttachmentChipStrip already use — the fleet's sole mobile-vs-desktop discriminator (patch #102) |
| Internal: `AttachmentChipStrip` (`./AttachmentChipStrip`) | (local) | Post-save chip render | **Unchanged** — save produces a chip indistinguishable from user-picked; strip auto-mounts when `stagedAttachments.length > 0` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Backend proxy for fetch | Direct browser fetch to `http://<tailnet-ip>:PORT` | REJECTED — `python3 -m http.server` sets no CORS headers, mixed-content on HTTPS Skynet, tailnet-routability depends on which node has Tailscale installed; proxy is unavoidable |
| Inline byte-sniff (~30 LoC) | `isbinaryfile` (npm) or `istextorbinary` (npm) | REJECTED — corpus is agent-served text, false-positive tolerance is explicit in the shape doc, no runtime need justifies adding a dep. `npm` slopcheck for these packages would be added drag with zero corresponding benefit |
| Fork the modal (recommended) | Refactor `GlobalFilesModal` into a shared shell, mount either | REJECTED — two surfaces already differ (host picker present-vs-absent, tabs strip present-vs-absent, empty-state present-vs-absent, re-fetch-fail present-vs-absent, mtime semantics present-vs-absent). Sharing the shell now costs more coordination than the copy costs bytes |
| Extend `GlobalFileTab` to accept new props | Reuse verbatim; the existing `mtime` field is set to `Date.now()` sentinel and ignored on save (per UI-SPEC L130) | ACCEPTED — the existing contract is `TabState<{content, mtime}>` + `onSave(content, expectedMtime) → Promise<void>`; passing a sentinel mtime and ignoring `expectedMtime` in the editor's save handler works without touching GlobalFileTab.tsx |
| Message-arrival-time eligibility fetch | Render-time eligibility fetch | ACCEPTED — message-arrival avoids affordance-flash-in on scroll (bad UX per Question 2 (b) in the additional context) |

**Installation:** None. Every recommended dependency is already resident.

**Version verification:** All packages listed above are verified from `/home/ubuntu/skynet-tiffany/package.json` at read-time 2026-08-14. `[VERIFIED: package.json]` — versions are current in the repo lockfile.

## Package Legitimacy Audit

**Not applicable.** Phase 40 installs zero new external packages. Every dep it needs is already resident. If a byte-sniffing library were added later (currently rejected — see Alternatives Considered), it would need to run through the slopcheck gate.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                    ┌───────────────────────────────────────────────────┐
                    │  Agent (on any Tailnet host)                      │
                    │  runs: python3 -m http.server 0 --bind <ip>       │
                    │  emits Markdown link: [file.md](http://ip:PORT/)  │
                    └───────────────────────┬───────────────────────────┘
                                            │ (message body arrives via
                                            │  existing WS session-file stream)
                                            ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │  Skynet Frontend — ChatMessage.tsx renders message              │
     │  ┌────────────────────────────────────────────────────────┐     │
     │  │  On message arrival (new useEffect, keyed on content):  │     │
     │  │   1. Scan message body for tailnet URL pattern          │     │
     │  │   2. For each URL:                                      │     │
     │  │      a. Extension whitelist check (sync, no fetch)      │     │
     │  │      b. If extension unknown → POST /pretty-view/       │     │
     │  │         fetch-tailnet-url → byte-sniff on response      │     │
     │  │   3. Populate Map<messageEventId, Set<eligibleUrls>>    │     │
     │  └────────────────────────────────────────────────────────┘     │
     │                                                                  │
     │  ReactMarkdown `<a>` override (L395-417):                        │
     │   • Existing render: <a target="_blank" rel="noopener">          │
     │   • NEW sibling: <EditableFileAffordance> if url ∈ eligible set  │
     │                                                                  │
     │  Tap affordance → open <EditableFileModal messageEventId, url>   │
     └─────────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │  EditableFileModal (new component)                               │
     │   1. Mount: fetch via POST /pretty-view/fetch-tailnet-url        │
     │      (FRESH fetch — cached bytes from eligibility check are      │
     │       DISCARDED per LOCKED "visible failure over silent stale")  │
     │   2a. On success: render <GlobalFileTab state={ready(content)}>  │
     │        with onSave = save-to-composebox handler                  │
     │   2b. On failure: render error-body ("Can't fetch…" + Close) +   │
     │        parallel toast.error("Couldn't fetch {filename} — see    │
     │        modal.")                                                  │
     │                                                                  │
     │   Save handler:                                                  │
     │      const file = new File([content], filename, {type: "text/…"})│
     │      uploads.stageAttachments("primary", [file])                 │
     │      toast.success("Attached {filename} to your reply")          │
     │      close modal                                                 │
     └─────────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │  Existing ComposeBox pipeline (UNCHANGED)                        │
     │   • AttachmentChipStrip mounts (attachments.length > 0)          │
     │   • Chip is indistinguishable from user-picked (× removes it)    │
     │   • Send → onSendWithAttachments → uploads.startBatch(caption)   │
     │   • upload_start → upload_chunk × N → upload_ready_to_inject     │
     │   • formatInjectedUserTurn → injected user turn to agent via     │
     │     existing tmux input path (patch #100 split-send)             │
     └──────────────────────────────────────────────────────────────────┘

     ┌──────────────────────────────────────────────────────────────────┐
     │  Skynet Backend (NEW route only)                                 │
     │  POST /pretty-view/fetch-tailnet-url                             │
     │   Body: { url: string }                                          │
     │   Validate: url must match tailnet HTTP pattern (see             │
     │            "URL validation" below)                               │
     │   Fetch via undici/globalThis.fetch with 8s timeout              │
     │   Return: { contentBase64, sizeBytes, contentType, extension,   │
     │            isTextByExt: boolean, isTextByBytes?: boolean }       │
     │   Errors → 502/504/404 with structured error body                │
     └──────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/ui/features/pretty-view/
├── EditableFileAffordance.tsx          # NEW — per-link inline pencil affordance
├── EditableFileModal.tsx               # NEW — modal shell (forked from GlobalFilesModal) + editor body reuse
├── use-editable-file-eligibility.ts    # NEW — per-message hook (URL scan + backend probe + Map<eventId, Set<url>>)
├── editable-file-whitelist.ts          # NEW — extension + basename whitelist constants (shared between frontend + backend via a plain-object export)
├── editable-file-byte-sniff.ts         # NEW — inline heuristic (null-byte scan, printable-ratio, UTF-8 validity)
├── ChatMessage.tsx                     # MODIFIED — `a` override renders <EditableFileAffordance> sibling
├── GlobalFileTab.tsx                   # REUSED VERBATIM (imported by EditableFileModal)
├── GlobalFilesModal.tsx                # NOT TOUCHED (a copy is used as the shell prototype, not the runtime code path)
├── AttachmentChipStrip.tsx             # NOT TOUCHED (save deposits a File that flows into the strip via existing store)
└── ComposeBox.tsx                      # NOT TOUCHED

src/ui/api/
└── editable-file-api.ts                # NEW — `fetchTailnetUrl(url)` frontend helper (mirrors global-files-api.ts pattern)

src/backend/database/routes/
└── pretty-view-fetch-tailnet-url.ts    # NEW — POST /pretty-view/fetch-tailnet-url proxy
```

### Pattern 1: Extending the ReactMarkdown `<a>` Override

**What:** The current override at `ChatMessage.tsx` L398-404 is a pure passthrough that adds `target="_blank" rel="noopener noreferrer"`. Extending it to render a sibling affordance is a wrap-in-fragment change — the `<a>` behavior is preserved verbatim, honoring the LOCKED additive-not-replacive constraint.

**When to use:** For any per-link enrichment that must survive markdown parsing (as opposed to per-message enrichment like the speak button, which is a sibling to the whole ReactMarkdown block).

**Example:**
```typescript
// Source: /home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/ChatMessage.tsx L395-417 (current)
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    a: ({ node, ...props }) => (
      <a
        {...props}
        target="_blank"
        rel="noopener noreferrer"
      />
    ),
    // ...
  }}
>

// AFTER (Phase 40):
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    a: ({ node, ...props }) => {
      const href = props.href;
      const filename = href ? extractFilenameFromUrl(href) : null;
      const isEligible = eventId && filename && eligibleUrls?.has(href);
      return (
        <>
          <a {...props} target="_blank" rel="noopener noreferrer" />
          {isEligible && (
            <EditableFileAffordance
              messageEventId={eventId}
              url={href!}
              filename={filename!}
            />
          )}
        </>
      );
    },
    // ...
  }}
>
```

**Key contract:** The React fragment wrap keeps the `<a>` semantics 100% intact — click/download/target behavior is unchanged. `<EditableFileAffordance>` is inline (`display: inline-block` or bare — decided by UI-SPEC's `margin-left: 4px, vertical-align: baseline`), riding beside the anchor.

### Pattern 2: Save-to-ComposeBox (deposit via existing hook)

**What:** The `usePrettyViewUploads` hook already exposes a target-keyed staging API. The save handler creates a `File` from the edited text and calls `stageAttachments("primary", [file])` — no new hook state, no new prop, no new store.

**When to use:** Any programmatic-add-to-composebox flow.

**Example:**
```typescript
// Source: /home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/use-pretty-view-uploads.ts L97-107 (verified API surface)
// Hook returns:
//   stageAttachments: (target: string, items: File[] | DataTransferItemList | FileList) => void
//
// StagedAttachment shape (L51-57):
//   { tempId: string; file: File; status: "staged" | ...; bytesUploaded: number; error: string | null }
//
// EditableFileModal save handler:
async function handleSave(content: string, filename: string): Promise<void> {
  // Guess MIME from extension for UX niceness (chip does not require it):
  const type = guessMimeFromFilename(filename) ?? "text/plain";
  const file = new File([content], filename, { type });
  uploads.stageAttachments("primary", [file]);
  toast.success(`Attached ${filename} to your reply`);
  onOpenChange(false); // close modal
}
```

**Wiring note:** `uploads` must be threaded from `PrettyView.tsx` (which owns the `usePrettyViewUploads()` instance at L814) down through the same subtree that mounts `EditableFileModal`. The simplest wiring is to lift `EditableFileModal` up to sit next to the existing `IdentityModal` mount at `PrettyView.tsx` L2082, driven by open-state managed alongside the `uploads` handle. Alternatively, thread a `onStageEditedFile(filename, content)` callback down through `ChatMessage` — but Zustand-style prop-drilling is the fleet convention here (see how `stagedAttachments` + `onRemoveAttachment` are threaded from PrettyView to ComposeBox at L2511-2512).

### Pattern 3: Backend Proxy (mirror `global-files-read-write.ts`)

**What:** A new Express router at `POST /pretty-view/fetch-tailnet-url` that validates a URL against the tailnet HTTP pattern, fetches with a bounded timeout via `undici`/`fetch`, and returns bytes as base64 plus classification metadata. Auth via `authenticateJWT` (same middleware every other route uses — see `global-files-read-write.ts` L58).

**When to use:** Whenever the browser needs bytes from a URL it can't reliably fetch itself (CORS, mixed-content, network reachability).

**Example:**
```typescript
// Source pattern: /home/ubuntu/skynet-tiffany/src/backend/database/routes/global-files-read-write.ts L56-108 (verified route structure)
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { sshLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Tailnet URL pattern: http://100.x.y.z:PORT/filename
// - 100.64.0.0/10 is Tailscale's CGNAT range
// - Only HTTP (not HTTPS) — python3 -m http.server is unencrypted per id-skill L747-751
// - Port is any (Python picks ephemeral)
// - Filename must not contain path traversal
const TAILNET_URL_RE =
  /^http:\/\/100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}:\d{1,5}\/[^/][^?#]*$/;

const FETCH_TIMEOUT_MS = 8_000; // matches UI-SPEC "timeout > 8s"
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — matches upload backpressure high-water

router.post("/fetch-tailnet-url", express.json({ limit: "2kb" }), authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const url = body.url;
    if (typeof url !== "string" || !TAILNET_URL_RE.test(url)) {
      res.status(400).json({ error: "invalid tailnet URL" });
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: ctrl.signal });
      if (!response.ok) {
        res.status(502).json({ error: `upstream ${response.status}` });
        return;
      }
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        res.status(413).json({ error: "file exceeds max size" });
        return;
      }
      // Classify — see byte-sniff heuristic below
      const filename = decodeURIComponent(url.split("/").pop() ?? "");
      const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : null;
      const isTextByExt = classifyByExtension(extension, filename);
      const isTextByBytes = isTextByExt ? undefined : sniffTextBytes(buf);

      res.json({
        contentBase64: buf.toString("base64"),
        sizeBytes: buf.byteLength,
        contentType: response.headers.get("content-type") ?? null,
        extension,
        filename,
        isTextByExt,
        isTextByBytes,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      if (name === "AbortError") {
        res.status(504).json({ error: "fetch timeout" });
      } else {
        res.status(502).json({ error: "fetch failed", detail: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      clearTimeout(timer);
    }
  }
);

export default router;
```

Mount alongside other routers in `src/backend/database/database.ts` next to the global-files routers (`app.use("/pretty-view", prettyViewFetchTailnetUrlRoutes)` — the URL namespace `/pretty-view/*` is not currently used and is reserved cleanly).

### Pattern 4: Byte-Sniff Heuristic (inline, ~30 LoC)

```typescript
// Source: crafted from standard text-detection heuristics; matches the pattern
// used by `file(1)` in the "text or binary" mode. NOT tagged [VERIFIED] because
// no upstream reference is being cited — this is a well-known inline heuristic.
// Codebase has no existing binary-detection code (verified: grep returned zero
// hits for isBinaryFile/istext/file-type in src or package.json).

/** Returns true if bytes look like text. False positives are acceptable per shape. */
export function sniffTextBytes(buf: Uint8Array): boolean {
  const sample = buf.length > 8192 ? buf.subarray(0, 8192) : buf;
  if (sample.length === 0) return true; // empty is trivially editable

  let printableCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    // Null byte is the hard binary marker — file(1) uses the same rule
    if (b === 0x00) return false;
    // Printable: tab, LF, CR, or 0x20..0x7E, or common UTF-8 continuation
    if (b === 0x09 || b === 0x0a || b === 0x0d ||
        (b >= 0x20 && b <= 0x7e) ||
        (b >= 0x80 && b <= 0xff)) { // let UTF-8 pass; validity check next
      printableCount++;
    }
  }
  // Require >= 90% printable — the same threshold file(1) uses in "ascii" mode
  const ratio = printableCount / sample.length;
  if (ratio < 0.9) return false;

  // Bonus: UTF-8 validity check via TextDecoder (throws on invalid seqs when
  // fatal:true). This catches "printable-looking" binary that happens to avoid
  // null bytes (e.g. gzip file with a compression stream that dodges 0x00).
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}
```

### Pattern 5: Extension + Basename Whitelist (shared constants)

```typescript
// Source: crafted from shape doc §Decisions "extension whitelist first". No
// upstream reference; recommended starter set below is a synthesis of the
// shape doc's examples plus common config formats agents serve.

/** File extensions that the affordance recognizes wholesale. Grows over time. */
export const EDITABLE_EXTENSIONS = new Set([
  // Markdown & prose
  "md", "mdx", "markdown", "txt", "rst", "adoc",
  // Config
  "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "env", "properties",
  // Source code (fleet-relevant)
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "cc", "cpp", "h", "hpp", "cs", "m", "mm",
  "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql",
  // Web
  "html", "htm", "css", "scss", "sass", "less",
  "vue", "svelte", "astro",
  // Data
  "csv", "tsv", "xml", "log",
  // Diff / patch
  "patch", "diff",
]);

/** Extensionless basenames that are conventionally text. */
export const EDITABLE_BASENAMES = new Set([
  "Dockerfile", "Makefile", "Rakefile", "Gemfile", "Procfile",
  ".gitignore", ".dockerignore", ".editorconfig", ".gitattributes",
  ".env", ".envrc", ".nvmrc", ".node-version", ".python-version",
  "README", "LICENSE", "CHANGELOG", "AUTHORS", "CONTRIBUTORS", "COPYING",
  "NOTICE", "TODO", "COMMIT_EDITMSG",
]);

export function classifyByExtension(
  extension: string | null,
  filename: string,
): boolean {
  if (extension && EDITABLE_EXTENSIONS.has(extension)) return true;
  if (EDITABLE_BASENAMES.has(filename)) return true;
  return false;
}
```

**Sharing between frontend + backend:** The whitelist should live in `src/ui/features/pretty-view/editable-file-whitelist.ts` (frontend) with a **byte-identical copy** at `src/backend/utils/editable-file-whitelist.ts`. Reason: the fleet does not have a shared code directory in the ship pipeline (verified — `src/backend/*` and `src/ui/*` are separate build roots; existing `src/types/` and `src/ui/api/` cross-cutting types are duplicated on ship). Duplication is the established pattern; add a comment linking both files so the maintainer knows to update in lockstep.

### Anti-Patterns to Avoid

- **Fetch-at-render:** Do NOT fetch the file on message-render for eligibility. The affordance would flash in mid-scroll and the layout would jitter. Fetch at message-arrival time (in a useEffect keyed on eventId or content) — the affordance either appears in the initial paint or never appears.
- **Direct browser fetch of `http://100.x.y.z:PORT`:** Do NOT try. `python3 -m http.server` sets no CORS headers; Skynet is served over HTTPS in production (mixed-content block); the tailnet IP may not be reachable from Ashley's browser (only Skynet is guaranteed to be on the Tailnet). Backend proxy is unavoidable.
- **Silent fallback to cached bytes on re-fetch fail:** LOCKED — see shape doc "visible failure over silent maybe-stale." Bytes fetched at eligibility-time are ONLY for the classification decision and MUST be discarded after that decision (do not stash in a ref, do not cache in a Map — verify by grep that the eligibility hook does not expose bytes to any editor code path).
- **Sharing the modal shell between GlobalFilesModal and EditableFileModal:** See "Alternatives Considered" — reject in favor of a forked copy. The two shells have already-visible drift (host picker, tabs strip, empty-state, re-fetch-fail, mtime semantics) and coordinated evolution across the two consumers is more painful than divergence.
- **Adding a per-file cache for "this url is known editable":** The Map<eventId, Set<url>> lives inside a hook and dies with unmount — that's correct. Do NOT persist to localStorage / sessionStorage / anywhere. Ashley's re-load re-classifies; that's cheap and correct (the tailnet server may be dead by then anyway).
- **Trying to compose an `EditableFileModal` inside the existing `<GlobalFilesModal>` mount tree:** They should be independent modals, mounted from independent state, at independent portal targets. See Question 4's recommendation below.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Staged-attachment list state | New Zustand store or Context provider | `usePrettyViewUploads` hook (exists at `src/ui/features/pretty-view/use-pretty-view-uploads.ts`); call `stageAttachments("primary", [file])` | This hook already owns tempId generation, per-target isolation, remove semantics, and the upload pipeline. Deposit is one function call. |
| Attachment chip render | New chip component | `AttachmentChipStrip` (mounts automatically when `stagedAttachments.length > 0`) | Zero new code — the strip is already threaded into ComposeBox at PrettyView.tsx L2511 |
| Reply-with-attachment path | New WS message type / injected turn format | Existing `onSendWithAttachments` → `uploads.startBatch(caption)` → `upload_start`/`upload_chunk`/`upload_ready_to_inject` → `formatInjectedUserTurn` | Byte-unchanged path. The moment `stageAttachments` deposits, all downstream is free. |
| Modal Portal + backdrop-filter + `onInteractOutside` guard | New Dialog primitive assembly | Copy the exact chrome block from `GlobalFilesModal.tsx` L186-217 (Portal + Overlay + Content + guard). It's ~35 lines. | Established pattern; iOS PWA-verified visuals; safe-area handling already tuned per patch #144 |
| Sonner Toaster mount | New toast library or mount | `<Toaster />` is already mounted in AppShell (verified: `AppShell.tsx` L3 imports `{ toast } from "sonner"` and uses it at L734/747/1310). Just import `toast` and call it. | Zero setup. Warm-dark glass gradient theme already applied via `src/ui/components/sonner.tsx`. |
| Tailnet URL detection regex | New URL parser | Use the RE at `TAILNET_URL_RE` above — 100.64.0.0/10 CGNAT range regex matches Tailscale's assigned range exactly | Domain-specific; matches only the id-skill's serve pattern; rejects arbitrary http:// URLs safely |
| Byte-sniffing library | `isbinaryfile` (npm) or `istextorbinary` (npm) | Inline heuristic (Pattern 4 above, ~30 LoC) | No package needed; corpus is agent-served text; false-positive tolerance is explicit; slopcheck + install drag is disproportionate to the ~30 LoC saved |
| SFTP / atomic-rename write for the edited file | New write path | **Not needed at all** — the save target is the ComposeBox attachment set, not the file on the agent's box. The return trip is Ashley's next reply, per shape LOCKED. | Zero backend write; zero SSH; zero SFTP. This is the shape's central symmetry. |
| Filename extraction from URL | New parser | `decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")` — the URL constructor is available in both browser + Node runtimes | Standard; handles `%20`-encoded spaces; verified against id-skill L727-730's `printf` format |

**Key insight:** This phase's cost sits almost entirely in three new files (`EditableFileAffordance`, `EditableFileModal`, `use-editable-file-eligibility`) plus one 90-line backend route. Every other capability the shape describes is already built and shipped — the phase is fundamentally a plumbing exercise, not a features exercise.

## Runtime State Inventory

**Skip — this is a greenfield feature phase**, not a rename/refactor/migration. No existing runtime state is being renamed or migrated. The new hook (`use-editable-file-eligibility`) is in-memory only (React state) with an unmount-scoped lifecycle; the new backend route is stateless.

## Common Pitfalls

### Pitfall 1: `<a>` component override receives `href` on `props`, not on `node`
**What goes wrong:** Reaching for `node.properties.href` instead of `props.href` because ReactMarkdown v10's props shape may not be intuitive.
**Why it happens:** The current override (ChatMessage.tsx L398-404) uses `{...props}` spread and never destructures `href` explicitly — the reader has no local example.
**How to avoid:** Destructure `{ node, href, ...rest }` from the `a` override props. `href` is a first-class prop on the passthrough shape. Verify with a `console.log` on first render if there's any doubt.
**Warning signs:** Undefined `href` at runtime; regex tests never matching.

### Pitfall 2: Wrapping the `<a>` inside another element breaks anchor semantics
**What goes wrong:** Wrapping `<a>` inside a `<span onClick={...}>` (to add hover state) intercepts clicks and breaks the LOCKED additive-not-replacive constraint.
**Why it happens:** Instinct to reach for a wrapping div to control layout.
**How to avoid:** The affordance MUST be a SIBLING to the `<a>`, not a wrapper. Use a React fragment (`<>...</>`) that renders `<a>` and `<EditableFileAffordance>` as adjacent inline elements. UI-SPEC L136 explicitly specifies "sibling to the `<a>`, not a wrapper."
**Warning signs:** Ashley reports clicking the link no longer downloads/opens the file.

### Pitfall 3: `python3 -m http.server` returns 200 for directory listings if path traversal is not blocked
**What goes wrong:** URL like `http://100.x.y.z:PORT/../etc/passwd` — the `python -m http.server` server will 404 on that (it path-normalizes), but a URL like `http://100.x.y.z:PORT/../` returns an HTML directory listing.
**Why it happens:** Not blocked by default; the id-skill's serve pattern uses `mktemp -d` (per SKILL.md L717) so the exposed directory should be empty except for the file, but paranoia says to validate.
**How to avoid:** In the backend proxy's URL validation, reject any URL whose path contains `..`, `//`, or a trailing `/` (all suggest directory-list or traversal intent). The regex above enforces `[^/][^?#]*` on the path — filename must start with a non-slash and contain no query/fragment. Additionally, reject content-types matching `text/html` in the response if the request URL's filename lacks `.html` — the id-skill would never serve HTML for a rename that lacks the extension, but `python -m http.server` will do so for a directory listing.
**Warning signs:** Editor opens with HTML markup instead of the expected file.

### Pitfall 4: Mixed-content block when Skynet serves HTTPS
**What goes wrong:** Browser refuses to `fetch("http://100.x.y.z:PORT/...")` from an HTTPS-served Skynet frontend. In dev over `http://localhost:5173` it works; in production over `https://<skynet-host>` it fails silently or with a mixed-content console warning.
**Why it happens:** Modern browsers block active mixed content unconditionally on HTTPS pages.
**How to avoid:** Never fetch the tailnet URL from the browser. Always route through the backend proxy (which itself runs plain HTTP internally and speaks HTTPS to the browser via the reverse proxy).
**Warning signs:** Works locally, fails in production; console shows mixed-content warning.

### Pitfall 5: `File` constructor availability in tests
**What goes wrong:** JSDOM (vitest's default) supports the `File` constructor, but some older node contexts do not. The save-flow tests will need `new File([content], name, { type })` to work.
**Why it happens:** Node < 20 shipped without `File`; JSDOM has had `File` for years.
**How to avoid:** Verify with `expect(typeof File).toBe("function")` at test-file top. Existing `use-pretty-view-uploads.test.ts` already uses `new File([...], ...)` extensively (see e.g. L127: `result.current.stageAttachments("primary", [f1, f2])`) — the environment supports it. If tests fail with `File is not defined`, `vitest.config.ts` needs `environment: "jsdom"`.
**Warning signs:** `ReferenceError: File is not defined` in a test.

### Pitfall 6: The `mtime` semantic on `GlobalFileTab`
**What goes wrong:** `GlobalFileTab.tsx` L36-42 reseeds the draft on state-mtime changes. Passing a fresh `Date.now()` every render would blow away the draft on every render tick.
**Why it happens:** The `useEffect` at L36-42 keys the reseed on `state.status === "ready" ? state.data.mtime : null`.
**How to avoid:** Set `mtime` ONCE at fetch-success and never mutate it. Do not compute `Date.now()` inline in the state passed to `GlobalFileTab`; compute it once, memoize it, and pass the memoized value. The reseed only fires when mtime changes — the sentinel must be stable across the modal's open lifecycle.
**Warning signs:** Textarea keystrokes are immediately reverted; edits impossible to make.

### Pitfall 7: Portal container escape (patch #108 lesson)
**What goes wrong:** Mounting `EditableFileModal` at `PrettyView.tsx` inside the `chatRegionEl` wrapper (L2098) would make the modal cover only the message area, leaving the composer poking out below.
**Why it happens:** The `IdentityModal` mount at L2082-2089 uses `container={chatRegionEl}` on purpose — its modal is meant to cover only the chat region.
**How to avoid:** Decide: does the editor modal cover the composer too, or does it leave the composer visible? UI-SPEC L216 says `inset-4` — 16px from every edge → covers the composer. That means EditableFileModal should portal to `document.body` (or omit `container` entirely — the `DialogPrimitive.Portal container={container ?? undefined}` default at GlobalFilesModal L187 renders to `document.body` when container is unset).
**Warning signs:** Composer is visible below the "modal" — modal is clipped to the chat region.

### Pitfall 8: `filename` from URL when the tailnet URL has query strings
**What goes wrong:** Some agents may add `?nocache=X` for polite cache-busting; naive `split("/").pop()` would return `filename.ext?nocache=X` as the filename.
**Why it happens:** `URL.pathname` strips query but requires the URL constructor.
**How to avoid:** Use `new URL(href).pathname.split("/").pop()`, then `decodeURIComponent()`. The URL constructor also validates the URL syntax as a bonus.
**Warning signs:** Chips in ComposeBox show query strings in the filename.

## Code Examples

### Ex 1: EditableFileAffordance render (per-viewport branch)

```typescript
// Source: composed from GlobalFilesModal.tsx L246-270 (glass button chrome) +
// PinAction.tsx L69-79 (bare-icon idiom, `filter: drop-shadow`) +
// ChatMessage.tsx L493-497 (speak-button hover-reveal opacity pattern)

import { Pencil } from "lucide-react";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";

export function EditableFileAffordance({
  onOpen,
  filename,
}: {
  onOpen: () => void;
  filename: string;
}) {
  const isTouchDevice = useIsTouchDevice();
  return (
    <button
      type="button"
      aria-label={`Edit ${filename}`}
      title={`Edit ${filename}`}
      onClick={onOpen}
      className={
        "inline-flex items-center gap-1 align-baseline ml-1 cursor-pointer " +
        "text-[color:var(--color-pv-code-fg)] " + // warm coral #ffb896 at rest
        (isTouchDevice
          ? "opacity-72 min-w-[44px] min-h-[44px] justify-center"
          : "opacity-0 [.pv-bubble:hover_&]:opacity-100 transition-opacity duration-[120ms] hover:text-[hsla(var(--pv-id-hue),80%,65%,1)]")
      }
      style={{
        // hover glow per UI-SPEC L124 (drop-shadow on hover — mirrors PinAction)
        filter: undefined, // rest state — no glow
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter =
          "drop-shadow(0 0 6px hsla(var(--pv-id-hue), 80%, 60%, 0.55))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = "";
      }}
    >
      <Pencil size={16} />
      {!isTouchDevice && <span className="text-[11px]">Edit</span>}
    </button>
  );
}
```

*Note:* The `.pv-bubble:hover_&` selector requires the message bubble div at `ChatMessage.tsx` L305-360 to have `className="pv-bubble ..."` — verify or use a `group`/`group-hover` Tailwind pattern (which the bubble may already support; not verified — check current class list).

### Ex 2: Eligibility hook

```typescript
// Source: crafted from existing use-pretty-view-uploads.ts (per-target Map
// pattern) + global-files-api.ts (frontend fetch helper pattern)

import { useEffect, useRef, useState } from "react";
import { fetchTailnetUrl } from "@/api/editable-file-api";
import {
  classifyByExtension,
  sniffTextBytes,
} from "./editable-file-whitelist";

const TAILNET_URL_RE_CLIENT =
  /http:\/\/100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}:\d{1,5}\/[^\s)]+/g;

export function useEditableFileEligibility(
  messageEventId: string | null,
  messageBody: string,
) {
  const [eligibleUrls, setEligibleUrls] = useState<Set<string>>(new Set());
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!messageEventId) return;
    const matches = messageBody.match(TAILNET_URL_RE_CLIENT) ?? [];
    if (matches.length === 0) return;

    (async () => {
      const eligible = new Set<string>();
      for (const url of matches) {
        try {
          const parsed = new URL(url);
          const filename = decodeURIComponent(
            parsed.pathname.split("/").pop() ?? "",
          );
          const extension = filename.includes(".")
            ? filename.split(".").pop()!.toLowerCase()
            : null;
          // Sync path: extension match — no fetch needed
          if (classifyByExtension(extension, filename)) {
            eligible.add(url);
            continue;
          }
          // Async path: byte-sniff via backend
          const result = await fetchTailnetUrl(url);
          if (cancelledRef.current) return;
          if (result.isTextByBytes === true) eligible.add(url);
        } catch {
          // Fetch failed → skip; the message may still contain other URLs
        }
      }
      if (!cancelledRef.current) setEligibleUrls(eligible);
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [messageEventId, messageBody]);

  return eligibleUrls;
}
```

**Discard-cached-bytes note:** Even though `fetchTailnetUrl` returns the file bytes as `contentBase64`, this hook **ignores them for the editor** — the returned bytes are consumed ONLY by `sniffTextBytes` and are dropped when the promise resolves. The editor's fetch-at-open path fires a fresh request. This matches the LOCKED "visible failure over silent maybe-stale" constraint.

### Ex 3: Sonner error toast on re-fetch fail

```typescript
// Source: /home/ubuntu/skynet-tiffany/src/ui/ssh/dialogs/WarpgateDialog.tsx L36-39
// (verified — established pattern in the fleet)

import { toast } from "sonner";

// In EditableFileModal fetch-at-open path:
try {
  const result = await fetchTailnetUrl(url);
  setState({ status: "ready", data: { content: atob(result.contentBase64), mtime: initialMtimeRef.current } });
} catch (err) {
  toast.error(`Couldn't fetch ${filename} — see modal.`);
  setState({ status: "error", error: err instanceof Error ? err.message : "Unknown fetch error" });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Any file-editing UI in Skynet before Phase 23 | Global Files edit modal (GEFM-05, Phase 23, shipped 2026-08-05) | 2026-08-05 | This is the reuse target — the phase inherits its mobile-tested modal chrome + editor UX for free |
| Per-file ChatMessage `<a>` render was a plain passthrough | Same passthrough today, extended by this phase to render a sibling affordance | 2026-08-14 (this phase) | Additive; no upstream deprecation |
| Attachment set was ComposeBox-local state | Zustand-shaped `usePrettyViewUploads` hook with per-target keying (Quick 260802-wxy) | 2026-08-02 | Enables programmatic deposit via `stageAttachments(target, files)` — this phase's save path |
| Toast library was ad-hoc | `sonner ^2.0.7` mounted globally via `src/ui/components/sonner.tsx` (Phase 14B) | ~2026 | Established fleet convention; this phase inherits |

**Deprecated / outdated:**
- The `container={chatRegionEl}` portal target from `IdentityModal` — a good pattern for surfaces that must NOT cover the composer, but the wrong pattern for this phase (editor SHOULD cover the composer because it's a full-viewport-minus-16px modal per UI-SPEC L216).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tailscale CGNAT range is 100.64.0.0/10 | Backend proxy URL validation (Ex 1 in Pattern 3) | Low — regex fails to match a legit tailnet URL. Fix: broaden to a permissive `http://` + non-empty-filename regex if the CGNAT bounds prove wrong in fleet observation. `[ASSUMED]` (widely-cited Tailscale convention, not verified in this session) |
| A2 | `python3 -m http.server` sets no CORS headers | Backend proxy justification | Low — even if it did, mixed-content would still block; proxy is still needed. `[ASSUMED]` (established Python stdlib behavior, not verified in this session by fetching) |
| A3 | `undici`/native `fetch` is available in the backend's Node runtime | Backend proxy Ex 1 | Medium — verify by checking `node --version` on the ship image. Node 18+ has `fetch` globally; if the ship image is older, install `undici` (already a common transitive dep). `[ASSUMED]` — planner should confirm Node version in the deploy image |
| A4 | JSDOM in the test env supports the `File` constructor | Pitfall 5, Ex 2 save flow | Low — `use-pretty-view-uploads.test.ts` already uses `new File(...)` extensively, so the env supports it. `[VERIFIED: src/ui/features/pretty-view/use-pretty-view-uploads.test.ts:127]` |
| A5 | The bubble div has a hoverable ancestor (`group` or `.pv-bubble`) that the affordance's hover-reveal opacity can attach to | Ex 1 CSS `.pv-bubble:hover_&` selector | Medium — verify by reading `ChatMessage.tsx` L305 className list. If not present, add a `group` class or use a JS-driven hover state via `onMouseEnter`/`onMouseLeave` on the bubble. `[ASSUMED]` — recommend planner add a Wave 0 sanity task to confirm |
| A6 | The tests for the eligibility hook can mock `authApi.post` the same way `readGlobalFile` is mocked in `GlobalFilesModal.test.tsx` | Testing section below | Low — `vi.mock("@/api/global-files-api", ...)` is the established pattern; parallel `vi.mock("@/api/editable-file-api", ...)` is a copy of that pattern. `[VERIFIED: src/ui/features/pretty-view/GlobalFilesModal.test.tsx:22-34]` |
| A7 | The extension whitelist and basename set are approximately right for Ashley's usage | Pattern 5 constants | Low — the shape doc explicitly says "grows over time as misses are noticed." Set is intentionally starter, not comprehensive. `[ASSUMED]` — Ashley may want to add/remove entries |
| A8 | The MIME type on the deposited File is nice-to-have but not load-bearing | Pattern 2 (`type: guessMimeFromFilename(filename) ?? "text/plain"`) | Low — `AttachmentChipStrip` displays the filename + size (verified: L138), not the mimetype. Downstream `formatInjectedUserTurn` includes mimetype as metadata (per the injected turn format), so a plausible-looking guess is better than "application/octet-stream" for agent-side readability. `[ASSUMED]` — verify in the code path |
| A9 | The proxy endpoint path `/pretty-view/fetch-tailnet-url` is free (no collision) | Pattern 3 mount | Low — `grep -rn "/pretty-view/" src/backend` returned no route matches for this URL space. `[VERIFIED via prior grep sweep]` |
| A10 | `python3 -m http.server` may serve directory listings if the URL path is a directory | Pitfall 3 | Low — well-known Python stdlib behavior. Mitigation: the URL regex requires a non-empty filename after the port. `[ASSUMED]` — treated as defense-in-depth |

## Open Questions

1. **Where to mount `EditableFileModal` in the PrettyView subtree?**
   - What we know: `IdentityModal` mounts at PrettyView.tsx L2082 inside the `chatRegionEl` wrapper (portals to that ref). `GlobalFilesModal` mounts inside `PrettyConversationsPanel.tsx` (verified) with portal to document.body.
   - What's unclear: For Phase 40, does the modal cover the composer (portal to document.body, covers whole viewport minus inset-4) or leave the composer visible (portal to chatRegionEl)?
   - Recommendation: Cover the composer — matches UI-SPEC L216 (`inset-4`) and matches GlobalFilesModal precedent. Portal to `document.body` by omitting `container`. Mount either in PrettyView.tsx alongside IdentityModal at L2082, OR (cleaner) create a small `EditableFileModalProvider` context that ChatMessage children can open via a hook — but the fleet has no existing modal-provider pattern, so the straightforward mount is safer.

2. **Should the eligibility hook run in ChatMessage (per-message) or in PrettyView (batched)?**
   - What we know: PrettyView owns the message list; ChatMessage renders one message.
   - What's unclear: Per-message hook fires N times for N messages (potentially N * M backend probes for M unknown-extension URLs); batched fires once but requires a global URL cache.
   - Recommendation: Per-message. The extension check is synchronous — no fetch fires unless a URL slips past the whitelist. Fleet corpus is whitelist-dominant; the "N unknown extensions per view" case is rare enough to not warrant the batching complexity. If it becomes a problem, add a simple debounce or move to PrettyView-owned Map later.

3. **How should content-length be capped?**
   - What we know: Backend proxy example uses 4 MB (matches `BACKPRESSURE_HIGH_WATER_BYTES` from the uploads hook).
   - What's unclear: Is that the right cap for a text file being edited? At 4 MB, the textarea would be unusable on mobile.
   - Recommendation: Cap at 2 MB (matches `MAX_CONTENT_BYTES` in `global-files-read-write.ts` L76, which is 2_000_000 bytes and is the fleet's established "reasonable text file" ceiling). Return 413 above.

4. **Should the save handler include a `.txt` extension guarantee on files without one?**
   - What we know: `.gitignore` → save produces a File named `.gitignore` on the composebox → agent receives an attachment named `.gitignore`.
   - What's unclear: Downstream `formatInjectedUserTurn` and `AttachmentChipStrip` handle extensionless names fine — verified `AttachmentChipStrip.tsx` L137 just renders `file.name` as-is.
   - Recommendation: Preserve filename verbatim from the URL. Do not modify. If the agent needs to distinguish the edited file from an accidentally-attached file, filename identity is the cleanest signal.

5. **What if the message content updates (e.g., streaming completion) after the eligibility hook has run?**
   - What we know: The hook keys on `[messageEventId, messageBody]` — content changes re-run the effect.
   - What's unclear: For an in-flight assistant message that grows chunk-by-chunk, does the hook thrash and fire the same URL through the backend proxy repeatedly?
   - Recommendation: Add an in-memory `Map<url, Promise<result>>` at module scope so simultaneous or repeated requests for the same URL de-dupe. Backends should also cache the result briefly (say 30 seconds) to protect the agent's temp server from a burst of polls. `[MEDIUM confidence — recommend the planner include a wave-late task to add this de-dupe when the naive impl proves too chatty]`

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js runtime with `fetch` global | Backend proxy | Assumed ✓ | Node 18+ typical | Install `undici` and use its `fetch` explicitly |
| Existing Express router mount point at `src/backend/database/database.ts` | Backend proxy | ✓ | — | — |
| `sonner ^2.0.7` | Toast on re-fetch fail | ✓ | 2.0.7 | — |
| `radix-ui` Dialog primitives | Modal chrome | ✓ | 1.1.15 | — |
| `lucide-react` `Pencil` icon | Affordance glyph | ✓ | 1.28.0 | — |
| `react-markdown` `a` override seam | Extension point in ChatMessage | ✓ | 10.1.0 | — |
| `usePrettyViewUploads` hook | Deposit save into ComposeBox | ✓ (Quick 260802-wxy shipped) | — | — |
| Tailscale CLI on Ashley's device | Not applicable — proxy runs server-side | N/A | — | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none — the phase's Node fetch dep is universally available on modern runtimes

## Validation Architecture

**Skip per config.** `.planning/config.json` has `workflow.nyquist_validation: false` (verified L20). This section is omitted.

## Security Domain

`security_enforcement: true` and `security_asvs_level: 1` — this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse `authenticateJWT` middleware from `AuthManager.getInstance().createAuthMiddleware()` (see `global-files-read-write.ts` L58) on the new proxy route |
| V3 Session Management | yes (inherit) | No new session state; existing JWT session applies |
| V4 Access Control | yes | The proxy accepts ANY tailnet URL (100.64.0.0/10 range); no per-user ACL because the tailnet itself is the ACL boundary. Document this explicitly in the route's opening comment |
| V5 Input Validation | yes | Strict URL regex (`TAILNET_URL_RE`); reject non-matching URLs at 400; reject path traversal (`..`, `//`, trailing `/`); reject response bodies > 2 MB (413); reject response content-type `text/html` when the requested URL's extension is not `.html` (defense against directory listings) |
| V6 Cryptography | no | No new secrets, no new keys, no crypto operations |
| V10 Malicious Code | yes (byte-sniffing surface) | Byte-sniff must not execute or interpret the fetched bytes (only classify them). The heuristic in Pattern 4 does string-level inspection only — no `eval`, no dynamic import, no `Function` constructor |
| V11 Business Logic | yes | The additive-not-replacive constraint is a business rule — verify by test that the anchor is a sibling of the affordance, not a wrapper |
| V12 File Upload | partial | The save produces an attachment via the EXISTING pipeline, which already has upload_start server-side validation. No new file-upload surface here — same guarantees apply. |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via arbitrary URL to the proxy | Information Disclosure / Elevation of Privilege | Strict URL regex validation; only 100.64.0.0/10 CGNAT range allowed; reject `localhost`, `127.0.0.1`, `169.254.*` (link-local), private RFC1918 ranges, any `file://`, any non-`http://` |
| Path traversal via crafted URL | Tampering | Regex requires filename path segment; reject `..`, `//`, trailing `/` |
| Directory-listing HTML disguised as text file | Spoofing | Content-type sniff: if response content-type contains `html` and the URL's filename extension is not `.html`/`.htm`, reject at 502 |
| Oversized payload DoS on backend | Denial of Service | 2 MB cap on response body; 8s timeout on the outbound fetch |
| Reflected XSS via fetched content rendered into DOM | Tampering / Spoofing | Content is put into a `<textarea>` inside the modal, not rendered as HTML. Textareas are inherently text-safe. The `<a>`-override change also does not inject fetched content into any HTML sink — only the eligibility Set (a Set of URL strings, already-parsed by `new URL()`). No `dangerouslySetInnerHTML` anywhere. |
| CSRF on the new POST endpoint | Elevation of Privilege | Existing `authenticateJWT` guard covers this; JWT auth is bound to the same-origin auth cookie |
| Deposited File contains executable content that gets auto-run | Elevation of Privilege | Not applicable — the file is deposited as a `File` object into an in-memory attachment list, not executed. The upload pipeline treats it as bytes to transfer, not as code to run |

## Sources

### Primary (HIGH confidence)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/ChatMessage.tsx` — L1-100 (imports + component header), L380-500 (the anchor override extension point + speak-button hover pattern precedent)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/GlobalFilesModal.tsx` — full file (modal chrome reuse target — Portal + Overlay + Content, blue-glass, inset-4, `onInteractOutside` guard)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/GlobalFileTab.tsx` — full file (editor body reuse target — textarea + save + skeleton loading + inline error, tuned for iOS)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/AttachmentChipStrip.tsx` — full file (chip render that auto-mounts on the deposit)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/use-pretty-view-uploads.ts` — L1-200, L340-425 (staging + deposit APIs)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/PrettyView.tsx` — L800-830 (uploads hook instantiation), L2075-2100 (modal mount patterns), L2480-2540 (compose wiring)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/ComposeBox.tsx` — L180-410 (attachment prop contracts + staging entry points)
- `/home/ubuntu/skynet-tiffany/src/ui/api/global-files-api.ts` — full file (frontend fetch helper pattern to mirror for `editable-file-api.ts`)
- `/home/ubuntu/skynet-tiffany/src/backend/database/routes/global-files-read-write.ts` — L1-200 (backend route pattern to mirror for the new proxy)
- `/home/ubuntu/skynet-tiffany/src/ui/components/sonner.tsx` — full file (Toaster mount + theme)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-conversations/PinAction.tsx` — full file (bare-icon-with-hue-drop-shadow idiom precedent)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/GlobalFilesModal.test.tsx` — L1-100 (fetch-mocking test pattern via `vi.mock("@/api/global-files-api", ...)`)
- `/home/ubuntu/skynet-tiffany/package.json` — dep + test-runner version verification
- `/home/ubuntu/.claude/skills/id/SKILL.md` — L700-753 (canonical id-skill file-serving pattern — URL shape, auto-kill window, Chrome insecure-download UX)
- `/home/ubuntu/skynet-tiffany/.planning/phases/40-text-editor-in-skynet/40-CONTEXT.md` — full document
- `/home/ubuntu/skynet-tiffany/.planning/phases/40-text-editor-in-skynet/40-UI-SPEC.md` — full document
- `/home/ubuntu/skynet-tiffany/.planning/shapes/shape-skynet-text-editor.md` — full document

### Secondary (MEDIUM confidence)
- Byte-sniff heuristic (Pattern 4) is a synthesis of `file(1)` conventions and standard printable-ratio heuristics — no single authoritative reference cited.
- Extension whitelist (Pattern 5) is a starter set based on the shape doc's examples and common config formats — Ashley may add/remove.

### Tertiary (LOW confidence)
- Tailscale CGNAT range regex — widely-cited but not verified in this session by checking Tailscale docs directly; treated as `[ASSUMED]` A1.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every recommended library verified in package.json; every reuse file read end-to-end
- Architecture: HIGH — extension points verified by direct file reads; wiring paths traced through existing code
- Pitfalls: HIGH for #1, #2, #4, #5, #6, #7, #8 (verified against existing source); MEDIUM for #3 (Pitfall 3 defense-in-depth is best-practice, but the exact behavior of `python3 -m http.server` on directory URLs is ASSUMED)
- Security: HIGH — mirrors the fleet's established route-authoring conventions (`authenticateJWT`, request validation, size caps, structured error responses); SSRF mitigations are explicit and standard

**Research date:** 2026-08-14
**Valid until:** 2026-09-13 (30 days — the codebase evolves quickly; specifically watch for any changes to `ChatMessage.tsx` L395-417, `use-pretty-view-uploads.ts` public API, or `GlobalFileTab.tsx` contract that would invalidate the reuse assumptions)
