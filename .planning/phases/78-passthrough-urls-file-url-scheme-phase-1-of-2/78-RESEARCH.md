# Phase 78: Passthrough URLs — file URL scheme (phase 1 of 2) — Research

**Researched:** 2026-09-06
**Domain:** Skynet backend HTTP + SSH/SFTP, React chat message rendering, fleet-substrate distributor
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 URL grammar** — Literal path segments after the hostname. Shape: `<skynet-domain>/file/<hostname>/home/ubuntu/foo.md`. Backend strips the `/file/<hostname>/` prefix and re-adds the leading slash to reconstruct the absolute path. No URL-encoding of the whole path; browsers auto-encode individual characters (spaces, unicode) at those specific chars. Rationale: matches the existing tailnet-URL pattern agents already know (`http://100.x.y.z:PORT/filename` — no encoding), matches how file URLs read on other systems (GitHub file URLs, etc.), stays agent-natural to construct.

**D-02 Broken-URL bubble UX** — Passive render, no preflight HEAD. URL renders with the pencil affordance whenever its extension is whitelist-eligible (same rule Phase 40 uses today for tailnet URLs). On click, backend fetch happens synchronously and any failure is surfaced INSIDE the modal with a clean human-readable error: "Host unreachable," "File not found: `<path>`," "Permission denied on `<host>`." Same failure UX pattern as any web link — you don't know it's dead until you click. Rationale: preflight HEAD would fire one SSH round-trip per URL per rendered message; a chat with a few file mentions scrolled across 20 messages would burn 50-100 SSH channels just to render, which is untenable at scale.

**D-03 Parent-Skynet-domain config** — Single-line file at `~/.claude/skynet-parent`. Contents: the parent Skynet's HTTPS URL only, nothing else. Written by the fleet distributor during the same sweep that already pushes `settings.json`, hooks, and other per-box config. Agents read via `cat ~/.claude/skynet-parent` when constructing URLs. If the file is missing → agent surfaces "I can't share files right now, my parent-Skynet config is missing" to the user rather than silently guessing. Rationale: JSON is over-engineered for a single value; prose in CLAUDE.md is fragile; env vars need shell reload and hide "missing" as a silent empty string.

**D-04 Read access mechanic** — Read as whatever SSH user Skynet already uses for that host — no sudo escalation, no dedicated service account. Skynet already has a per-host SSH connection with a configured user (usually `ubuntu`, which is what agents also run as on fleet boxes, so agent-written files are readable by the SSH user in the default case). Failure surfaces as "permission denied" in the modal, and the operator fixes it host-side.

### Claude's Discretion
- Exact regex for the new URL pattern → planner + phase-researcher pick, following the shape and mirroring the existing `TAILNET_URL_RE_CLIENT` from `editable-file-whitelist.ts` (client-side detection with `stripTrailingPunct` for markdown-link edge cases).
- Backend route path and Express router placement — reuse the existing SSH client machinery per the R&D findings; exact route (e.g. under `/api/host/file/...` or a top-level `/file/<host>/<path>` route) is a planner detail. The URL AGENTS write is the shape-locked `/file/<host>/<path>` — Caddy/routing at the edge maps that to whatever internal backend route serves it.
- Exactly which of Phase 40's affordance code paths (whitelist check, modal fetch call, `useEditableFileEligibility` hook) get extended vs. copied — planner scouts and decides; the intent is REUSE, not fork.
- Distributor mechanism specifics (which sweep step writes the file, how upgrades of the URL propagate, per-box vs. global config) — planner + phase-researcher decide following the existing distributor pattern this role now owns.

### Deferred Ideas (OUT OF SCOPE)
- **Serve URL scheme** (`<skynet-domain>/serve/<hostname>/<port>/...` reverse proxy + wildcard TLS + WebSocket passthrough) — deliberate phase 2 of this shape.
- **Directory listings via file URL** — shape explicitly ruled out; agents cite multiple URLs.
- **Skynet writing directly into host files** — shape ruled out; edits round-trip through the user's next message via the compose-box attachment flow.
- **Preflight HEAD on rendered URLs** — rejected in D-02 as too expensive.
- **`sudo cat` or dedicated read service account** — rejected in D-04 as YAGNI.
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 78 is not enumerated in `.planning/REQUIREMENTS.md` (which covers patch #43 pretty-view work; this phase is a separate feature ownership stream under the box-maintainer role's fleet-substrate work). The requirements are derived from the shape file (`.planning/shapes/shape-skynet-passthrough-urls.md`) and CONTEXT.md decisions, expressed as delivery items:

| ID | Description | Research Support |
|----|-------------|------------------|
| PT1-REG | Add sibling URL regex for `<skynet-domain>/file/<hostname>/<abs-path>` in BOTH `src/ui/features/pretty-view/editable-file-whitelist.ts` AND `src/backend/utils/editable-file-whitelist.ts` (mirror rule, Phase 40 D-02) | § Phase 40 Stack Audit — regex naming, mirror rule; § Code Examples — regex pattern |
| PT1-HOOK | Extend `use-editable-file-eligibility.ts` to scan for BOTH regexes and merge results into one eligibility Set | § Architecture Patterns — Pattern 3 |
| PT1-MODAL | Route `EditableFileModal`'s fetch to the correct backend endpoint based on URL shape (tailnet URL → existing `/pretty-view/fetch-tailnet-url`; file URL → new `/pretty-view/fetch-host-file`) | § Architecture Patterns — Pattern 4 |
| PT1-ROUTE | New backend route `POST /pretty-view/fetch-host-file` that resolves host by NAME, applies per-user-per-host access check, opens SSH via connection pool, SFTP-reads the file with a size cap, and returns the same response envelope shape as `/fetch-tailnet-url` | § Architecture Patterns — Pattern 1, 2; § Code Examples |
| PT1-EDGE | Caddy edge maps `/file/<host>/<path>` → backend `/pretty-view/fetch-host-file` (rewrite or path-verbatim) OR agent constructs `<skynet-domain>/pretty-view/fetch-host-file?host=<h>&path=<p>` shape URLs and there is no Caddy work — planner decides | § Architecture Patterns — Pattern 4 (URL-vs-route decision) |
| PT1-DIST | Distributor pushes `~/.claude/skynet-parent` to every managed box via the existing bootstrap OR catalog mechanism | § Architecture Patterns — Pattern 5; § Common Pitfalls — Pitfall 3 |
| PT1-DOMAIN | Skynet exposes its own public domain to the distributor (new env var `SKYNET_PUBLIC_URL` in `skynet.env`, read at backend init) | § Runtime State Inventory — new env var + docker-compose change; § Common Pitfalls — Pitfall 4 |
| PT1-SKILL | Update `substrate/skills/id/SKILL.md` § "Sending files to the user" — replace the `python3 -m http.server` recipe with `<skynet-domain>/file/<hostname>/<path>` guidance (agent reads `~/.claude/skynet-parent` for the domain) | § Standard Stack — id skill; § Common Pitfalls — Pitfall 5 |
| PT1-ERR | Backend surfaces distinct error classes (`unknown_host`, `host_unreachable`, `not_found`, `permission_denied`, `too_large`, `binary_content`, `special_file`) so the modal can render human-readable copy | § Common Pitfalls — Pitfall 2; § Architecture Patterns — Pattern 2 |
| PT1-SAFE | Reject symlinks that escape the SSH user's readable space, `/dev/*`, `/proc/*`, `/sys/*`, sockets, FIFOs, char/block devices, and files exceeding 2 MB (matches existing `MAX_BYTES` in `pretty-view-fetch-tailnet-url.ts`) | § Common Pitfalls — Pitfall 1; § Architecture Patterns — Pattern 2 |
</phase_requirements>

## Summary

Phase 78 is a **surgical extension** of two existing subsystems: (1) Phase 40's editable-file affordance stack (whitelist + regex + eligibility hook + modal + affordance) and (2) the fleet-substrate distributor (Phase 72). Every load-bearing mechanic already exists — nothing greenfield. The R&D bounty at `~/.claude/roles/box-maintainer/bounties/skynet-passthrough-urls-rd/findings-summary.md` already confirmed viability; this research adds the specific file-level trace and identifies one implementation gap.

The **single non-obvious gap** is that Skynet has no in-band knowledge of its own public URL (`term.example.com`). The domain is declared at the Caddy layer (`/opt/skynet/Caddyfile`) but never surfaces to Skynet's own env, so the distributor cannot construct the `~/.claude/skynet-parent` file value without a new declared source of truth. The plan must add this — most naturally a new env var (`SKYNET_PUBLIC_URL`) in `/opt/skynet/skynet.env`, read at backend init and passed to the distributor sweep.

Backend read mechanic reuses `plan-file-fetch.ts`'s exact SFTP idiom (open once, `sftp.stat` first, then `sftp.readFile` capped, UTF-8-safe cutoff). Auth reuses `PermissionManager.canAccessHost(userId, hostId, "read")`. Host resolution needs a **new** helper `resolveHostByName(name, userId)` — the codebase currently only exposes `resolveHostById`, but `hosts.name` is a real column and the lookup pattern is trivial. SSH connection lifecycle uses `withConnection(key, factory, fn)` from `ssh-connection-pool.ts`, which handles the connect+release cycle correctly and shares connections with the rest of Skynet's SSH usage (max 3 conns per host, cleanup every 2 min).

Frontend changes are limited to **three files**: `editable-file-whitelist.ts` (add sibling regex — mirror the change in both frontend and backend copies), `use-editable-file-eligibility.ts` (extend the scan to include the new regex + call the appropriate fetch for byte-sniff eligibility), and either `EditableFileModal.tsx` (add URL-type detection + endpoint selection) or a new API helper `fetchHostFileUrl` alongside `fetchTailnetUrl`. `EditableFileAffordance.tsx` and `ChatMessage.tsx`'s ReactMarkdown `<a>` override need **zero changes** — they are URL-agnostic.

Distributor change adds ONE new step to `run-bootstrap.ts` (or a new file `write-skynet-parent.ts` in the distributor dir): a shell exec that atomically writes `$HOME/.claude/skynet-parent` with the parent domain string, guarded by an idempotent `cat + diff` check so it only rewrites on drift. Follows the exact same idiom as the existing `settings.json` patch step.

**Primary recommendation:** Build the backend fetch route as a sibling to `pretty-view-fetch-tailnet-url.ts` (same file structure, mount pattern, response envelope), reusing `resolveHostByName` (new helper) + `PermissionManager.canAccessHost` + `withConnection` + `plan-file-fetch.ts`'s SFTP idiom. On the frontend, add the sibling regex + extend the eligibility hook + extend the modal's fetch dispatch. On the distributor, add a bootstrap-step-3-style shell exec plus a new `SKYNET_PUBLIC_URL` env var read at backend init and piped through to the sweep. No new npm dependencies.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| URL detection in message body | Frontend (React) | — | Message rendering is a frontend concern; the eligibility hook already lives client-side per Phase 40 |
| URL regex source of truth | Frontend + Backend (mirrored) | — | Phase 40 D-02 mirror rule: same regex logic mirrored byte-identically in both build roots so the frontend gate and backend validator agree |
| Pencil affordance rendering | Frontend | — | Component is URL-agnostic and reused verbatim from Phase 40 |
| File-fetch modal + save-to-compose | Frontend | Backend (fetch source) | Modal owns UX; backend serves bytes |
| SSH read from target host | Backend | Host filesystem | Skynet is on the tailnet + holds credentials; browser cannot reach host directly |
| Per-user-per-host access enforcement | Backend | Database (`host_access` table) | Skynet DB is authoritative for RBAC; middleware pattern already established |
| Host lookup by name | Backend | Database | `hosts.name` column exists; needs new `resolveHostByName` helper (mirrors `resolveHostById`) |
| Parent-Skynet-domain config file | Fleet-substrate distributor | Skynet backend (source of URL string) | Distributor already push-owns per-box config; needs Skynet to surface its own URL to the sweep |
| id-skill "Sending files" section | Fleet-substrate (`substrate/skills/id/SKILL.md`) | Distributor (delivery) | Section-rewrite is a docs change; distributor pushes on every sweep |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ssh2` | resident dep (already used pervasively; see `plan-file-fetch.ts`) | SSH connect + SFTP subsystem for reading file bytes | Skynet's exclusive SSH client — every SSH surface uses it; no other client on the classpath |
| `express` | resident (`express.Router()` idiom throughout `src/backend/database/routes/*.ts`) | HTTP route mounting | Skynet's router is Express; new route mounts the same way `pretty-view-fetch-tailnet-url.ts` mounts |
| `drizzle-orm` | resident (see `permission-manager.ts`) | Host record + `host_access` queries | Every DB read uses drizzle; new `resolveHostByName` uses `db.select().from(hosts).where(eq(hosts.name, name))` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-markdown` | resident (used in `ChatMessage.tsx`) | Message rendering + `<a>` override for affordance mount | No change — new URL pattern flows through the same `<a>` override |
| `radix-ui` | resident (used in `EditableFileModal.tsx`) | Modal shell | No change |
| Fleet distributor (`src/backend/distributor/`) | Phase 72 — already shipped | Per-box sweep to push substrate files + settings.json patches + gsd-context-monitor cleanup | Extends with one new step (write `~/.claude/skynet-parent`) |
| id skill (`substrate/skills/id/SKILL.md`) | Fleet substrate | Agent-facing "how to share files" instructions | Section-rewrite (§ "Sending files to the user" at L752-815); distributor pushes on every sweep |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SFTP for reading bytes | `exec("cat <path>")` over SSH | SFTP avoids shell interpolation entirely (T-24-04 defense); binary-safe; `stat` first prevents `/dev/zero`-shaped hangs. `exec("cat")` is simpler but re-introduces shell-escape gaps. Reject: use SFTP (matches `plan-file-fetch.ts` — same author, same file class). |
| Verbatim `/file/<host>/<path>` route at Express root | Internal `POST /pretty-view/fetch-host-file` with JSON body `{host, path}` | Verbatim route: matches shape lock exactly, no Caddy work needed. Internal POST: mirrors `/pretty-view/fetch-tailnet-url` shape exactly, response envelope identical. Recommend: **verbatim route** at Express, mounted at `/file/:host/*` (Express `*` captures the rest of the path). Simpler, no Caddy rewrite, URL agents write matches the URL browser hits matches the URL Express routes. Path decoding at Express boundary is trivial (`req.params[0]` for the wildcard). |
| New env var `SKYNET_PUBLIC_URL` | Reading Caddy config at runtime | Reading Caddy config: brittle (Caddy config isn't machine-readable from inside container); requires filesystem mount. Env var: standard, one line in `/opt/skynet/skynet.env`, immediate. Recommend: **env var**. |
| Distributor bootstrap-step for `~/.claude/skynet-parent` | Catalog entry with bundled bytes | Catalog: fine if the file's content were static, but the parent domain varies per Skynet deployment (t1000 vs T800 vs future customer VMs); catalog bytes must be identical for every managed host. Bootstrap-step: writes dynamic per-Skynet content. Recommend: **bootstrap-step** in `run-bootstrap.ts`. |

**Installation:** No new packages needed. All patterns use resident deps.

**Version verification:** All packages are already installed; the last resident SFTP consumer (`plan-file-fetch.ts`) shipped in Phase 24 and is stable in production.

## Package Legitimacy Audit

No new packages installed by this phase. All work uses resident dependencies (`ssh2`, `express`, `drizzle-orm`, `radix-ui`, `react-markdown`). Audit N/A.

## Architecture Patterns

### System Architecture Diagram

```
                       Agent on managed box (e.g. thenasty)
                       │
                       │  reads $(cat ~/.claude/skynet-parent) = "https://term.example.com"
                       │  writes URL into a chat message: [note](https://term.example.com/file/thenasty/home/ubuntu/note.md)
                       ▼
                       Message JSONL file on the agent's box
                       │
                       │  Skynet backend tail-follows the session file (existing Phase 1/BACKEND-* infra)
                       ▼
                       PrettyView chat renders the message
                       │
                       │  ChatMessage.tsx runs useEditableFileEligibility(eventId, content)
                       │  Hook scans body for BOTH regexes: TAILNET_URL_RE_CLIENT + new SKYNET_FILE_URL_RE_CLIENT
                       │  For each URL, classifies via classifyByExtension (whitelist hit → eligible)
                       │  Returns Set<url> of eligible URLs
                       │
                       │  ReactMarkdown `<a>` override checks eligibleUrls.has(href) → renders <EditableFileAffordance>
                       │
                       │  User clicks pencil → onOpenEditor({messageEventId, url, filename}) → PrettyView opens <EditableFileModal>
                       ▼
                       EditableFileModal open effect fires
                       │
                       │  Detects URL shape:
                       │    matches TAILNET_URL_RE_CLIENT → POST /pretty-view/fetch-tailnet-url (existing)
                       │    matches SKYNET_FILE_URL_RE_CLIENT → GET /file/:host/* (new)
                       ▼
                       Backend route /file/:host/*
                       │
                       │  1. authenticateJWT (existing middleware)
                       │  2. resolveHostByName(hostname, userId) → hostRecord (or 404)
                       │  3. permissionManager.canAccessHost(userId, hostRecord.id, "read") → 403 if denied
                       │  4. absolutePath = "/" + req.params[0]  (re-add leading slash per D-01)
                       │  5. Guardrails: reject /proc/*, /sys/*, /dev/*, empty, contains "//" or "/../"
                       │  6. withConnection(poolKey, factory, async (client) => { ... })
                       │       a. sftp = await openSftp(client)
                       │       b. stat = await sftp.stat(absolutePath) → check regular file, not symlink target of /proc, size ≤ MAX_BYTES
                       │       c. bytes = await sftp.readFile(absolutePath)
                       │       d. base64-encode, classifyByExtension, sniffTextBytes (if extension-miss)
                       │  7. Return same envelope as /fetch-tailnet-url:
                       │       { contentBase64, sizeBytes, contentType, extension, filename, isTextByExt, isTextByBytes? }
                       │  8. On error: distinct status + error string
                       │       404 { error: "unknown_host" | "not_found" }
                       │       403 { error: "permission_denied" }
                       │       413 { error: "too_large" }
                       │       502 { error: "host_unreachable" }
                       │       504 { error: "ssh_timeout" }
                       ▼
                       Modal receives result, renders GlobalFileTab or in-body error copy per D-02
                       │
                       │  User edits, hits Save → onStageEditedFile(filename, content)
                       │  → uploads.stageAttachments("primary", [File])  (existing Phase 40 wiring — no change)
                       ▼
                       Chip appears in ComposeBox; user's next message carries the attachment
                       (existing Phase 5 upload flow — Skynet writes it to ~/pretty-view-uploads/... on the agent's box;
                        agent decides what to do with it — Skynet never writes to the original path)


SEPARATE FLOW: Distributor pushes ~/.claude/skynet-parent to every managed box
                       │
                       Skynet backend reads process.env.SKYNET_PUBLIC_URL at init
                       │
                       │  ssh-poll-orchestrator's per-host sweep calls runSweepForHost(channel, host, catalog, deps)
                       │  runSweepForHost calls runBootstrapForHost(channel, host) BEFORE the catalog loop
                       │
                       ▼  new step 4 in run-bootstrap.ts:
                       │     const cmd = `mkdir -p "$HOME/.claude" && echo '<SKYNET_PUBLIC_URL>' > "$HOME/.claude/skynet-parent.new" && \
                       │                  ( diff -q "$HOME/.claude/skynet-parent" "$HOME/.claude/skynet-parent.new" >/dev/null 2>&1 && \
                       │                    rm "$HOME/.claude/skynet-parent.new" || mv "$HOME/.claude/skynet-parent.new" "$HOME/.claude/skynet-parent" ) && \
                       │                  echo __SKYNET_PARENT_OK__`
                       │     const raw = await channel.exec(cmd)
                       │     (idempotent: no rewrite unless content differs)
                       ▼
                       On disk at ~/.claude/skynet-parent (world-readable, one line, no newline OR with newline — planner picks)
                       │
                       ▼
                       Agent's Bash tool reads the file when constructing a file URL (per new id-skill § "Sending files to the user")
```

### Recommended Project Structure

```
src/backend/
├── database/routes/
│   ├── pretty-view-fetch-tailnet-url.ts       # EXISTING (Phase 40) — no change
│   └── pretty-view-fetch-host-file.ts         # NEW (this phase) — mirrors pretty-view-fetch-tailnet-url.ts structure
├── ssh/
│   ├── host-resolver.ts                       # EXTEND — add resolveHostByName(name, userId) helper
│   ├── plan-file-fetch.ts                     # EXISTING — reference for SFTP idiom (no change)
│   └── ssh-connection-pool.ts                 # EXISTING — reuse withConnection()
├── utils/
│   └── editable-file-whitelist.ts             # EXTEND — add SKYNET_FILE_URL_RE (anchored, backend variant)
├── distributor/
│   └── run-bootstrap.ts                       # EXTEND — add step 4: write ~/.claude/skynet-parent (idempotent)
└── database/database.ts                       # EXTEND — import + mount new route (mirror existing pretty-view-fetch-tailnet-url mount)

src/ui/features/pretty-view/
├── editable-file-whitelist.ts                 # EXTEND — add SKYNET_FILE_URL_RE_CLIENT (client, /g flag) + preserve mirror rule
├── use-editable-file-eligibility.ts           # EXTEND — scan for BOTH regexes, merge into single Set
├── EditableFileModal.tsx                      # EXTEND — detect URL shape, dispatch to correct fetch API
├── EditableFileAffordance.tsx                 # NO CHANGE
└── ChatMessage.tsx                            # NO CHANGE (`<a>` override is URL-agnostic; eligibility Set drives affordance)

src/ui/api/
├── editable-file-api.ts                       # EXTEND — add fetchHostFileUrl(url) helper OR
                                                #          refactor fetchTailnetUrl to dispatch on URL shape

substrate/skills/id/
└── SKILL.md                                   # EXTEND — rewrite § "Sending files to the user" (L752-815)

src/backend/starter.ts (or wherever backend init lives)
└── PIPE process.env.SKYNET_PUBLIC_URL into the distributor deps  # planner locates entry point

/opt/skynet/
├── skynet.env                                 # HOST-SIDE — add SKYNET_PUBLIC_URL=https://term.example.com
└── docker-compose.yml                         # HOST-SIDE — verify env_file picks it up (should be automatic)
```

### Pattern 1: Backend file-fetch route — mirror `pretty-view-fetch-tailnet-url.ts`

**What:** The new backend route follows the exact structure of the existing Phase 40 fetch route: single POST handler on a router mounted under `/pretty-view` (or a new mount if agents will hit `/file/...` verbatim), `authenticateJWT` middleware, body validation, host resolution, permission check, SFTP read, response envelope identical to `TailnetFetchResult`.

**When to use:** For every file-fetch request from the modal. Same response shape means minimal frontend changes.

**Example:**
```typescript
// Source: src/backend/database/routes/pretty-view-fetch-tailnet-url.ts (Phase 40) — mirror this structure
// New file: src/backend/database/routes/pretty-view-fetch-host-file.ts

import express from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { withConnection } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostByName } from "../../ssh/host-resolver.js";  // NEW helper
import { classifyByExtension } from "../../utils/editable-file-whitelist.js";
import { sniffTextBytes } from "../../utils/editable-file-byte-sniff.js";

const router = express.Router();
const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();

const MAX_BYTES = 2_000_000;           // matches /fetch-tailnet-url
const SSH_CONNECT_TIMEOUT_MS = 5000;
const SFTP_READ_TIMEOUT_MS = 8000;

// Body validation — accept { hostname, absolutePath } shape
router.post(
  "/fetch-host-file",
  express.json({ limit: "8kb" }),   // paths can be long; 8kb generous
  authenticateJWT,
  async (req, res) => {
    // 1. Validate body
    const { hostname, absolutePath } = req.body ?? {};
    if (typeof hostname !== "string" || typeof absolutePath !== "string") {
      return res.status(400).json({ error: "invalid_body" });
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(hostname)) {
      return res.status(400).json({ error: "invalid_hostname" });
    }
    if (!absolutePath.startsWith("/")) {
      return res.status(400).json({ error: "path_must_be_absolute" });
    }
    if (absolutePath.includes("/../") || absolutePath.endsWith("/..") ||
        absolutePath.includes("/./")  || absolutePath.endsWith("/.")) {
      return res.status(400).json({ error: "path_traversal" });
    }
    // Guardrails: reject virtual filesystems and device paths
    if (/^\/(proc|sys|dev)(\/|$)/.test(absolutePath)) {
      return res.status(400).json({ error: "path_forbidden" });
    }

    // 2. Resolve host by name (scoped to userId — cross-user isolation)
    const userId = (req as any).userId;
    const host = await resolveHostByName(hostname, userId);
    if (!host) return res.status(404).json({ error: "unknown_host" });

    // 3. Per-user-per-host access check
    const accessInfo = await permissionManager.canAccessHost(userId, host.id, "read");
    if (!accessInfo.hasAccess) return res.status(403).json({ error: "permission_denied" });

    // 4. SSH connect + SFTP read (reuse pool)
    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    try {
      const result = await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          const sftp = await openSftp(client);   // helper: same shape as plan-file-fetch.ts
          const stat = await sftpStat(sftp, absolutePath);
          if (!stat.isFile()) throw new Error("not_a_file");
          if (stat.size > MAX_BYTES) throw new Error("too_large");
          const bytes = await sftpReadFile(sftp, absolutePath);  // capped by stat check above
          return bytes;
        }
      );

      // 5. Classify + envelope
      const filename = absolutePath.split("/").pop() ?? "";
      const extension = filename.includes(".")
        ? filename.split(".").pop()!.toLowerCase()
        : null;
      const isTextByExt = classifyByExtension(extension, filename);
      const isTextByBytes = isTextByExt ? undefined : sniffTextBytes(new Uint8Array(result));

      res.status(200).json({
        contentBase64: result.toString("base64"),
        sizeBytes: result.byteLength,
        contentType: null,          // no HTTP source; frontend uses extension-based type
        extension,
        filename,
        isTextByExt,
        isTextByBytes,
      });
    } catch (err) {
      // 6. Distinct error surfaces (D-02 requirement)
      const msg = err instanceof Error ? err.message : "unknown";
      if (msg === "not_a_file")      return res.status(400).json({ error: "not_a_file" });
      if (msg === "too_large")       return res.status(413).json({ error: "too_large" });
      if (msg.includes("ENOENT"))    return res.status(404).json({ error: "not_found" });
      if (msg.includes("Permission")) return res.status(403).json({ error: "permission_denied" });
      if (msg.includes("timeout"))    return res.status(504).json({ error: "ssh_timeout" });
      sshLogger.warn("fetch-host-file: unclassified error", { errorClass: err instanceof Error ? err.name : "unknown" });
      return res.status(502).json({ error: "host_unreachable" });
    }
  }
);

export default router;
```

### Pattern 2: SFTP read idiom — copy from `plan-file-fetch.ts`

**What:** Open SFTP subsystem once, `stat` before `readFile` (prevents `/dev/zero`-shape hangs), UTF-8-safe cutoff on capped reads, promise-wrapped callback API.

**When to use:** Every host-file read. Do not use `exec("cat")`.

**Example:**
```typescript
// Source: src/backend/ssh/plan-file-fetch.ts L120-163 (Phase 24)
function openSftp(sshConn: SSHClientType): Promise<SftpLike> {
  return new Promise((resolve, reject) => {
    (sshConn as any).sftp((err: Error | null, sftp: SftpLike) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}
function sftpStat(sftp: SftpLike, p: string) {
  return new Promise<{size: number; isFile: () => boolean}>((resolve, reject) => {
    sftp.stat(p, (err, stats) => {
      if (err || !stats) return reject(err ?? new Error("stat failed"));
      resolve(stats);
    });
  });
}
function sftpReadFile(sftp: SftpLike, p: string) {
  return new Promise<Buffer>((resolve, reject) => {
    sftp.readFile(p, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}
```

### Pattern 3: Frontend regex mirror + eligibility hook extension

**What:** Add a sibling regex in `src/ui/features/pretty-view/editable-file-whitelist.ts` (client, `/g` flag, unanchored) AND in `src/backend/utils/editable-file-whitelist.ts` (backend, no anchoring needed since the backend uses `pretty-view-fetch-host-file`'s own validation) — keep the Phase 40 D-02 mirror rule.

**When to use:** Any time the frontend needs to detect the new URL shape.

**Example:**
```typescript
// Source: src/ui/features/pretty-view/editable-file-whitelist.ts (mirror the shape)
// NEW export alongside TAILNET_URL_RE_CLIENT:

/**
 * D-01 URL shape: <skynet-domain>/file/<hostname>/<absolute-path>
 * Example: https://term.example.com/file/thenasty/home/ubuntu/note.md
 *
 * Grammar:
 *   - scheme: https:// only (agents on Skynet always run on HTTPS deployment)
 *   - domain: any hostname + optional port
 *   - literal "/file/"
 *   - hostname: [a-zA-Z0-9._-]+ (matches DNS-legal hostnames; hosts.name column allows more, but agent-written hostnames stay simple)
 *   - literal "/"
 *   - absolute-path: [^\s)?#]+ (stops at whitespace, closing paren, query start, fragment start — same terminator style as TAILNET_URL_RE_CLIENT)
 *
 * Same edge-cases as TAILNET_URL_RE_CLIENT:
 *   - Trailing prose punctuation trimmed by stripTrailingPunct (H2 fix)
 *   - /g flag: use .match() (stateless) — NEVER .test() on this regex
 *   - Applied at extraction time, then normalized with stripTrailingPunct
 */
export const SKYNET_FILE_URL_RE_CLIENT =
  /https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?\/file\/[a-zA-Z0-9._-]+\/[^\s)?#]+/g;
```

Then in `use-editable-file-eligibility.ts`, extend the match loop:

```typescript
// EXTEND the match block:
const rawTailnet = messageBody.match(TAILNET_URL_RE_CLIENT) ?? [];
const rawFileUrl = messageBody.match(SKYNET_FILE_URL_RE_CLIENT) ?? [];
const matches = Array.from(
  new Set([...rawTailnet, ...rawFileUrl].map((u) => stripTrailingPunct(u)))
);

// Inside the for-of loop, dispatch by URL shape when async byte-sniff is needed:
if (TAILNET_URL_RE_CLIENT.test(url)) {
  // reset .lastIndex; use .test() only here after regex reset
  const result = await fetchTailnetUrl(url);
  ...
} else if (SKYNET_FILE_URL_RE_CLIENT.test(url)) {
  const result = await fetchHostFileUrl(url);  // NEW helper
  ...
}
```

⚠️ **`.test()` on a `/g` regex mutates `.lastIndex`** — copy the pattern into a fresh non-global regex, OR reset `.lastIndex = 0` before every `.test()` call, OR use `url.startsWith(...)`-shape guards. The safest option: `SKYNET_FILE_URL_RE_CLIENT.source` compiled fresh without `/g` when dispatch is needed.

### Pattern 4: Modal fetch dispatch by URL shape

**What:** `EditableFileModal` currently unconditionally calls `fetchTailnetUrl(url)`. Extend to dispatch by URL shape: tailnet URL → `fetchTailnetUrl`; file URL → `fetchHostFileUrl`. Both return the same `TailnetFetchResult`-shape envelope.

**When to use:** Once. The modal is the single fetch site on the open path.

**Example:**
```typescript
// Source: src/ui/features/pretty-view/EditableFileModal.tsx L106-159
// EXTEND the open effect's fetch dispatch:

const fetchPromise = /^https:\/\/[^/]+\/file\//.test(url)
  ? fetchHostFileUrl(url)      // NEW
  : fetchTailnetUrl(url);      // EXISTING

fetchPromise
  .then((result) => { ... })   // rest of the effect unchanged
```

`fetchHostFileUrl` parses the URL client-side, extracts `hostname` and `absolutePath` (path stripped of the `/file/<hostname>` prefix, leading `/` re-added), and POSTs `{hostname, absolutePath}` to `/pretty-view/fetch-host-file`. Returns the same envelope shape.

### Pattern 5: Distributor bootstrap step — write `~/.claude/skynet-parent`

**What:** New step 4 (after gsd-context-monitor cleanup) in `run-bootstrap.ts`. Reads `SKYNET_PUBLIC_URL` from the bootstrap dep object (injected from `process.env` at backend init), writes to `~/.claude/skynet-parent` on the managed host, idempotent via content-diff check.

**When to use:** Every sweep, before the catalog loop.

**Example:**
```typescript
// Source: src/backend/distributor/run-bootstrap.ts steps 2, 3 (existing)
// NEW step 4 — same shape:

// deps signature adds skynetPublicUrl:
export interface BootstrapDeps {
  skynetPublicUrl: string;   // e.g. "https://term.example.com"
}

// Inside runBootstrapForHost, after step 3 (gsd-context-monitor cleanup):
let skynetParentOk = false;
try {
  if (!deps.skynetPublicUrl || !/^https:\/\//.test(deps.skynetPublicUrl)) {
    hadError = true;
    logBootstrapFailed(host, "skynet-parent-write", "SKYNET_PUBLIC_URL missing or malformed");
  } else {
    const url = deps.skynetPublicUrl.replace(/'/g, "'\\''");   // shell-safe
    const cmd = [
      `SP="$HOME/.claude/skynet-parent"`,
      `mkdir -p "$HOME/.claude"`,
      `NEW='${url}'`,
      `if [ -f "$SP" ] && [ "$(cat "$SP")" = "$NEW" ]; then`,
      `  :  # idempotent no-op`,
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
  logBootstrapFailed(host, "skynet-parent-write", err instanceof Error ? err.message : "unknown throw");
}

// Also add skynetParentOk to the BootstrapResult interface + logBootstrapResult payload.
```

### Anti-Patterns to Avoid

- **Hand-rolling a new SSH connection pool.** `withConnection()` in `ssh-connection-pool.ts` already handles max-3-per-host, health checks, cleanup. The R&D findings explicitly call this out as a phase-2 concern too — REUSE, don't fork.
- **Using `exec("cat <path>")` for the read.** SFTP is safer (no shell escape), binary-safe, and `stat` first prevents hangs on `/dev/zero`-shape paths.
- **Preflight HEAD to decide eligibility.** D-02 explicitly rejects this — passive render is the contract.
- **Forking the whitelist.** The mirror rule (Phase 40 D-02) is load-bearing: any regex added on one side MUST be added on the other in the same commit. Reviewers will catch a drift.
- **Silently writing to the wrong host.** `resolveHostByName` MUST scope by `userId` so a user cannot request a file from a host they don't own or have access to just by knowing its name. (Alternative: return the row regardless of userId and rely on `permissionManager.canAccessHost` — that's fine too, but the userId scope keeps error taxonomy cleaner: 404 for "no such host YOU can see" instead of leaking "host exists but you're denied" as 403.)
- **Assuming Skynet knows its own public URL.** It doesn't. See "Runtime State Inventory" and Common Pitfalls Pitfall 4.
- **Rewriting `EditableFileAffordance.tsx` or `ChatMessage.tsx`'s `<a>` override.** They are URL-agnostic. The eligibility hook drives everything downstream via a Set of eligible URLs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSH connection lifecycle | New pool / new one-shot layer | `withConnection` from `ssh-connection-pool.ts` + `connectOneShot` from `ssh-one-shot.ts` | Reuse means shared pool utilisation, uniform health-check semantics, uniform cleanup |
| File read over SFTP | `exec("cat <path>")` or custom stream loop | Copy the `openSftp` / `sftpStat` / `sftpReadFile` triple from `plan-file-fetch.ts` | Battle-tested since Phase 24; handles UTF-8 boundary safely; `stat`-first pattern prevents `/dev/kmsg`-style hangs |
| Per-user-per-host authz | New middleware or ad-hoc check | `permissionManager.canAccessHost(userId, hostId, "read")` (see `permission-manager.ts:344 requireHostAccess`) | Already handles owner + shared access + expiration + admin bypass; audited by every existing host route |
| URL regex + eligibility scan | Fresh hook, fresh detection | Extend `use-editable-file-eligibility.ts` and `editable-file-whitelist.ts` | Phase 40's D-02 mirror rule is load-bearing; the eligibility Set contract already integrates with `ChatMessage.tsx`'s `<a>` override |
| Fleet-substrate delivery | New sweep, new push mechanism | Extend `run-bootstrap.ts` with a new step (or add a catalog entry — but bootstrap is right for dynamic per-Skynet content) | Distributor already reliably reaches every managed box; adding a new push mechanism duplicates the reliability testing surface |
| Modal file-fetch chrome | Copy modal, fork editor | Extend `EditableFileModal.tsx` fetch dispatch by URL shape | Phase 40 D-05 and this phase's CONTEXT both explicitly require reuse |

**Key insight:** Phase 78 is 90% wiring existing subsystems together, 10% net-new code. Every load-bearing mechanism (Phase 40 editable-file stack, Phase 72 distributor, Phase 24 SFTP idiom, existing SSH pool, existing per-user-per-host auth) is production-hardened. The one gap — Skynet's own public URL — needs a small operational addition (env var), not new machinery.

## Runtime State Inventory

Phase 78 is a feature-add, not a rename/refactor. However, it introduces new persistent state on managed hosts and adds one new env var to the deployment. Explicit inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Per-managed-box file `~/.claude/skynet-parent` (single line, plaintext) — new artifact on every host under distributor's care | Distributor writes; no migration needed (fresh file); planner must ensure idempotency so it's not rewritten on every sweep churning `updated_at` sentinels |
| Live service config | None. No n8n workflow / Datadog dashboard equivalent involved. | None. |
| OS-registered state | None. No systemd unit changes; the file is a plain text file, not a service. | None. |
| Secrets / env vars | **NEW** `SKYNET_PUBLIC_URL` env var — must be added to `/opt/skynet/skynet.env` on t1000 AND T800 AND any future Skynet deployment. If missing → distributor bootstrap step logs a warn and skips (never rewrites with empty string). | Ship-time: (a) add line to `/opt/skynet/skynet.env` on t1000 during deploy; (b) coord with Stacy to add the same on T800; (c) document in future Skynet deployment runbooks. |
| Build artifacts | `substrate/skills/id/SKILL.md` — section rewrite ships as new bytes; distributor pushes on next sweep after container recreate. No .egg-info-style stale artifact. | None beyond normal ship discipline. |

**Nothing found in category:** No stored-data migration (fresh writes). No live-service config to update (no external service depends on the URL scheme yet — only agents starting from the sweep post-ship). No OS registration. No package artifact churn.

## Common Pitfalls

### Pitfall 1: Reading a `/proc`, `/sys`, `/dev`, or special-file path hangs or OOMs the backend

**What goes wrong:** An agent writes a URL like `.../file/thenasty/proc/kmsg` or `.../file/thenasty/dev/urandom` or `.../file/thenasty/dev/zero`. SFTP `readFile` on `/proc/kmsg` blocks indefinitely; on `/dev/urandom` returns forever; on `/dev/zero` returns until MAX_BYTES + then some.

**Why it happens:** SFTP's `readFile` API doesn't distinguish "regular file" from "special file" without an explicit `stat` first. Even with the size cap, a growing/streaming special file breaks the read.

**How to avoid:**
1. `sftp.stat(path)` FIRST — reject if `!stats.isFile()` (rejects directories, symlinks-to-directories, sockets, FIFOs, devices).
2. Regex-reject `/proc/*`, `/sys/*`, `/dev/*` at the route validation layer BEFORE any SSH activity. Belt-and-braces.
3. Attach an `AbortController` timer to the whole SFTP operation (8 seconds, matching `FETCH_TIMEOUT_MS` from `pretty-view-fetch-tailnet-url.ts`).

**Warning signs:** Backend memory grows during a fetch that never resolves; SSH pool exhaustion after a few "innocuous" agent messages.

### Pitfall 2: Error taxonomy leaks internal paths / stack traces to the browser

**What goes wrong:** `ssh2` throws errors with messages like `EACCES: permission denied, open '/root/secret.txt'` — proxying that to the browser leaks the SSH user's identity, the exact path, and hints at directory structure.

**Why it happens:** Default `res.status(500).json({ error: err.message })` is the ergonomic thing to write.

**How to avoid:** Classify errors into a small taxonomy (`unknown_host`, `not_found`, `permission_denied`, `too_large`, `host_unreachable`, `ssh_timeout`, `binary_content`, `special_file`) at the route boundary. Log `err.message` server-side (via `sshLogger.warn` with structured context), but return only the classified error string to the browser. Matches the existing pattern in `pretty-view-fetch-tailnet-url.ts` (see T-40-05 "URL leakage in server logs" and the `catch` block at L336-350).

**Warning signs:** Error messages in the modal contain path fragments the user shouldn't see; server logs show sanitised errors but browser DevTools show raw stderr.

### Pitfall 3: Distributor bootstrap step rewrites `~/.claude/skynet-parent` on every sweep and churns file mtime

**What goes wrong:** Naive `echo "$URL" > "$SP"` runs on every sweep. Even if content is identical, the file's mtime bumps every 2s (the poll cadence per `ssh-poll-orchestrator`). Downstream: any watcher on that path fires; log noise; false-positive drift signals.

**Why it happens:** Shell doesn't check content-equality by default; every write is unconditional.

**How to avoid:** Idempotent guard — read existing content, compare to desired, only rewrite on drift. Match the pattern in `run-bootstrap.ts` steps 2-3 (settings.json patch, gsd-context-monitor cleanup), which use `jq -e "$CHECK"` short-circuits to keep the sweep cheap on already-clean hosts. For a single-line file, `[ "$(cat "$SP")" = "$NEW" ]` is sufficient.

**Warning signs:** File mtime updates every sweep even without content change; distributor logs show `skynet-parent-write` firing on every host every 2s.

### Pitfall 4: `SKYNET_PUBLIC_URL` env var not set → distributor writes empty string OR crashes

**What goes wrong:** Backend init reads `process.env.SKYNET_PUBLIC_URL` and gets `undefined`. Naive code passes `undefined` through to the bootstrap step's shell command, which writes an empty string OR shell-syntax-errors OR just quietly drops. Agents then read a broken value.

**Why it happens:** There is no `SKYNET_PUBLIC_URL` in `/opt/skynet/skynet.env` today. This is a new env var this phase introduces. Anywhere Skynet is deployed without operator awareness — customer VMs post-shipping this phase — will silently produce broken URLs.

**How to avoid:**
1. At backend init, if `process.env.SKYNET_PUBLIC_URL` is missing OR doesn't start with `https://`, log a startup warning and SKIP the bootstrap step 4 entirely (don't write a broken file). Idempotency: skipping means the file stays at whatever value it had (which for a fresh box = missing, which agents already handle per D-03).
2. Ship-time: add `SKYNET_PUBLIC_URL=https://term.example.com` to `/opt/skynet/skynet.env` BEFORE container recreate. Coord with Stacy to add the T800 equivalent (`https://skynet.aithercloud.com`) before her next deploy.
3. Add a startup log line: `Skynet public URL configured as <url>` so operators can grep for it after deploy.

**Warning signs:** `~/.claude/skynet-parent` on some managed hosts is empty or contains stale value; agent messages show broken URLs the user can't click.

### Pitfall 5: id-skill section rewrite doesn't fully retire the http.server pattern

**What goes wrong:** The rewrite keeps the http.server recipe as a "fallback" or "alternative." Agents preferentially reach for the pattern they've used before, so the new URL scheme sees uptake only on newly-onboarded agents. The two-pattern world is worse than either single pattern.

**Why it happens:** Retiring a well-loved recipe feels wasteful. Cognitive drift preserves the old code out of muscle memory.

**How to avoid:** The section rewrite must (a) DELETE the http.server recipe entirely, (b) make the new URL construction the ONE and ONLY documented way, (c) include a "why we replaced this" note pointing at the shape's stated failure modes (Chrome insecure-download friction, tailnet dependency, agent-side server lifecycle burden). Explicit affirmation aligned with the shape's "What would make it wrong" § "The tailnet-serve pattern lives on in agent muscle memory."

**Warning signs:** Post-ship telemetry shows agents still using http.server; skill file grows a "legacy fallback" section over time.

### Pitfall 6: Regex `/g` flag + `.test()` = intermittent stale results

**What goes wrong:** `.test()` on a `/g` regex mutates `.lastIndex`. Subsequent calls with the SAME string return alternating true/false. This is documented in `editable-file-whitelist.ts:89-91` for the tailnet URL regex, but easy to forget for the new one.

**Why it happens:** JS `/g` regexes maintain stateful iteration. `.test()` and `.exec()` both advance `.lastIndex`; `.match()` and `.matchAll()` don't.

**How to avoid:** For dispatch logic (deciding which fetch to call in `EditableFileModal.tsx`), use a fresh non-global regex OR a `.startsWith(...)`-shape guard OR `.match(NEW_REGEX)?.length > 0`. NEVER `.test()` on the `/g` regex. Add the same warning comment to the new regex's docblock that L89-91 has for `TAILNET_URL_RE_CLIENT`.

**Warning signs:** Modal opens for a message where the user KNOWS it should have opened the file-URL modal, but it opened the tailnet-URL modal instead (or vice versa); refresh fixes it "sometimes."

### Pitfall 7: `resolveHostByName` name collision across users leaks host presence

**What goes wrong:** Two users both have a host named "thenasty" (different physical boxes). User A's file URL for `thenasty/some/path` accidentally resolves to User B's host, or reveals via 403 error taxonomy that a "thenasty" exists for someone else.

**Why it happens:** `hosts.name` is not unique — it's a per-user friendly name. Global lookup by name is ambiguous.

**How to avoid:** `resolveHostByName(name, userId)` MUST filter by `and(eq(hosts.name, name), eq(hosts.userId, userId))` — mirrors the pattern in `resolveHostById` which returns null on cross-user access. On not-found, return 404 with generic `unknown_host` error (do NOT differentiate "you don't have a host named X" from "no user has a host named X" — that's info leak). The `canAccessHost` layer then adds sharing semantics on top for hosts explicitly shared to the user.

**Warning signs:** Cross-user session testing shows one user can trigger reads on another user's host by knowing the friendly name.

### Pitfall 8: Backend in-memory SQLite `forceSave` not needed here — but easy to forget in a later change

**What goes wrong:** Phase 78's fetch route does no `INSERT/UPDATE/DELETE`. Adding it (e.g. to log fetch attempts, cache eligibility, etc.) without wrapping in `DatabaseSaveTrigger.forceSave("<reason>")` means the write reaches RAM only, then vanishes on next container recreate.

**Why it happens:** Skynet's DB is decrypted-into-RAM in-memory SQLite. Only `triggerSave()` marks it dirty for the 5-min flush poller.

**How to avoid:** Do not write to the DB in this phase's fetch route (it's a stateless read). If a follow-up feature adds any write — telemetry, rate limits, share tokens — wrap it per the `box-maintainer.md` § "Load-bearing invariants" rule. Pattern reference: `host-autostart-routes.ts:173-181`.

**Warning signs:** N/A for this phase (no DB writes); flagged so it doesn't get overlooked if scope creeps.

## Code Examples

Verified patterns from official / in-repo sources — all lifted from currently-shipping Skynet code.

### Response envelope (matches Phase 40's existing shape)

```typescript
// Source: src/backend/database/routes/pretty-view-fetch-tailnet-url.ts L321-329
res.status(200).json({
  contentBase64: buf.toString("base64"),
  sizeBytes: buf.byteLength,
  contentType: contentType ?? null,
  extension,
  filename,
  isTextByExt,
  isTextByBytes,   // optional — only when isTextByExt=false
});
```

### Per-user-per-host access check

```typescript
// Source: src/backend/utils/permission-manager.ts L344-390 (requireHostAccess middleware) and L217 (direct call)
const accessInfo = await permissionManager.canAccessHost(userId, hostId, "read");
if (!accessInfo.hasAccess) {
  return res.status(403).json({ error: "permission_denied" });
}
// accessInfo also exposes isOwner, isShared, permissionLevel — for the file-fetch route
// "read" is sufficient; we never need "write" or "share".
```

### SSH connection pool usage

```typescript
// Source: src/backend/ssh/server-stats.ts L1223-1230
async function withSshConnection<T>(
  host: SSHHostWithCredentials,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const key = getPoolKey(host);   // typically `${ip}:${port}:${username}` — see server-stats.ts's implementation
  const factory = createSshFactory(host);  // wraps connectOneShot with host-specific config
  return withConnection(key, factory, fn);
}
```

### Frontend URL match (tailnet regex — mirror pattern)

```typescript
// Source: src/ui/features/pretty-view/editable-file-whitelist.ts L96-97 (current tailnet regex)
export const TAILNET_URL_RE_CLIENT =
  /http:\/\/100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}:\d{1,5}\/[^\s)]+/g;

// NEW sibling — this phase adds:
export const SKYNET_FILE_URL_RE_CLIENT =
  /https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?\/file\/[a-zA-Z0-9._-]+\/[^\s)?#]+/g;
```

### Distributor bootstrap step template

```bash
# Source: src/backend/distributor/run-bootstrap.ts step 2 (settings.json patch, L247-299)
# NEW step 4 idempotent write template:

SP="$HOME/.claude/skynet-parent"
mkdir -p "$HOME/.claude"
NEW='https://term.example.com'
if [ -f "$SP" ] && [ "$(cat "$SP")" = "$NEW" ]; then
  :  # idempotent no-op
else
  printf '%s\n' "$NEW" > "$SP.new" && mv "$SP.new" "$SP"
fi
echo "__SKYNET_PARENT_OK__"
```

### id-skill "Sending files" rewrite direction

Current text (L752-815 of `substrate/skills/id/SKILL.md`) — describes `python3 -m http.server` on a tailnet IP with the wrapped-Python charset hack. This phase's rewrite replaces that with:

```markdown
## Sending files to the user

When the user asks for a file — a diff, an artifact, a log, a screenshot, a built
output — cite the file via a Skynet passthrough URL. Skynet fetches the file from
this box and surfaces it in the message bubble with a view + edit affordance.

**Small text (< ~5 KB)** — a short diff, a config snippet, a stack trace, a JSON
blob — just paste it inline in a code block. Faster than any HTTP dance.

**Anything larger, or binary** — cite a Skynet file URL. The URL format is:

    <skynet-parent-url>/file/<hostname>/<absolute-path>

Where:
- `<skynet-parent-url>` is the URL of the Skynet delivering this session — read it from `~/.claude/skynet-parent`
- `<hostname>` is this box's tailnet hostname (`hostname` command)
- `<absolute-path>` is the file's full path with leading `/`

Construct it and emit as a clickable Markdown link:

    PARENT=$(cat ~/.claude/skynet-parent)
    HOST=$(hostname)
    FILE=/home/ubuntu/notes/thing.md
    printf '[%s](%s/file/%s%s)\n' "$(basename "$FILE")" "$PARENT" "$HOST" "$FILE"

That renders as `[thing.md](https://term.example.com/file/thenasty/home/ubuntu/notes/thing.md)` — Ashley clicks and gets a modal to view / edit / send-back the file. When she saves the edit, it lands as an attachment in her next message to you — the file at the original path is NEVER overwritten by Skynet; every write goes through her explicit re-share.

**If `~/.claude/skynet-parent` is missing:** tell the user "I can't share files right now — my parent-Skynet config is missing. Ask the box-maintainer role to check the distributor sweep." Do NOT guess or fall back to serving your own HTTP server.

**Rules that matter — bake them in every time:**

- **Use the box's tailnet hostname, not an IP.** The hostname is the stable identifier Skynet uses in its host DB.
- **Path must be absolute** (starts with `/`). Relative paths won't work.
- **No URL-encoding on the whole path.** Just the individual characters browsers auto-encode (spaces, unicode). Path segments containing `?`, `#`, or ` ` get their characters encoded naturally by whatever produces the URL.
- **Skynet reads as this box's SSH user** — so files this user can `cat` are readable via the URL. Files under root-only paths (`/root/*`, `/etc/shadow`, `/proc/*`, etc.) will fail with a clean "permission denied" or "path forbidden" in the modal.
- **File-URL-based edits round-trip through the user's next message.** Skynet never writes to your files. You'll see her edit as a new attachment on her next reply — treat it like any freshly-uploaded file.

(The old `python3 -m http.server` recipe is retired — the Skynet passthrough URL scheme replaces it entirely. Chrome no longer flags downloads as insecure, and this box no longer needs to be on the fleet tailnet for file-sharing to work.)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agent stands up `python3 -m http.server` on a tailnet IP, hands user a link with Chrome insecure warning | Skynet reverse-fetches via URL scheme, over HTTPS Caddy | Phase 78 (this) | Kills tailnet dependency (works on T800 + future customer VMs); kills Chrome insecure friction; kills agent-side server lifecycle burden |
| Backend fetches tailnet HTTP proxy for Phase 40 editable-file affordance | Same proxy stays for tailnet URLs + new SFTP-based fetch for host-file URLs | Phase 78 (this) | Two fetch paths dispatch by URL shape; both surface via the same modal + response envelope |
| Distributor pushes static substrate + settings.json patches + hook cleanup | Distributor also pushes per-Skynet dynamic `~/.claude/skynet-parent` | Phase 78 (this) | Extends the sweep with a per-box dynamic file; template for future per-box dynamic config |

**Deprecated / outdated:**
- `python3 -m http.server` recipe in `substrate/skills/id/SKILL.md` § "Sending files to the user" L752-815 — replaced entirely by Phase 78's URL scheme. Note per shape "What would make it wrong": partial retirement (keeping as fallback) is a documented anti-pattern; DELETE the section entirely, don't relegate it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `hosts.name` column values are DNS-legal (`[a-zA-Z0-9._-]+`) so the URL regex hostname component covers all real host names | Standard Stack / Code Examples | If any user has a host with `.name = "my host"` (space) or "host!@#" (punctuation), the regex won't match and agents can't reference it. Verified `hosts.name` is a plain text column with no schema constraint — any character allowed. Empirically the fleet uses simple names (`thenasty`, `workstation`, `t1000`, `linux-beelink`), but customer VMs might violate this. Mitigation: (a) planner adds a hostname-legality check at DB write time or (b) SKYNET_FILE_URL_RE_CLIENT is relaxed to accept any URL-safe character except `/` — recommend (b) since it doesn't require a data migration. |
| A2 | Skynet has no existing `SKYNET_PUBLIC_URL` or equivalent env var; the domain is only declared at the Caddy layer | Runtime State Inventory / Pitfall 4 | Verified: grepped `src/backend/` for `SKYNET_.*URL`, `PUBLIC_URL`, `EXTERNAL_URL`, `APP_URL`, `BASE_URL`, `example` — no hits. `/opt/skynet/skynet.env` contents (redacted) don't include a URL variable. Confirmed. |
| A3 | The mount pattern `app.use("/pretty-view", prettyViewFetchHostFileRoutes)` will work identically to the existing `/pretty-view/fetch-tailnet-url` mount | Architecture Patterns Pattern 1 | Grepped `database.ts:1871` — mount is a plain `app.use()` on the Express app. New route mounts the same way. Confirmed. |
| A4 | The Caddy `term.example.com { reverse_proxy skynet:8080 }` block doesn't do path rewriting, so a request to `https://term.example.com/file/thenasty/xyz` reaches Skynet's Express as `/file/thenasty/xyz` verbatim | Architecture Patterns — verbatim `/file/:host/*` route option | Read `/opt/skynet/Caddyfile`; the reverse_proxy block has no `handle_path` or `uri` directives, so paths pass through unchanged. Confirmed. Recommend: mount the new route at BOTH `/file/:host/*` (for verbatim agent-cited URLs) AND `/pretty-view/fetch-host-file` (for the frontend's JSON POST). Two routers, same handler function factored out. |
| A5 | `resolveHostByName(name, userId)` doesn't exist today and must be added | Architecture Patterns Pattern 1 | Grepped `host-resolver.ts` — only `resolveHostById(hostId, userId)` and `checkHostAccess(hostId, userId, ...)` exist. Confirmed. |
| A6 | The distributor's `runBootstrapForHost` deps interface currently accepts no bootstrap-specific deps (it's called with just `channel, host`); adding a `skynetPublicUrl` field requires an interface change threaded through `run-sweep.ts` → `ssh-poll-orchestrator.ts` → the starter | Architecture Patterns Pattern 5 | Read `run-bootstrap.ts` signature: `runBootstrapForHost(channel, host)` — no deps. To pass `SKYNET_PUBLIC_URL` in, the signature must extend to accept a third arg OR read from process.env directly inside the function. Recommend: read from process.env directly at function top with a startup-warn if missing — sidesteps the multi-layer plumbing change. |
| A7 | The frontend `fetchTailnetUrl` axios helper can be extended (or a sibling `fetchHostFileUrl` added) without touching the axios interceptor auth flow | Standard Stack | Read `editable-file-api.ts:61-73`: uses `authApi.post(...)` from `main-axios.ts`; JWT is auto-attached by the axios request interceptor. Adding a sibling helper works identically. Confirmed. |
| A8 | The `substrate/skills/id/SKILL.md` file (repo copy) IS what the distributor pushes to `~/.claude/skills/id/SKILL.md` on every managed box | Standard Stack — id skill | Read `catalog.ts:96-99`: `bundledPath: "/app/fleet-substrate/skills/id/SKILL.md"` → `installPath: "~/.claude/skills/id/SKILL.md"`. The container image bundles `substrate/*` at `/app/fleet-substrate/*` (verified by production knowledge). Confirmed. |
| A9 | The URL regex accepting `[^\s)?#]+` for the path terminator is safe against markdown-link edge cases | Code Examples — SKYNET_FILE_URL_RE_CLIENT | Mirrors the terminator style in `TAILNET_URL_RE_CLIENT` (`[^\s)]+`); added `?` and `#` explicitly to avoid folding query strings and fragments into the file path (agents shouldn't emit those anyway, but defensive). Combined with `stripTrailingPunct` for trailing prose punctuation. |

## Open Questions (RESOLVED)

1. **Should the backend route mount at `/file/:host/*` verbatim OR at `/pretty-view/fetch-host-file` with `{host,path}` in body?**
   - What we know: Agent-written URL is shape-locked to `<skynet-domain>/file/<hostname>/<abs-path>`. Caddy passes it through unchanged. Either mount works.
   - What's unclear: Which is cleaner for the modal's fetch call. Verbatim `/file/:host/*` means the modal's fetch just does `GET <url>`. JSON POST means the modal parses the URL client-side and sends `{host, path}`.
   - Recommendation: **Mount BOTH.** Factor the fetch logic into a handler function. Route `/file/:host/*` handles direct-URL hits (Ashley clicks the link → browser opens a new tab → backend serves the raw bytes with correct Content-Type for browser-native rendering). Route `POST /pretty-view/fetch-host-file` (JSON body) handles the modal's programmatic fetch (returns the base64-envelope shape matching `TailnetFetchResult`, for consistency with the existing modal code path). Both routes call the same underlying `fetchHostFileBytes(host, path, userId)` helper. This lets the same URL work in two modes: click-to-open-in-modal (via ChatMessage's affordance) AND click-to-view-raw (via a direct browser tab if Ashley wants that). Bonus: the raw route makes the URL work identically to how a plain HTTP link would — matches the shape's "agents aren't lied to" philosophy.

2. **Should `~/.claude/skynet-parent` end with a newline or not?**
   - What we know: Some `cat`-based agent code will `printf` (no newline handling) or `read` (strips one trailing newline). Both should work with either format.
   - What's unclear: File permissions purists prefer newline-terminated; POSIX text-file convention says yes.
   - Recommendation: **Newline-terminated** (`printf '%s\n' "$URL"`). Matches the `/close file with newline` convention. Agent reads with `$(cat ...)` which strips trailing newlines anyway.

3. **Should the id-skill rewrite ship in this phase or a separate follow-up commit?**
   - What we know: CONTEXT § canonical_refs lists the id-skill rewrite as in-scope for Phase 78. The distributor push mechanism handles delivery on next sweep.
   - What's unclear: Timing — if the skill rewrite ships before the backend route + distributor step land, agents will construct URLs that 404 or land on a Skynet that doesn't have the `SKYNET_PUBLIC_URL` set.
   - Recommendation: **Ship all three in the same phase.** Ordering: (a) backend route + frontend regex + modal wiring lands and passes tests; (b) `SKYNET_PUBLIC_URL` env var added to `/opt/skynet/skynet.env` (host-side action, before container recreate); (c) distributor step 4 lands; (d) container recreate deploys everything atomically; (e) next distributor sweep writes `~/.claude/skynet-parent` on every host + pushes the updated id-skill. At no point do agents have a URL scheme without a working backend.

4. **What size cap makes sense?**
   - What we know: `pretty-view-fetch-tailnet-url.ts` uses `MAX_BYTES = 2_000_000`. Modal is text-editable; anything > ~10 MB is not editable in a textarea anyway. Binary files are download-only.
   - What's unclear: Whether to make the cap consistent with existing (2 MB) or bump for the file-URL case (files on managed boxes may be legitimately larger — logs, dumps).
   - Recommendation: **Use `MAX_BYTES = 2_000_000` (identical to Phase 40).** Consistent user expectation; consistent error taxonomy. If a real need for larger caps emerges, revisit in a follow-up phase — matches the shape's "add if a real need surfaces after shipping" posture.

5. **Symlink handling — dereference and check, or reject any symlink?**
   - What we know: SFTP `sftp.stat()` follows symlinks by default; `sftp.lstat()` does not. A symlink to `/proc/kmsg` would still hang if we `stat()` the target.
   - What's unclear: Whether agents legitimately share symlinks (e.g. `~/latest.log` -> `./logs/2026-09-06.log`).
   - Recommendation: **Use `sftp.stat()` (follows symlinks), then check the resolved target passes the same `/proc /sys /dev` regex guard.** Also cap by `stats.size`. This lets legitimate symlinks work while blocking the pathological cases. Belt: the path-regex guard on the input path (before SSH) rejects the direct-path attack.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend runtime | ✓ | 18+ (has globalThis.fetch) | undici (already resident) |
| `ssh2` npm package | SSH + SFTP | ✓ | resident | — |
| `express` npm package | HTTP routing | ✓ | resident | — |
| `radix-ui` | Modal | ✓ | resident | — |
| `react-markdown` | Message rendering | ✓ | resident | — |
| Access to `/opt/skynet/skynet.env` (host-side edit) | Setting `SKYNET_PUBLIC_URL` | ✓ | AWS SSM to t1000; separate coord with Stacy for T800 | — |
| Existing SSH connection pool | New backend route | ✓ | Production-stable | — |
| Existing distributor sweep | New bootstrap step | ✓ | Production-stable (Phase 72) | — |
| Existing per-user-per-host RBAC | New backend route | ✓ | Production-stable | — |
| Container recreate motion | Ship time | ✓ | Standard `docker build` + `docker compose up --force-recreate` per box-map + coord-room rule | — |

**Missing dependencies with no fallback:** None. All required infrastructure exists.

**Missing dependencies with fallback:** None.

**Ship coordination:** Container mutation rule applies — post BEFORE `docker build` in box-maintainer coord room (`!FHdIfqtmSWcGYUfyVp:thenasty.taild9b663.ts.net`), post AFTER verify.

## Security Domain

`security_enforcement: true` in `.planning/config.json`, ASVS Level 1 required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticateJWT` middleware on new route (existing Skynet pattern; JWT via cookie jar) |
| V3 Session Management | yes | JWT session lifetime = existing Skynet policy; nothing route-specific |
| V4 Access Control | yes | `permissionManager.canAccessHost(userId, hostId, "read")` — mirrors every existing host-scoped route |
| V5 Input Validation | yes | Regex-validated `hostname` param (`/^[a-zA-Z0-9._-]+$/`); path validation for absolute-only + no traversal + no `/proc//sys//dev`; `express.json({ limit: "8kb" })` on body |
| V6 Cryptography | no | No new crypto (JWT + SSH auth are existing subsystems) |
| V10 Malicious Code | yes | `sniffTextBytes` inspects but does NOT execute bytes (matches existing Phase 40 discipline) |
| V12 File Handling | yes | SFTP-only path reads (no shell exec); size cap; regular-file check via `sftp.stat`; symlink-target regex re-check |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via crafted URL | Tampering | New route talks ONLY to hosts registered in Skynet's DB with valid `host_access` for the requesting user — no arbitrary-network fetch. Attack surface is the `hostname` param; regex-validated. |
| Path traversal → read `/etc/shadow` on managed host | Information Disclosure | Reject `..` and `.` segments at route validation; SSH user's OS-level file permissions are the ultimate ACL (aligned with D-04); backend serves whatever bytes SFTP returns without escalation. |
| Cross-user host reference (User A reads User B's box by knowing its friendly name) | Elevation of Privilege | `resolveHostByName(name, userId)` scoped by userId (returns null on no-match); `permissionManager.canAccessHost` on top for shared-host semantics. |
| Symlink pointing at `/proc/kmsg` or `/dev/urandom` → backend hang / OOM | Denial of Service | `sftp.stat()` follows symlink; re-apply `/proc//sys//dev` path regex on RESOLVED target; also `!stats.isFile()` check rejects character/block devices, sockets, FIFOs. |
| Oversized read → memory exhaustion | DoS | `stat.size > MAX_BYTES` check BEFORE `readFile`; `AbortController` timeout on the whole SFTP operation. |
| Command injection via `hostname` in SSH command | Tampering | SFTP subsystem — no shell involved. `sshLogger` context logs only the classified error, not `err.message` (avoids reflected attacker payloads in logs). |
| Reflected error info leak (path fragments, SSH usernames) | Information Disclosure | Sanitize responses: return only the classified error string, log `err.message` server-side only. |
| Backend fetch route bypasses Caddy TLS termination (accessed on internal port) | Tampering | Skynet backend is not directly exposed — only Caddy is. Belt: `authenticateJWT` gates every request regardless. |

## Sources

### Primary (HIGH confidence)

- `.planning/shapes/shape-skynet-passthrough-urls.md` — the ratified two-phase shape (2026-09-05, Ashley)
- `~/.claude/roles/box-maintainer/bounties/skynet-passthrough-urls-rd/findings-summary.md` — R&D pre-work (2026-09-05)
- `.planning/phases/78-passthrough-urls-file-url-scheme-phase-1-of-2/75-CONTEXT.md` — locked decisions
- `/home/ubuntu/skynet-tiffany/src/backend/database/routes/pretty-view-fetch-tailnet-url.ts` — full route template (Phase 40)
- `/home/ubuntu/skynet-tiffany/src/backend/ssh/plan-file-fetch.ts` — SFTP idiom template (Phase 24)
- `/home/ubuntu/skynet-tiffany/src/backend/ssh/ssh-connection-pool.ts` — connection pool API
- `/home/ubuntu/skynet-tiffany/src/backend/ssh/ssh-one-shot.ts` — one-shot connect helper
- `/home/ubuntu/skynet-tiffany/src/backend/ssh/host-resolver.ts` — `resolveHostById` reference pattern
- `/home/ubuntu/skynet-tiffany/src/backend/utils/permission-manager.ts` — `canAccessHost` + `requireHostAccess` middleware
- `/home/ubuntu/skynet-tiffany/src/backend/distributor/run-bootstrap.ts` — bootstrap step template
- `/home/ubuntu/skynet-tiffany/src/backend/distributor/catalog.ts` — distributor catalog structure
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/editable-file-whitelist.ts` — client regex + whitelist pattern
- `/home/ubuntu/skynet-tiffany/src/backend/utils/editable-file-whitelist.ts` — backend mirror
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/EditableFileModal.tsx` — modal fetch dispatch site
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/EditableFileAffordance.tsx` — pencil component (URL-agnostic; verified)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/use-editable-file-eligibility.ts` — eligibility hook extension site
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/ChatMessage.tsx` — ReactMarkdown `<a>` override (verified no-change)
- `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/PrettyView.tsx:3007-3019` — modal mount site
- `/home/ubuntu/skynet-tiffany/src/ui/api/editable-file-api.ts` — frontend API helper pattern
- `/home/ubuntu/skynet-tiffany/substrate/skills/id/SKILL.md:752-815` — current "Sending files to the user" section to be replaced
- `/opt/skynet/Caddyfile` — Skynet's public URL declared here (verified — no in-band env var exists today)
- `/opt/skynet/docker-compose.yml` — env_file wiring (verified `env_file: - /opt/skynet/skynet.env` picks up new env vars)
- `/home/ubuntu/.claude/roles/box-maintainer/box-maintainer.md` — load-bearing invariants + standing directives (in-memory SQLite forceSave rule, coord-room ship rule)

### Secondary (MEDIUM confidence)

- `/home/ubuntu/skynet-tiffany/src/backend/ssh/server-stats.ts:1223-1230` — `withSshConnection` wrapper pattern (variant of what a new file-fetch handler needs)
- `/home/ubuntu/skynet-tiffany/src/backend/database/routes/identity-clone.ts` — auth-gated route with per-user host resolution (reference for shape)
- `/home/ubuntu/skynet-tiffany/src/backend/distributor/ssh-push.ts` — sentinel-based shell-exec transport pattern (potential template for the bootstrap step's shell command)

### Tertiary (LOW confidence)

- None — all findings are grounded in in-repo code and locked context.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every dependency is resident and production-hardened
- Architecture: HIGH — direct extension of existing Phase 40 + Phase 72 shapes
- Pitfalls: HIGH — trap classes are documented in the sibling routes' existing code (rev-3 code-review notes throughout)
- Security: HIGH — ASVS gates map directly to existing controls
- Runtime state: HIGH — one new env var, one new per-box file, no data migrations

**Research date:** 2026-09-06

**Valid until:** 2026-10-06 (stable — the Phase 40 stack, distributor, and SSH machinery are all production-frozen; no major refactors expected in the window)
