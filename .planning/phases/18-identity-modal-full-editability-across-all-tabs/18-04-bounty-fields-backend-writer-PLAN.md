---
phase: 18-identity-modal-full-editability-across-all-tabs
plan: 04
type: execute
wave: 4
depends_on:
  - 18-01
  - 18-03
files_modified:
  - src/backend/claude-session/identity-artifact-reader.ts
  - src/backend/claude-session/claude-session-server.ts
  - src/ui/api/claude-session-api.ts
autonomous: true
requirements:
  - IDMEDIT-04
tags:
  - identity-modal
  - backend
  - bounty
  - json-patch
  - security
  - phase-18

must_haves:
  truths:
    - "New backend export writeIdentityBountyFields(conn, identityKey, bountySlug, patch) exists in identity-artifact-reader.ts. `patch` is an object with optional fields title?, premise?, todos?, keywords?, source_links?, deadline?, meeting_questions? — each key is written to bounty.json only if present in the patch (partial JSON patch, not full-object replacement)."
    - "The writer bumps updated_at to the current ISO-Z timestamp and appends ONE timeline entry per changed field, matching the existing 'via identity modal' convention (see writeIdentityBountyPriority line 768 pattern). Timeline entry format: `${nowIso} <field> updated via identity modal` — one line per field key present in the patch."
    - "LOCAL branch reads bounty.json via fs.readFile, applies the patch, bumps updated_at, appends timeline entries, writes to tmp+rename (mirrors writeIdentityBountyPriority lines 770-784)."
    - "REMOTE branch reads bounty.json via SFTP.readFile, applies patch in Node process memory, bumps updated_at, appends timeline entries, writes to tmp+rename via SFTP (uses the same writeMarkdownFileAtomic-shape helper from Plan 01, or a JSON-specific companion writeJsonFileAtomic that shares the SFTP.writeFile + rename mechanism). Path: `${remoteHome}/.claude/identities/${identityKey}/bounties/${bountySlug}/bounty.json`."
    - "Per-field type validation runs BEFORE any file I/O: title (string, length <= 500), premise (string, length <= 50000), todos (array of { text: string; done: boolean }; each text <= 5000), keywords (array of string; each <= 200), source_links (array of string; each <= 2000, HTTP/HTTPS/mailto scheme check optional per SCRATCH-REPORT — check the report), deadline (string ISO-8601 date-or-datetime, or null to clear), meeting_questions (array of object matching bounty.json schema; each question <= 5000). Invalid patch throws with a truthful message."
    - "IDMEDIT_MAX_BOUNTY_JSON_BYTES = 100_000 cap enforced on the SERIALIZED post-patch JSON before writing — protects against a huge patch bloating bounty.json past a reasonable size. Throws before writing if the serialized JSON exceeds cap."
    - "REMOTE branch validates identityKey against IDENTITY_KEY_RE and bountySlug against IDENTITY_SLUG_RE before path interpolation (second belt on top of the caller's server-side check — matches writeIdentityBountyPriority lines 787-789 pattern)."
    - "New WS handler identity:update-bounty-fields in claude-session-server.ts mirrors the shape of identity:update-bounty-priority handler (~line 2450): typed guards on every input field, IDENTITY_KEY_RE + IDENTITY_SLUG_RE gates, hostId → useLocal branching, resolveHostById + connectOneShot for REMOTE with try/finally conn.end()."
    - "Handler emits identity:bounty-fields-updated { bounties, archivedBounties, error? } on completion by immediately re-reading both bounty lists via readIdentityBounties on the same branch — same fresh-list-in-response convention as updateBountyPriority (matches sendIdentityMutation pattern the client uses)."
    - "The existing normalizeBounty function in identity-artifact-reader.ts (line 171-199) is EXTENDED to pass through source_links (Array or []), deadline (string or null), and meeting_questions (Array or []) fields — these were dropped by the current normalizer, so the frontend cannot read them today. Widening is additive; existing consumers continue to work."
    - "The Bounty wire type in src/ui/api/claude-session-api.ts (line 282-303) gains three new optional/required fields: source_links: string[], deadline: string | null, meeting_questions: { question: string; answered: boolean; answer?: string | null }[] (or whatever shape SCRATCH-REPORT.md locked). Widening is additive."
    - "New wire types IdentityUpdateBountyFieldsPayload and IdentityBountyFieldsUpdatedEvent added to claude-session-api.ts alongside the existing IdentityUpdateBountyPriorityPayload/Event pair."
  artifacts:
    - path: "src/backend/claude-session/identity-artifact-reader.ts"
      provides: "writeIdentityBountyFields function, extended normalizeBounty passing through source_links/deadline/meeting_questions, IDMEDIT_MAX_BOUNTY_JSON_BYTES const, optional writeJsonFileAtomic private helper"
      contains: "writeIdentityBountyFields"
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "identity:update-bounty-fields WS handler with identity:bounty-fields-updated fresh-list echo"
      contains: "identity:update-bounty-fields"
    - path: "src/ui/api/claude-session-api.ts"
      provides: "IdentityUpdateBountyFieldsPayload + IdentityBountyFieldsUpdatedEvent types; extended Bounty type"
      contains: "IdentityUpdateBountyFieldsPayload"
  key_links:
    - from: "src/ui/api/claude-session-api.ts Bounty type"
      to: "src/backend/claude-session/identity-artifact-reader.ts normalizeBounty"
      via: "shape contract — every field on Bounty type must be present in normalizeBounty return, else frontend consumers see undefined"
      pattern: "source_links|deadline|meeting_questions"
    - from: "src/backend/claude-session/claude-session-server.ts identity:update-bounty-fields handler"
      to: "src/backend/claude-session/identity-artifact-reader.ts writeIdentityBountyFields + readIdentityBounties"
      via: "handler calls writer then re-reader on same branch, echoes fresh lists"
      pattern: "writeIdentityBountyFields|readIdentityBounties"
    - from: "SCRATCH-REPORT.md wire contract section"
      to: "writeIdentityBountyFields signature"
      via: "field names + types in patch object mirror the locked shape from Wave 3 UAT"
      pattern: "title|premise|todos|keywords|source_links|deadline|meeting_questions"
---

<objective>
Deliver the backend infrastructure for bounty-field editing: a partial-
JSON-patch writer, extended normalizeBounty pass-through, extended Bounty
wire type, one new WS handler + event pair. LOCAL + REMOTE branches both
work via the same SFTP-based tmp+rename primitive family delivered in
Plan 01.

Purpose: Plan 05's BountyCard field editors dispatch a single WS message
per Save (title Save, premise Save, todos edit, etc.), each of which
carries a partial patch. This backend accepts those patches, validates
them, applies them, bumps updated_at, appends timeline entries per
changed field, and returns fresh bounty lists so the client atomically
rehydrates — same shape as the existing updateBountyPriority /
updateBountyStatus flow.

Design decision: partial-JSON-patch semantics (not full-object replacement).
Reasons: (a) matches existing patch-#154 update-bounty-priority /
quick-260727-v0b update-bounty-status / quick-260728-sqk update-bounty-
pinned / quick-260727-wd0 archive shape — one WS message per field-cluster
change; (b) full-object replacement would require the client to hold and
send fields it doesn't edit (id, created_at, updated_at, timeline) which
races against server-side timeline appends from other flows; (c) partial
patch is what SCRATCH-REPORT.md's wire contract locked in Wave 3.

Output: writeIdentityBountyFields exported writer, extended normalizeBounty
+ Bounty type, new WS handler + wire types. IDMEDIT-08 semantics for
meeting_questions are UI-only per SCRATCH-REPORT.md — this backend
handler will accept meeting_questions writes from ANY caller (no wire-
level enforcement), matching the plan's non-negotiable that user-reserved-
authoring is a UI convention not a wire enforcement.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extend normalizeBounty + Bounty wire type + add IdentityUpdateBountyFieldsPayload wire types</name>
  <files>src/backend/claude-session/identity-artifact-reader.ts, src/ui/api/claude-session-api.ts</files>
  <read_first>
    - src/backend/claude-session/identity-artifact-reader.ts (READ normalizeBounty at lines 171-199 — you are adding source_links, deadline, meeting_questions pass-through with safe defaults matching the pattern of existing fields like keywords/todos)
    - src/ui/api/claude-session-api.ts (READ the Bounty type at lines 282-303 — you are widening it with three new fields matching the shape SCRATCH-REPORT.md locked)
    - .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md (READ the "Locked Wire Contract" section — the shape of the meeting_questions[] array element and the format of deadline (date-only vs datetime) are decisions from Wave 3 that YOU MUST use verbatim, not re-litigate)
    - src/backend/claude-session/identity-artifact-reader.ts (READ the existing WakeupUpdate type at line 657-662 for the partial-patch type shape pattern; your new BountyFieldsPatch type follows the same "all fields optional" idiom)
  </read_first>
  <action>
Three additive changes:

1. Extend normalizeBounty (identity-artifact-reader.ts:171-199) to pass through three new fields with safe defaults:

  source_links: Array.isArray(parsed.source_links) ? parsed.source_links : [],
  deadline: typeof parsed.deadline === "string" ? parsed.deadline : (parsed.deadline === null ? null : null),
  meeting_questions: Array.isArray(parsed.meeting_questions) ? parsed.meeting_questions : [],

Placement: add after the existing `pinned:` line at 197. Do NOT change any existing field's default or type.

2. Extend the Bounty type in src/ui/api/claude-session-api.ts (lines 282-303) with three new fields matching the shape from SCRATCH-REPORT.md's Locked Wire Contract:

  source_links: string[];
  deadline: string | null;
  meeting_questions: { question: string; answered: boolean; answer?: string | null }[];

(If SCRATCH-REPORT.md locked a different meeting_question shape — e.g. slightly different property names — mirror the report's shape byte-for-byte instead of the placeholder above. Cross-check against the report.)

3. Add new wire type exports IdentityUpdateBountyFieldsPayload and IdentityBountyFieldsUpdatedEvent to src/ui/api/claude-session-api.ts, placed after IdentityBountyPriorityUpdatedEvent (line 448) and before IdentityUpdateBountyStatusPayload (line 455). Byte-shape mirror the priority payload/event pair:

  export type BountyFieldsPatch = {
    title?: string;
    premise?: string;
    todos?: { text: string; done: boolean }[];
    keywords?: string[];
    source_links?: string[];
    deadline?: string | null;
    meeting_questions?: { question: string; answered: boolean; answer?: string | null }[];
  };

  export type IdentityUpdateBountyFieldsPayload = {
    type: "identity:update-bounty-fields";
    identityKey: string;
    hostId: number;
    bountySlug: string;
    /** partial JSON patch — only fields present are written; unmentioned fields untouched. */
    patch: BountyFieldsPatch;
  };

  export type IdentityBountyFieldsUpdatedEvent = {
    type: "identity:bounty-fields-updated";
    bounties: Bounty[];
    archivedBounties: Bounty[];
    error?: string;
  };

Do NOT introduce breaking changes to Bounty consumers — additive only. All new fields have safe defaults from normalizeBounty so pre-existing callers of the read handlers get the new fields populated automatically (default [] or null).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "identity-artifact-reader\.ts|claude-session-api\.ts|error TS" | head -20 ; echo "---" ; grep -n "source_links\|deadline\|meeting_questions\|IdentityUpdateBountyFieldsPayload\|IdentityBountyFieldsUpdatedEvent\|BountyFieldsPatch" src/backend/claude-session/identity-artifact-reader.ts src/ui/api/claude-session-api.ts | head -20</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0
    - normalizeBounty return object contains source_links, deadline, and meeting_questions keys (grep confirms)
    - Bounty type in claude-session-api.ts contains source_links: string[], deadline: string | null, meeting_questions: (array shape) properties
    - IdentityUpdateBountyFieldsPayload + IdentityBountyFieldsUpdatedEvent + BountyFieldsPatch types are exported
    - Existing normalizeBounty fields (slug, id, title, premise, status, priority, pinned, keywords, requested_by, created_at, updated_at, timeline, todos) UNCHANGED
    - Existing Bounty type fields UNCHANGED
  </acceptance_criteria>
  <done>normalizeBounty widened to pass through three new fields; Bounty type widened with matching properties; three new wire types added. TypeScript clean. Read paths now surface source_links/deadline/meeting_questions to the frontend for Plan 05's editor to render.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Add writeIdentityBountyFields writer to identity-artifact-reader.ts</name>
  <files>src/backend/claude-session/identity-artifact-reader.ts</files>
  <read_first>
    - src/backend/claude-session/identity-artifact-reader.ts (READ writeIdentityBountyPriority at lines 757-813 as the exact template — LOCAL branch fs.readFile → JSON.parse → mutate → JSON.stringify → tmp+rename; REMOTE branch python3 script piped via printf. Your task adopts LOCAL branch verbatim but REPLACES the REMOTE-branch python-pipe with the SFTP tmp+rename primitive from Plan 01 — the JSON-mutation logic lives in Node process memory, not in a remote python script)
    - src/backend/claude-session/identity-artifact-reader.ts (READ writeMarkdownFileAtomic from Plan 01 — the SFTP-based tmp+rename helper you are reusing or paralleling with a companion writeJsonFileAtomic since JSON serialization happens client-side)
    - .planning/phases/18-identity-modal-full-editability-across-all-tabs/18-03-SCRATCH-REPORT.md (READ per-field validation rules and length caps if the report locked specific limits; if not, use the defaults in the action section below)
  </read_first>
  <action>
Add exported const IDMEDIT_MAX_BOUNTY_JSON_BYTES = 100_000 alongside IDMEDIT_MAX_MARKDOWN_BYTES from Plan 01.

Add exported function writeIdentityBountyFields with signature:

  export async function writeIdentityBountyFields(
    conn: SSHClientType | null,
    identityKey: string,
    bountySlug: string,
    patch: BountyFieldsPatch,
  ): Promise<void>

(Import BountyFieldsPatch from `../../ui/api/claude-session-api.ts` — the wire type is the source of truth for the patch shape. If direct backend↔frontend import is architecturally forbidden by tsconfig path config, duplicate the type inline as a local BountyFieldsPatch with a matching shape and document that it must stay in sync with the wire type; check tsconfig.json to confirm which pattern the codebase prefers before choosing.)

Placement: after writeIdentityBountyPinned (~line 950), before archiveIdentityBounty (~line 996).

Per-field validation runs BEFORE any file I/O and BEFORE either branch (mirrors writeIdentityWakeupUpdate lines 677-699):

  - if patch.title !== undefined: must be string with length <= 500; else throw "title must be a string of at most 500 chars"
  - if patch.premise !== undefined: must be string with length <= 50000
  - if patch.todos !== undefined: must be array; each element must be {text: string, done: boolean} with text.length <= 5000; else throw "todos must be an array of { text: string; done: boolean }"
  - if patch.keywords !== undefined: must be array of strings; each length <= 200
  - if patch.source_links !== undefined: must be array of strings; each length <= 2000 (do NOT validate URL scheme here unless SCRATCH-REPORT.md locked scheme validation — leave permissive by default)
  - if patch.deadline !== undefined: must be string OR null (null clears); if string, no format validation here — frontend picker enforces (permissive backend, matches existing convention for opaque strings)
  - if patch.meeting_questions !== undefined: must be array; each element must match the shape SCRATCH-REPORT.md locked (question: string, answered: boolean, answer?: string | null)
  - If ALL patch fields are undefined, throw "no updates"

Compute nowIso via `new Date().toISOString()` (matches writeIdentityBountyPriority line 767 pattern).

Build the list of changed field names from patch's own enumerable keys: `const changedFields = Object.keys(patch).filter(k => patch[k] !== undefined)`. Build timeline lines: `const timelineLines = changedFields.map(f => `${nowIso} ${f} updated via identity modal`)`.

LOCAL branch (conn === null):

  const root = getLocalIdentitiesRoot();
  const filePath = path.join(root, identityKey, "bounties", bountySlug, "bounty.json");
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  for (const k of changedFields) parsed[k] = patch[k];
  parsed.updated_at = nowIso;
  const tl = Array.isArray(parsed.timeline) ? [...parsed.timeline] : [];
  for (const line of timelineLines) tl.push(line);
  parsed.timeline = tl;
  const next = JSON.stringify(parsed, null, 2) + "\n";
  if (Buffer.byteLength(next, "utf-8") > IDMEDIT_MAX_BOUNTY_JSON_BYTES) throw new Error("bounty JSON exceeds IDMEDIT_MAX_BOUNTY_JSON_BYTES");
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, next, "utf-8");
  await fs.rename(tmpPath, filePath);
  return;

REMOTE branch (conn is SSHClientType):

  if (!IDENTITY_KEY_RE.test(identityKey)) throw new Error("invalid identityKey");
  if (!IDENTITY_SLUG_RE.test(bountySlug)) throw new Error("invalid bounty slug");
  // Derive remote home path via execWithTimeout (fixed command, no shell-inject surface)
  const remoteHome = await execWithTimeout(conn, "echo $HOME");
  const targetPath = `${remoteHome.trim()}/.claude/identities/${identityKey}/bounties/${bountySlug}/bounty.json`;
  // Read current bounty.json via SFTP
  const currentBytes = await sftpReadFile(conn, targetPath); // helper — sftp.readFile promise-wrap
  const parsed = JSON.parse(currentBytes.toString("utf-8")) as Record<string, unknown>;
  for (const k of changedFields) parsed[k] = patch[k];
  parsed.updated_at = nowIso;
  const tl = Array.isArray(parsed.timeline) ? [...parsed.timeline] : [];
  for (const line of timelineLines) tl.push(line);
  parsed.timeline = tl;
  const next = JSON.stringify(parsed, null, 2) + "\n";
  if (Buffer.byteLength(next, "utf-8") > IDMEDIT_MAX_BOUNTY_JSON_BYTES) throw new Error("bounty JSON exceeds IDMEDIT_MAX_BOUNTY_JSON_BYTES");
  // Write via SFTP tmp+rename — reuse or parallel Plan 01's writeMarkdownFileAtomic
  await writeMarkdownFileAtomic(conn, targetPath, next);  // handler accepts arbitrary UTF-8 contents; despite the name, it is generic to any text file

Consider renaming Plan 01's writeMarkdownFileAtomic to writeTextFileAtomic to reflect its actual generic nature — do so in this task, updating both call sites in Plan 01's markdown writers AND the new call here. If rename is objected to by the executor, add a new writeJsonFileAtomic that is a byte-shape copy (accept the duplication).

Add a private sftpReadFile helper alongside the existing helpers (~line 165): `async function sftpReadFile(conn: SSHClientType, remotePath: string): Promise<Buffer>` — promise-wraps conn.sftp then sftp.readFile then sftp.end() in finally. Returns Buffer (readFile default). This helper mirrors the shape of Plan 01's writeMarkdownFileAtomic promise-wrap discipline.

Do NOT enforce meeting_questions user-reserved-authoring at the wire layer (per SCRATCH-REPORT.md IDMEDIT-08 Semantics — semantics are UI convention only, not wire enforcement). Do NOT surface pinned in the patch shape (pinned has its own handler via writeIdentityBountyPinned).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "identity-artifact-reader\.ts|error TS" | head -20 ; echo "---" ; grep -n "^export async function writeIdentityBountyFields\|^export const IDMEDIT_MAX_BOUNTY_JSON_BYTES\|async function sftpReadFile" src/backend/claude-session/identity-artifact-reader.ts</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0
    - grep prints writeIdentityBountyFields export, IDMEDIT_MAX_BOUNTY_JSON_BYTES export, sftpReadFile private helper
    - LOCAL branch contains fs.readFile → JSON.parse → for-loop merge → JSON.stringify → tmp+rename pattern
    - REMOTE branch contains IDENTITY_KEY_RE and IDENTITY_SLUG_RE gates before path interpolation
    - Both branches append one timeline entry per changed field key
    - Both branches bump updated_at to a fresh ISO-Z timestamp
    - Byte-cap check via Buffer.byteLength on serialized JSON runs BEFORE the write on both branches
    - Per-field type validation runs BEFORE either branch dispatches (single validation block at top of function)
  </acceptance_criteria>
  <done>writeIdentityBountyFields is exported; performs partial JSON patch with updated_at bump + per-field timeline appends; atomic tmp+rename on both LOCAL and REMOTE branches; per-field validation prevents malformed writes; byte-cap prevents JSON bloat.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Add identity:update-bounty-fields WS handler to claude-session-server.ts</name>
  <files>src/backend/claude-session/claude-session-server.ts</files>
  <read_first>
    - src/backend/claude-session/claude-session-server.ts (READ the identity:update-bounty-priority handler at line 2447-2510 as your byte-shape template — you replicate its exact structure but call writeIdentityBountyFields and echo identity:bounty-fields-updated instead)
    - src/ui/api/claude-session-api.ts (READ IdentityUpdateBountyFieldsPayload + IdentityBountyFieldsUpdatedEvent from Task 1 — server-side handler mirrors the payload shape for validation and mirrors the event shape for emission)
    - src/backend/claude-session/identity-artifact-reader.ts (READ your new writeIdentityBountyFields signature from Task 2 — the handler dispatches to it with the correct argument shape)
  </read_first>
  <action>
Add one new WS handler branch to claude-session-server.ts. Placement: after the existing identity:update-bounty-pinned handler block, before the identity:archive-bounty handler at line 2164 (or wherever it lands after Plan 01's insertions — keep the identity write handlers grouped).

Import writeIdentityBountyFields from identity-artifact-reader.ts alongside the existing bounty-write imports at the top of the file.

Handler shape (mirror identity:update-bounty-priority at lines 2450-2510):

  if (msg.type === "identity:update-bounty-fields") {
    const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; patch?: unknown };
    const rawKey = raw.identityKey;
    const rawSlug = raw.bountySlug;
    const rawPatch = raw.patch;
    if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
      try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch { /* ignore */ }
      return;
    }
    if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
      try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch { /* ignore */ }
      return;
    }
    if (typeof rawPatch !== "object" || rawPatch === null) {
      try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid patch" })); } catch { /* ignore */ }
      return;
    }
    // (Per-field type validation runs inside writeIdentityBountyFields; this handler-level check only ensures top-level shape is an object.)
    const identityKey = rawKey;
    const bountySlug = rawSlug;
    const patch = rawPatch as BountyFieldsPatch;
    const rawHostId = raw.hostId;
    const hostIdNum = typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0 ? rawHostId : undefined;
    const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
    try {
      let bounties: unknown[]; let archivedBounties: unknown[];
      if (useLocal) {
        await writeIdentityBountyFields(null, identityKey, bountySlug, patch);
        ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
        sshLogger.info("identity:update-bounty-fields", { operation: "identity_update_bounty_fields", userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: true, fields: Object.keys(patch).join(",") });
      } else {
        const resolved = await resolveHostById(hostIdNum!, userId!);
        if (!resolved) { try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch { /* ignore */ } return; }
        const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
        try {
          await writeIdentityBountyFields(conn, identityKey, bountySlug, patch);
          ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
          sshLogger.info("identity:update-bounty-fields", { operation: "identity_update_bounty_fields", userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: false, fields: Object.keys(patch).join(",") });
        } finally { try { conn.end(); } catch { /* ignore */ } }
      }
      try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties, archivedBounties })); } catch { /* ignore */ }
    } catch (err) {
      sshLogger.error("identity:update-bounty-fields unexpected error", err instanceof Error ? err : new Error(String(err)), { operation: "identity_update_bounty_fields_error", userId, identityKey, bountySlug, hostId: hostIdNum });
      try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) })); } catch { /* ignore */ }
    }
    return;
  }

Update the header docblock to include the new client→server and server→client wire strings.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | grep -E "claude-session-server\.ts|error TS" | head -20 ; echo "---" ; grep -c "identity:update-bounty-fields\|identity:bounty-fields-updated\|writeIdentityBountyFields" src/backend/claude-session/claude-session-server.ts</automated>
  </verify>
  <acceptance_criteria>
    - npx tsc --noEmit exits 0
    - grep count is at least 5 (each of the two wire strings appears at least twice — header docblock + handler — plus the writeIdentityBountyFields import + call)
    - Handler contains IDENTITY_KEY_RE and IDENTITY_SLUG_RE gates before dispatch (grep confirms both regex names in the handler block)
    - Handler contains useLocal-ternary branching for LOCAL vs REMOTE dispatch
    - REMOTE branch has try/finally { conn.end() } closer
    - Handler emits identity:bounty-fields-updated on both success (with fresh bounty lists) and error (with empty lists + error string)
  </acceptance_criteria>
  <done>identity:update-bounty-fields WS handler added, calls writeIdentityBountyFields then re-reads bounty lists for fresh-list echo. TypeScript clean. Existing bounty handlers (priority/status/pinned/archive/delete) unchanged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser bounty-field editor → WS server | Partial patch object is fully-user-controlled; travels via authenticated WS to server for shape + per-field validation + write |
| WS server → bounty.json on disk | identityKey + bountySlug regex-validated at handler; per-field types validated inside writer; SFTP-based write on REMOTE (no shell interpolation) |
| Server-side merge → bounty.json | Client-supplied patch merges into server-read parsed JSON; server-authoritative fields (id, created_at, updated_at, timeline) are managed by the WRITER not the patch — client cannot overwrite them via a malformed patch (server explicitly assigns them post-merge in writeIdentityBountyFields) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-18-17 | Elevation of Privilege | client sends patch with { id: "attacker-uuid" } trying to change bounty id or timeline | mitigate | writeIdentityBountyFields explicitly enumerates ALLOWED patch keys in its per-field validation block AND uses `for (const k of changedFields) parsed[k] = patch[k]` where changedFields is derived from the KNOWN key list, NOT from Object.keys(patch). Additional harden: after the for-loop, unconditionally re-assign parsed.updated_at = nowIso and rebuild parsed.timeline — overwriting any client attempt to hijack. Client-supplied id / created_at values are silently ignored (parsed.id retains original from the disk read). |
| T-18-18 | Tampering | shell metacharacters in bountySlug | mitigate | IDENTITY_SLUG_RE gate before path interpolation at the handler AND inside writeIdentityBountyFields REMOTE branch (defense in depth). IDENTITY_SLUG_RE = /^[a-z0-9_-]{1,80}$/i rejects `/`, `..`, shell metacharacters. |
| T-18-19 | Denial of Service | unbounded meeting_questions[] or todos[] array in patch bloats bounty.json | mitigate | IDMEDIT_MAX_BOUNTY_JSON_BYTES = 100_000 hard cap on serialized post-patch JSON; oversized throws before write. Per-field length validation on individual strings (todos.text <= 5000, meeting_question <= 5000, keywords <= 200 each) prevents any single malformed element from bypassing the cap trivially. |
| T-18-20 | Information Disclosure | writeIdentityBountyFields error string leaks server-side path info | mitigate | All throws use static strings ("invalid identityKey", "bounty JSON exceeds IDMEDIT_MAX_BOUNTY_JSON_BYTES", "todos must be an array of ..."). SSH-layer exceptions from execWithTimeout / SFTP CAN leak paths and are re-emitted via the echo's error field — accepted, same posture as existing update-bounty-priority handler; Ashley is sole user. |
| T-18-21 | Repudiation | agent flow adds a meeting_question via the new wire | accept | Per IDMEDIT-08 semantics, meeting_questions[] user-reserved-authoring is a UI CONVENTION not a wire enforcement. The wire handler accepts meeting_questions writes from any authenticated WS caller. If an agent flow ever wanted to add one, it would be a WORKFLOW violation not a security violation, and would be visible in the bounty.json timeline entries (`<ISO-Z> meeting_questions updated via identity modal`). Wire-level enforcement was explicitly rejected in Wave 3 SCRATCH-REPORT.md. |
| T-18-22 | Tampering | patch overwrites server-owned fields (updated_at, timeline) | mitigate | Writer's post-merge overwrite of updated_at + timeline is unconditional — client cannot suppress the bump. `for (const k of changedFields) parsed[k] = patch[k]` uses the derived changedFields list not raw Object.keys(patch), so any client-supplied `updated_at` in the patch is silently dropped before overwrite. |
| T-18-SC | Tampering | npm/pip/cargo installs | mitigate | No new packages installed. |
</threat_model>

<verification>
- npx tsc --noEmit exits 0
- npx vitest run passes (no new tests added; existing bounty tests unchanged)
- grep confirms writer + normalizer + wire types all reference source_links/deadline/meeting_questions
- Manual sanity: with Skynet running, send a manual WS payload `{ type: "identity:update-bounty-fields", identityKey: "tina", hostId: <local>, bountySlug: "file-editing-in-identity-modal", patch: { title: "test-title-change" } }` and confirm the echo returns identity:bounty-fields-updated with fresh bounty lists AND that the bounty.json on disk has updated_at bumped + one new timeline entry
</verification>

<success_criteria>
- writeIdentityBountyFields exported and works on both LOCAL and REMOTE branches
- normalizeBounty widened to pass through source_links / deadline / meeting_questions
- Bounty wire type widened to match
- identity:update-bounty-fields WS handler registered with fresh-list echo
- Per-field validation prevents malformed writes (throws with truthful messages)
- Byte-cap prevents JSON bloat
- Server-owned fields (updated_at, timeline) protected against client-supplied overwrite via changedFields enumeration + unconditional post-merge reassignment
- Existing bounty handlers untouched
</success_criteria>

<output>
Create `.planning/phases/18-identity-modal-full-editability-across-all-tabs/18-04-SUMMARY.md` when done.
</output>
