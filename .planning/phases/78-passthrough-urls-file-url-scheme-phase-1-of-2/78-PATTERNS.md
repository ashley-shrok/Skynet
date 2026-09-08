# Phase 78: Passthrough URLs — file URL scheme (phase 1 of 2) — Pattern Map

**Mapped:** 2026-09-06
**Files analyzed:** 10 (5 backend, 3 frontend, 1 distributor, 1 substrate skill)
**Analogs found:** 10 / 10 (all exact or near-exact matches — Phase 78 is 90% wiring of resident subsystems)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-view/editable-file-whitelist.ts` (EXTEND) | utility (client regex + whitelist) | pattern-detect | self — extend alongside `TAILNET_URL_RE_CLIENT` at L96-97 | exact |
| `src/backend/utils/editable-file-whitelist.ts` (EXTEND) | utility (backend mirror) | pattern-detect | self — mirror rule (Phase 40 D-02) | exact |
| `src/ui/features/pretty-view/use-editable-file-eligibility.ts` (EXTEND) | hook | pattern-detect + async-dispatch | self — extend match-loop + dispatch by URL shape | exact |
| `src/ui/features/pretty-view/EditableFileModal.tsx` (EXTEND) | component | request-response | self — extend `useEffect` open-fetch dispatch (L106-159) | exact |
| `src/ui/api/editable-file-api.ts` (EXTEND) | api-helper | request-response | self — add sibling `fetchHostFileUrl(url)` alongside `fetchTailnetUrl` | exact |
| `src/backend/database/routes/pretty-view-fetch-host-file.ts` (NEW) | controller/route | request-response + SFTP | `src/backend/database/routes/pretty-view-fetch-tailnet-url.ts` | exact (sibling) |
| `src/backend/ssh/host-resolver.ts` (EXTEND — add `resolveHostByName`) | service (host lookup) | CRUD (read) | `resolveHostById` at L14-200 in same file | exact (sibling helper) |
| `src/backend/database/database.ts` (EXTEND — import + mount) | config (route mount) | wiring | Mount line at L1867-1871 (`prettyViewFetchTailnetUrlRoutes`) | exact |
| `src/backend/distributor/run-bootstrap.ts` (EXTEND — add step 4) | service (fleet distributor step) | event-driven (per-sweep exec) | Steps 2 & 3 in same file (settings.json patch, cleanup) | exact |
| `substrate/skills/id/SKILL.md` § "Sending files to the user" L752-815 (REWRITE) | docs (substrate) | authoring | Section itself — replaced wholesale | N/A (delete + rewrite) |

**Also required (per RESEARCH.md § Runtime State Inventory):**

| Item | Type | Action |
|------|------|--------|
| `SKYNET_PUBLIC_URL` env var in `/opt/skynet/skynet.env` | operational config | HOST-SIDE add, no repo change; ship-coord with Stacy for T800 |
| Backend init to plumb `process.env.SKYNET_PUBLIC_URL` → distributor step 4 | wiring | Read directly inside `runBootstrapForHost` at function top (per RESEARCH § Assumption A6 — sidesteps 3-layer plumbing) |

---

## Pattern Assignments

### `src/backend/database/routes/pretty-view-fetch-host-file.ts` (NEW controller — request-response + SFTP read)

**Analog:** `src/backend/database/routes/pretty-view-fetch-tailnet-url.ts` (Phase 40; verified 358 lines; the closest possible match — same file class, same author, same review discipline)

**Imports pattern to copy verbatim** (L61-70 of the analog):
```typescript
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { classifyByExtension } from "../../utils/editable-file-whitelist.js";
import { sniffTextBytes } from "../../utils/editable-file-byte-sniff.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```
**Add** (for the new route):
```typescript
import { PermissionManager } from "../../utils/permission-manager.js";
import { withConnection } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostByName } from "../../ssh/host-resolver.js";  // NEW helper this phase
```

**Route registration + body-limit + auth ordering** (analog L107-114 — copy verbatim):
```typescript
router.post(
  "/fetch-host-file",
  express.json({ limit: "8kb" }),   // paths can be longer than URLs → 8kb; analog uses "2kb"
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const startEpoch = Date.now();
    // ...
  }
);
```
> **Invariant:** `express.json({ limit })` MUST come BEFORE `authenticateJWT` (belt-and-suspenders: rejects oversized bodies without touching auth). Matches analog L109-114 comment.

**Response envelope — MUST match `TailnetFetchResult` shape byte-for-byte** (analog L321-329):
```typescript
res.status(200).json({
  contentBase64: buf.toString("base64"),
  sizeBytes: buf.byteLength,
  contentType: contentType ?? null,   // null for SFTP source (no HTTP source header)
  extension,
  filename,
  isTextByExt,
  isTextByBytes,   // optional — only populated when isTextByExt=false
});
sshLogger.info("pretty-view proxy: ok", {
  operation: "pretty_view_fetch_host_file",  // rename op label
  host: `${hostname}:sftp`,
  duration: Date.now() - startEpoch,
});
```
> **Invariant:** Envelope shape is load-bearing — the modal + eligibility hook both consume `TailnetFetchResult`. Adding fields is OK; renaming or removing is NOT (frontend has no type discriminator).

**Extension helper** (analog L96-101 — copy verbatim, DO NOT reimplement):
```typescript
function extractExtension(filename: string): string | null {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === filename.length - 1) return null;
  return filename.slice(dotIdx + 1).toLowerCase();
}
```

**Error taxonomy pattern** (analog L336-353 → adapt to SFTP error classes):
```typescript
} catch (err) {
  const name = err instanceof Error ? err.name : "unknown";
  const msg  = err instanceof Error ? err.message : "";
  if (name === "AbortError")            res.status(504).json({ error: "ssh_timeout" });
  else if (msg === "not_a_file")        res.status(400).json({ error: "not_a_file" });
  else if (msg === "too_large")         res.status(413).json({ error: "too_large" });
  else if (msg.includes("ENOENT") || msg.includes("No such file"))
                                         res.status(404).json({ error: "not_found" });
  else if (msg.includes("Permission") || msg.includes("EACCES"))
                                         res.status(403).json({ error: "permission_denied" });
  else                                   res.status(502).json({ error: "host_unreachable" });
  sshLogger.warn("pretty-view proxy: sftp error", {
    operation: "pretty_view_fetch_host_file",
    host: `${hostname}:sftp`,
    errorClass: name,             // NEVER err.message in body
    duration: Date.now() - startEpoch,
  });
} finally {
  clearTimeout(timer);
}
```
> **T-40-05 invariant:** NEVER put `err.message` in `res.json()` — it leaks paths / SSH usernames / directory hints. Log server-side only. See analog L341-343 comment.

**MAX_BYTES constant** (analog L91-94): `const MAX_BYTES = 2_000_000;` — MUST match the analog for consistent user expectation + error taxonomy (per RESEARCH § Open Q 4).

**Guardrails BEFORE any SSH activity** (RESEARCH § Pitfall 1 — belt-and-braces):
```typescript
// Reject virtual filesystems + device paths at the route boundary
if (/^\/(proc|sys|dev)(\/|$)/.test(absolutePath)) {
  return res.status(400).json({ error: "path_forbidden" });
}
if (absolutePath.includes("/../") || absolutePath.endsWith("/..") ||
    absolutePath.includes("/./")  || absolutePath.endsWith("/.")) {
  return res.status(400).json({ error: "path_traversal" });
}
if (!/^[a-zA-Z0-9._-]+$/.test(hostname)) {
  return res.status(400).json({ error: "invalid_hostname" });
}
```

**Mount pattern in `database.ts`** (analog L1867-1871):
```typescript
// Phase 40 (D-01, D-04): SSRF-hardened proxy for agent-served tailnet URLs
app.use("/pretty-view", prettyViewFetchTailnetUrlRoutes);
// Phase 78 (D-01/D-04): SSH/SFTP-backed file-fetch for /file/<host>/<path> URLs
app.use("/pretty-view", prettyViewFetchHostFileRoutes);
```
> **Note:** Both mount at `/pretty-view` — Express merges routers on the same prefix. The second router owns `/fetch-host-file`; no path collision.

---

### `src/backend/ssh/host-resolver.ts` (EXTEND — add `resolveHostByName`)

**Analog:** `resolveHostById` in the same file (L14-200) — copy the credential-resolution tail verbatim; only the where-clause changes.

**Signature pattern** (mirror `resolveHostById` at L14-17):
```typescript
export async function resolveHostByName(
  name: string,
  userId: string,
): Promise<SSHHost | null> {
  const db = getDb();
  // ...
}
```

**Query pattern — CRITICAL to scope by userId** (RESEARCH § Pitfall 7 + § Anti-Patterns):
```typescript
const hostResults = await SimpleDBOps.select(
  db.select().from(hosts).where(
    and(eq(hosts.name, name), eq(hosts.userId, userId))   // BOTH — never just eq(hosts.name, name)
  ),
  "ssh_data",
  userId,
);

if (hostResults.length === 0) return null;   // 404 "unknown_host" — do NOT leak cross-user existence
```
> **Cross-user isolation invariant (RESEARCH § Pitfall 7):** `hosts.name` is NOT unique — it's a per-user friendly name. If two users both have a host named `thenasty`, filtering only by `name` would allow User A to trigger fetches on User B's box by guessing the friendly name. `and(name, userId)` returns null on cross-user access, aligning the error taxonomy: 404 for "no such host you can see" rather than 403 which would leak existence.

**JSON-field parsing + credential resolution tail** (analog L28-199 — copy VERBATIM including all the try/catch fallbacks for shared credentials and override credentials). The extension only replaces the WHERE clause; the rest of the resolve-credentials machinery is byte-identical.

---

### `src/ui/features/pretty-view/editable-file-whitelist.ts` (EXTEND — client-side)

**Analog:** Same file, `TAILNET_URL_RE_CLIENT` at L96-97 — this new regex is a sibling on the same shelf.

**Regex pattern to add** (mirror L86-97 docblock discipline; per CONTEXT § "Claude's Discretion" + RESEARCH Pattern 3):
```typescript
/**
 * D-01 URL shape (Phase 78): <skynet-domain>/file/<hostname>/<absolute-path>
 * Example: https://term.gigaashley.click/file/thenasty/home/ubuntu/note.md
 *
 * Grammar:
 *   - scheme: https:// only (agents on Skynet always run on HTTPS deployment)
 *   - domain: any DNS-legal hostname + optional port
 *   - literal "/file/"
 *   - hostname: [a-zA-Z0-9._-]+ (matches hosts.name — per RESEARCH Assumption A1
 *     fleet uses simple names; customer VMs may need a wider class later)
 *   - literal "/"
 *   - absolute-path: [^\s)?#]+ (stops at whitespace, closing paren, query start,
 *     fragment start — matches TAILNET_URL_RE_CLIENT terminator style)
 *
 * ⚠️ Same /g gotchas as TAILNET_URL_RE_CLIENT (see L84-91):
 *   - Trailing prose punctuation trimmed by stripTrailingPunct (H2 fix)
 *   - Use .match() (stateless) — NEVER .test() on this /g regex (mutates lastIndex)
 *   - Applied at extraction, then normalized with stripTrailingPunct
 */
export const SKYNET_FILE_URL_RE_CLIENT =
  /https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?\/file\/[a-zA-Z0-9._-]+\/[^\s)?#]+/g;
```

> **Invariants:**
> 1. **Mirror rule (Phase 40 D-02) is load-bearing** (see analog docblock L1-9): if the frontend gets a new regex, the backend `src/backend/utils/editable-file-whitelist.ts` gets an identical export in the SAME commit. Reviewers catch drift. (For Phase 78 the backend twin holds the whitelist data; the URL regex proper only ships client-side per rev-3 — but the docblock lockstep-noting the client-side regex extension MUST be added to the backend twin's docblock too, to preserve the mirror-rule bookkeeping.)
> 2. **`/g` + `.test()` is silently broken** (analog L89-91): `.test()` on a `/g` regex mutates `.lastIndex`; subsequent calls return alternating true/false. For dispatch decisions in `EditableFileModal.tsx`, use `.startsWith("...")`-shape guards or fresh non-global regexes.

---

### `src/backend/utils/editable-file-whitelist.ts` (EXTEND — backend mirror)

**Analog:** Same file — the mirror-rule bookkeeping companion of the client-side extension above.

**Action:** Update the docblock (L1-25) to note the Phase 78 client-side `SKYNET_FILE_URL_RE_CLIENT` addition and re-affirm the mirror rule. The URL regex proper does NOT ship in the backend twin (this file validates URLs the client already extracted; the new backend route does its own hostname/path validation with `/^[a-zA-Z0-9._-]+$/` etc.). Rationale is identical to why `stripTrailingPunct` (L11-14) and `TAILNET_URL_RE_CLIENT` don't ship server-side today: backend uses the anchored `TAILNET_URL_RE` inside `pretty-view-fetch-tailnet-url.ts`.

> **Invariant:** Do NOT drift the `EDITABLE_EXTENSIONS` / `EDITABLE_BASENAMES` / `classifyByExtension` bodies between the two files. Any change to that data lands in both in the same commit.

---

### `src/ui/features/pretty-view/use-editable-file-eligibility.ts` (EXTEND — scan + dispatch)

**Analog:** Same file (145 lines).

**Import extension** (L30-35):
```typescript
import { fetchTailnetUrl } from "@/api/editable-file-api";
import { fetchHostFileUrl } from "@/api/editable-file-api";   // NEW (add sibling helper)
import {
  classifyByExtension,
  stripTrailingPunct,
  TAILNET_URL_RE_CLIENT,
  SKYNET_FILE_URL_RE_CLIENT,   // NEW
} from "./editable-file-whitelist";
```

**Match-loop extension** (L69-72 → merge both regex hits + dedupe):
```typescript
const rawTailnet = messageBody.match(TAILNET_URL_RE_CLIENT) ?? [];
const rawFileUrl = messageBody.match(SKYNET_FILE_URL_RE_CLIENT) ?? [];
const matches = Array.from(
  new Set([...rawTailnet, ...rawFileUrl].map((u) => stripTrailingPunct(u))),
);
```

**Async byte-sniff dispatch** (L99-107 — extend):
```typescript
// Dispatch by URL shape. Use .startsWith(...) guard, NOT .test() on the /g regex.
const isFileUrl = /^https:\/\/[^/]+\/file\//.test(url);   // fresh non-global test — safe
const result = isFileUrl
  ? await fetchHostFileUrl(url)
  : await fetchTailnetUrl(url);
if (cancelled) return;
if (result.isTextByBytes === true || result.isTextByExt === true) {
  eligible.add(url);
}
```
> **Invariant:** The DISCARD-BYTES rule (L108-113 of analog): bytes fetched for eligibility MUST NEVER be served to the editor path. `EditableFileModal` fires its OWN fresh fetch on open. Same rule applies to both fetch helpers.

**Cancellation pattern** (L44-54 comment + `let cancelled = false;` — copy VERBATIM). Closure-scoped, per-effect-run, cannot be touched by a later effect. Rev-3 H3 fix; do not regress to `useRef(false)`.

---

### `src/ui/features/pretty-view/EditableFileModal.tsx` (EXTEND — fetch dispatch)

**Analog:** Same file, `useEffect` at L106-159 — extend the `fetchTailnetUrl(url)` call at L122.

**Extension pattern** (L120-125 area):
```typescript
setIsDirty(false);
savingRef.current = false;

// Phase 78: dispatch by URL shape. Both helpers return TailnetFetchResult.
const isFileUrl = /^https:\/\/[^/]+\/file\//.test(url);
const fetchPromise = isFileUrl
  ? fetchHostFileUrl(url)     // NEW (Phase 78)
  : fetchTailnetUrl(url);     // EXISTING (Phase 40)

fetchPromise
  .then((result) => {
    if (cancelled) return;
    initialMtimeRef.current = ++mtimeCounter;
    // ... rest unchanged (L129-147)
  })
  .catch(...)
```

**In-body error copy** (L305-341): current text assumes the tailnet-URL failure mode ("The agent's temporary server may have shut down..."). For Phase 78 fetch-host-file errors, either:
- (a) Detect `err.message` classification from the backend's error taxonomy string and swap copy per error class ("Host unreachable", "File not found", "Permission denied on <host>"), OR
- (b) Keep the existing copy but reword to be URL-scheme-agnostic.

Per CONTEXT § "Specifics" and RESEARCH § PT1-ERR: error surfaces MUST read like human speech, not stack traces or HTTP status codes. Recommendation: extend `EditableFileModalProps` with an optional `errorMode: "tailnet" | "host-file"` derived from URL shape at the ChatMessage.tsx call site, OR let the modal itself detect from URL and switch copy blocks.

> **D-04 invariant** (analog L32-39): "fresh fetch + visible failure over silent stale" — every open fires a fresh fetch. Cached bytes from `useEditableFileEligibility` are NEVER consulted here. This applies to BOTH fetch helpers.
> **D-06 invariant** (analog L46-49): `initialMtimeRef` set ONCE at fetch-success; never reassigned across the modal's open lifecycle. Reseeding blows away every keystroke.

---

### `src/ui/api/editable-file-api.ts` (EXTEND — sibling fetch helper)

**Analog:** Same file, `fetchTailnetUrl` at L61-73 (74 lines total).

**Add sibling helper** (mirror pattern verbatim):
```typescript
/**
 * POST /pretty-view/fetch-host-file
 * Phase 78 (D-01, D-04): fetches a host-file URL via the backend SFTP-hardened
 * proxy. Same response envelope shape as `fetchTailnetUrl` (TailnetFetchResult).
 *
 * URL is parsed client-side to extract { hostname, absolutePath } and POSTed
 * as JSON body. Consumers: useEditableFileEligibility (byte-sniff, DISCARDS
 * bytes) + EditableFileModal (fresh fetch on open, surfaces error).
 */
export async function fetchHostFileUrl(
  url: string,
): Promise<TailnetFetchResult> {
  // Parse: https://<domain>/file/<hostname>/<abs-path-without-leading-slash>
  const match = url.match(/^https:\/\/[^/]+\/file\/([a-zA-Z0-9._-]+)\/(.*)$/);
  if (!match) throw new Error("invalid file URL");
  const hostname = match[1];
  const absolutePath = "/" + match[2];   // D-01: re-add leading slash

  try {
    const response = await authApi.post("/pretty-view/fetch-host-file", {
      hostname,
      absolutePath,
    });
    return response.data as TailnetFetchResult;
  } catch (error) {
    handleApiError(error, "fetch host file URL");
    throw error;
  }
}
```
> **Invariant:** Response type is `TailnetFetchResult` — the modal + eligibility hook don't discriminate. Adding a new discriminated-union type here would ripple through all consumers with no gain.

---

### `src/backend/distributor/run-bootstrap.ts` (EXTEND — add step 4)

**Analog:** Same file, steps 2 & 3 (L237-350) — settings.json patch + gsd-context-monitor cleanup. Same idempotent-shell-exec + sentinel-marker + logBootstrapFailed pattern.

**Result-interface extension** (analog L53-69):
```typescript
export interface BootstrapResult {
  alreadyEnabled: boolean;
  bootstrapRan: boolean;
  daemonReloadRan: boolean;
  settingsPatchOk: boolean;
  gsdContextMonitorCleanupOk: boolean;
  skynetParentOk: boolean;   // NEW (Phase 78)
  hadError: boolean;
}
```

**Reading env var at function top** (per RESEARCH § Assumption A6 — sidesteps 3-layer plumbing to avoid touching `SweepDeps` + `ssh-poll-orchestrator.ts` + starter):
```typescript
export async function runBootstrapForHost(
  channel: SshChannel,
  host: { id: string; name: string },
): Promise<BootstrapResult> {
  const skynetPublicUrl = process.env.SKYNET_PUBLIC_URL ?? "";
  // ... rest
```

**Step 4 pattern to add — after step 3 (L308-350 body layout is the template)**:
```typescript
// -------------------------------------------------------------------------
// Step 4: Write ~/.claude/skynet-parent — parent-Skynet-domain config for
//         agent URL construction (Phase 78 D-03). Idempotent: skip if content
//         unchanged. If SKYNET_PUBLIC_URL is missing OR malformed, skip
//         entirely (do NOT write empty string — agents surface a clean error
//         when the file is missing per D-03).
// -------------------------------------------------------------------------
let skynetParentOk = false;
try {
  if (!skynetPublicUrl || !/^https:\/\//.test(skynetPublicUrl)) {
    // Per RESEARCH Pitfall 4 — do not write a broken value. Leave the file
    // at whatever state it's in (fresh box = missing, which agents already
    // handle per D-03). Log server-side only.
    systemLogger.warn(
      `Fleet-substrate bootstrap: SKYNET_PUBLIC_URL missing/malformed, skipping skynet-parent write for ${host.name}`,
      { operation: "fleet_substrate_bootstrap_result", fleetHostId: host.id, hostName: host.name, step: "skynet-parent-write" },
    );
  } else {
    // Shell-safe single-quote escape (analog step 2/3 does not need this
    // because those write jq expressions; we're interpolating a user-controlled
    // URL). Wrap and escape any embedded single-quote.
    const safeUrl = skynetPublicUrl.replace(/'/g, "'\\''");
    const cmd = [
      `SP="$HOME/.claude/skynet-parent"`,
      `mkdir -p "$HOME/.claude"`,
      `NEW='${safeUrl}'`,
      `if [ -f "$SP" ] && [ "$(cat "$SP")" = "$NEW" ]; then`,
      `  :  # idempotent no-op (RESEARCH Pitfall 3 — do not churn mtime)`,
      `else`,
      `  printf '%s\\n' "$NEW" > "$SP.new" && mv "$SP.new" "$SP"`,
      `fi`,
      `echo "__SKYNET_PARENT_OK__"`,
    ].join("\n");

    const raw = await channel.exec(cmd);
    if (raw === null) {
      hadError = true;
      logBootstrapFailed(host, "skynet-parent-write", "channel returned null");
    } else if (!raw.trimEnd().endsWith("__SKYNET_PARENT_OK__")) {
      hadError = true;
      logBootstrapFailed(host, "skynet-parent-write", raw.trimEnd().slice(0, 500));
    } else {
      skynetParentOk = true;
    }
  }
} catch (err) {
  hadError = true;
  logBootstrapFailed(
    host,
    "skynet-parent-write",
    err instanceof Error ? err.message : "unknown throw",
  );
}

// Also add skynetParentOk to the return object at L352-359.
```

**Invariants inherited from the analog:**
> 1. **NEVER-THROW contract** (L36-40): the function must not reject. Every risky call is wrapped in try/catch; failures logged, function resolves.
> 2. **Sentinel-marker pattern** (L178-190 for `__BOOTSTRAP_OK__`, L273 for `__SETTINGS_OK__`, L325 for `__CLEANUP_OK__`): every step ends its shell with `echo "__<STEP>_OK__"` and the caller checks `raw.trimEnd().endsWith(...)`. Do NOT parse stdout for other markers.
> 3. **Idempotency (RESEARCH Pitfall 3):** content-diff check BEFORE rewrite (`[ "$(cat "$SP")" = "$NEW" ]`). Matches analog step 2's `jq -e "$CHECK"` short-circuit at L267 and step 3's `any(...)` guard at L321. Without this, file mtime churns every 2s (sweep cadence) and downstream watchers fire on no real change.
> 4. **Structured logging** (L79-107): use `logBootstrapResult` (once per host per sweep) + `logBootstrapFailed` (per-step failure detail). Do NOT hand-roll `systemLogger.warn` for step failures — the log-tag family `fleet_substrate_bootstrap_*` is grepped by fleet dashboards.

---

### `src/backend/database/database.ts` (EXTEND — mount + import)

**Analog:** L41 (import) + L1867-1871 (mount comment + `app.use`).

**Import addition** (near L41):
```typescript
import prettyViewFetchTailnetUrlRoutes from "./routes/pretty-view-fetch-tailnet-url.js";
import prettyViewFetchHostFileRoutes from "./routes/pretty-view-fetch-host-file.js";  // NEW
```

**Mount** (near L1871 — same `/pretty-view` prefix; Express merges routers):
```typescript
// Phase 40 (D-01, D-04): SSRF-hardened proxy for agent-served tailnet URLs
app.use("/pretty-view", prettyViewFetchTailnetUrlRoutes);
// Phase 78 (D-01, D-04): SFTP-backed file fetch for /file/<host>/<path> URLs.
// Same prefix — Express merges routers; the new router owns /fetch-host-file.
app.use("/pretty-view", prettyViewFetchHostFileRoutes);
```

---

### `substrate/skills/id/SKILL.md` § "Sending files to the user" L752-815 (REWRITE)

**Analog:** The section itself is being deleted and rewritten wholesale. RESEARCH § Code Examples (L720-761) already provides the full rewrite text — the planner can copy it verbatim.

**Rewrite direction anchors:**
- **Delete entirely** the `python3 -m http.server` recipe + `mktemp -d` + `disown` + `pkill` guidance. Per RESEARCH § Pitfall 5, retiring the recipe entirely (no "fallback" or "alternative") is load-bearing — leaving it as an option means agents preferentially reach for muscle-memory.
- **Replace with** URL-construction guidance: `<skynet-parent>/file/<hostname>/<absolute-path>`, read parent from `~/.claude/skynet-parent`, `hostname` from the `hostname` command, ABSOLUTE path (leading `/`).
- **If `~/.claude/skynet-parent` is missing** — surface a clean error to the user rather than guess. Per CONTEXT D-03.
- **Note the round-trip semantics**: Skynet is READ-ONLY. Save button in the modal attaches the edit to Ashley's NEXT message; agent decides what to do with it. Skynet never overwrites files.

**Distributor delivery:** The distributor catalog already handles pushing `substrate/skills/id/SKILL.md` on every sweep (per RESEARCH § Assumption A8: `catalog.ts:96-99`). No new catalog entry needed — the rewrite ships on the next sweep after container recreate.

---

## Shared Patterns

### Authentication middleware (cross-cutting for ALL new backend routes)

**Source:** `src/backend/utils/auth-manager.ts` — `AuthManager.getInstance().createAuthMiddleware()`
**Apply to:** The new `pretty-view-fetch-host-file.ts` route
**Excerpt (from `pretty-view-fetch-tailnet-url.ts` L63-70):**
```typescript
import { AuthManager } from "../../utils/auth-manager.js";
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
// ... in route registration:
router.post("/fetch-host-file", express.json({ limit: "8kb" }), authenticateJWT, async (req, res) => { ... });
```
**Invariant:** `express.json({ limit })` BEFORE `authenticateJWT` (rejects malformed/oversized bodies without touching auth). Belt-and-suspenders pattern.

### Per-user-per-host access check

**Source:** `src/backend/utils/permission-manager.ts` L162-207 (`canAccessHost`)
**Apply to:** Every host-scoped backend route (this phase: the new `/fetch-host-file`)
**Excerpt (from RESEARCH § Code Examples, verified against `permission-manager.ts:344 requireHostAccess` and L162 direct):**
```typescript
const permissionManager = PermissionManager.getInstance();
const accessInfo = await permissionManager.canAccessHost(userId, host.id, "read");
if (!accessInfo.hasAccess) {
  return res.status(403).json({ error: "permission_denied" });
}
```
**Invariant:** Use `"read"` action (never `"write"` — Skynet never writes to host files per shape philosophy). `canAccessHost` handles owner + shared access + role-based + expiration + admin bypass in one call; do NOT hand-roll parts of this check.

### SSH connection lifecycle (pool + factory)

**Source:** `src/backend/ssh/ssh-connection-pool.ts` L214-225 (`withConnection`); `src/backend/ssh/ssh-one-shot.ts` L19-95 (`connectOneShot`)
**Apply to:** The new `/fetch-host-file` route's SSH usage
**Excerpt (from `ssh-connection-pool.ts` L214-225):**
```typescript
export async function withConnection<T>(
  key: string,
  factory: () => Promise<Client>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connectionPool.getConnection(key, factory);
  try {
    return await fn(client);
  } finally {
    connectionPool.releaseConnection(key, client);
  }
}
```
**Usage pattern for Phase 78:**
```typescript
const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
const bytes = await withConnection(
  poolKey,
  () => connectOneShot(host, 5_000),   // SSH_CONNECT_TIMEOUT_MS
  async (client) => {
    const sftp = await openSftp(client);
    const stat = await sftpStat(sftp, absolutePath);
    if (!stat.isFile())         throw new Error("not_a_file");
    if (stat.size > MAX_BYTES)  throw new Error("too_large");
    return await sftpReadFile(sftp, absolutePath);
  }
);
```
**Invariants:**
> 1. Pool key is `${ip}:${port}:${username}` — matches every existing consumer (`server-stats.ts`, others). Do NOT invent a new key shape.
> 2. `withConnection` handles the try/finally release cycle. Do NOT call `getConnection` + `releaseConnection` manually.
> 3. Pool cap is 3 conns/host with 10-min max age + 2-min cleanup (L162). Do not hand-roll a new pool.

### SFTP idiom (open + stat + readFile promise wrappers)

**Source:** `src/backend/ssh/plan-file-fetch.ts` L122-163 (Phase 24 — battle-tested, WR-04 UTF-8-safe cutoff, T-24-04 shell-escape defense)
**Apply to:** The new file-fetch handler
**Excerpt (verbatim from `plan-file-fetch.ts` L122-163):**
```typescript
function openSftp(sshConn: SSHClientType): Promise<SftpLike> {
  return new Promise((resolve, reject) => {
    (sshConn as unknown as { sftp: (cb: (err: Error | null, sftp: SftpLike) => void) => void })
      .sftp((err, sftp) => {
        if (err) return reject(err);
        resolve(sftp);
      });
  });
}

function sftpStat(sftp: SftpLike, p: string): Promise<{ size: number; isFile: () => boolean }> {
  return new Promise((resolve, reject) => {
    sftp.stat(p, (err, stats) => {
      if (err || !stats) return reject(err ?? new Error("stat failed"));
      resolve(stats);
    });
  });
}

function sftpReadFile(sftp: SftpLike, p: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(p, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}
```
**Invariants (RESEARCH § Pitfall 1):**
> 1. `stat` FIRST, `readFile` SECOND — prevents `/dev/zero`-shape hangs and enforces size cap before allocating the read buffer.
> 2. `stat.isFile()` check rejects directories, sockets, FIFOs, char/block devices.
> 3. `stat.size > MAX_BYTES` short-circuits before the SFTP `readFile` call.
> 4. Symlinks are followed by `sftp.stat()` by default; RESEARCH § Open Q 5 recommends `stat` (follows) + re-apply `/proc//sys//dev` regex on the resolved target. Belt-and-braces.
> 5. NEVER `exec("cat <path>")` — SFTP subsystem avoids shell entirely.

### Structured logging via `sshLogger`

**Source:** `src/backend/utils/logger.ts`; used across the tailnet route (L230-350) with `operation: "pretty_view_fetch_tailnet_url"` field.
**Apply to:** Every log call in the new route.
**Pattern:** `sshLogger.warn("<human msg>", { operation: "pretty_view_fetch_host_file", host, errorClass, duration });`
**Invariant:** Field `operation` is a fixed enum used by log dashboards; use `pretty_view_fetch_host_file` (rename per new route). NEVER include `err.message`, `absolutePath`, or `filename` in the log fields (T-40-05 URL leakage). Only `errorClass = err.name`, host+port context, and duration.

---

## No Analog Found

**None.** Every file in Phase 78 has a strong analog in the existing codebase. Phase 78 is explicitly a wiring phase over resident subsystems (RESEARCH § Summary: "90% wiring, 10% net-new code").

The one operational addition — `SKYNET_PUBLIC_URL` env var in `/opt/skynet/skynet.env` + coord with Stacy for T800 — is not a code file and has no analog because Skynet has never before needed to know its own public URL (verified via RESEARCH Assumption A2: grepped `SKYNET_.*URL` / `PUBLIC_URL` / `BASE_URL` / `gigaashley` — no hits).

---

## Cross-cutting Invariants Checklist

Planner should reference this list in every action that touches the corresponding file.

- [ ] **Whitelist mirror rule (Phase 40 D-02):** any regex/data addition to `src/ui/features/pretty-view/editable-file-whitelist.ts` MUST have a companion docblock note in `src/backend/utils/editable-file-whitelist.ts` in the SAME commit. The URL regex proper only lands client-side (backend has its own validation); the mirror-rule bookkeeping still applies.
- [ ] **In-memory SQLite `DatabaseSaveTrigger.forceSave` rule (`box-maintainer.md`):** N/A for Phase 78 — no DB writes. Flagged for awareness if scope creeps (RESEARCH § Pitfall 8).
- [ ] **NEVER-THROW contract on distributor bootstrap:** every step wrapped in try/catch; failures logged via `logBootstrapFailed`; function resolves.
- [ ] **T-40-05 (log/response info leak):** NEVER put `err.message`, `absolutePath`, or `filename` in `res.json()` bodies OR log fields. Only classified error strings + host+port + `errorClass = err.name` + duration.
- [ ] **Cross-user isolation** (`resolveHostByName`): filter by `and(eq(hosts.name, name), eq(hosts.userId, userId))`. Never just `eq(hosts.name, name)`.
- [ ] **`/g` regex + `.test()` = broken:** dispatch decisions use fresh non-global regexes or `.startsWith(...)` guards.
- [ ] **DISCARD-BYTES rule** (D-04): bytes fetched for eligibility MUST NEVER flow into the editor path. Modal fires its own fresh fetch on open.
- [ ] **Idempotent bootstrap step:** content-diff check BEFORE rewrite. No mtime churn.
- [ ] **Response envelope stable** (`TailnetFetchResult`): both fetch helpers return the same shape. Adding fields OK; renaming/removing NOT.
- [ ] **Container mutations coord-room rule + `git pull --rebase` before push** (`box-maintainer.md` § Standing directives): ship-time only. Coord-room `!FHdIfqtmSWcGYUfyVp:thenasty.taild9b663.ts.net`.

---

## Metadata

**Analog search scope:**
- `/home/ubuntu/skynet-tiffany/src/backend/database/routes/` (34 route files)
- `/home/ubuntu/skynet-tiffany/src/backend/ssh/` (35 SSH-related files)
- `/home/ubuntu/skynet-tiffany/src/backend/utils/` (30+ utility files)
- `/home/ubuntu/skynet-tiffany/src/backend/distributor/` (6 distributor files)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/` (100+ pretty-view files)
- `/home/ubuntu/skynet-tiffany/src/ui/api/` (frontend API helpers)
- `/home/ubuntu/skynet-tiffany/substrate/skills/id/SKILL.md`

**Files scanned in depth:** 12
- `pretty-view-fetch-tailnet-url.ts` (358 lines, full read)
- `editable-file-whitelist.ts` (client + backend, both full)
- `use-editable-file-eligibility.ts` (145 lines, full read)
- `EditableFileModal.tsx` (359 lines, full read)
- `editable-file-api.ts` (74 lines, full read)
- `host-resolver.ts` (227 lines, full read)
- `plan-file-fetch.ts` (315 lines, full read)
- `ssh-connection-pool.ts` (226 lines, full read)
- `ssh-one-shot.ts` (95 lines, full read)
- `run-bootstrap.ts` (364 lines, full read)
- `run-sweep.ts` (targeted L40-120 read)
- `ssh-poll-orchestrator.ts` (targeted L2110-2150 read)

**Also targeted-read:**
- `permission-manager.ts` (L150-230 for `canAccessHost` shape)
- `database.ts` (L1860-1880 for mount + L1-50 for imports)
- `ChatMessage.tsx` (L60-100 + L320-345 — confirmed URL-agnostic, no change needed)
- `substrate/skills/id/SKILL.md` (L750-815 — current "Sending files" section)

**Pattern extraction date:** 2026-09-06
