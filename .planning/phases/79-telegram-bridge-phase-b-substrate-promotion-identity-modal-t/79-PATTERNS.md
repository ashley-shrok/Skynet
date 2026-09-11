# Phase 79: Telegram bridge Phase B — Pattern Map

**Mapped:** 2026-09-06
**Files analyzed:** 22 (11 new / 11 modified)
**Analogs found:** 21 / 22 (one NEW-pattern file: `bridge-config-writer.ts` — see § No Analog Found)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| **NEW — Substrate (fleet-shipped)** | | | | |
| `substrate/scripts/tg-bridge.sh` | substrate script | event-driven (Telegram getUpdates poll + Matrix /sync) | `substrate/scripts/agent-supervisor.sh` (loop shape) + `substrate/skills/agent-relay/recv.sh` (cursor persistence) | exact-role, exact-flow |
| `substrate/user-onboarding/tg-bridge.service` | systemd unit (USER scope per Alice's decision #2) | systemd `Restart=always` supervisor | `substrate/user-onboarding/agent-supervisor.service` | exact |
| **NEW — Backend** | | | | |
| `src/backend/telegram/tokens-store.ts` | service (FieldCrypto CRUD store) | CRUD (per-identity encrypted row) | `src/backend/matrix/matrix-admin-creds-store.ts` | exact-shape (only diff: per-key vs singleton) |
| `src/backend/telegram/routes.ts` | controller (Express router) | request-response | `src/backend/matrix/matrix-admin-routes.ts` | exact |
| `src/backend/telegram/bridge-config-writer.ts` | service (file writer to bind-mount) | file I/O (write registry.json + `<human>.token` + config.env to `/var/lib/tg-bridge/`) | NEW pattern — closest partial: identity-birth-orchestrator's SFTP-write step (`identity-birth-orchestrator.ts:562-584`) but that's remote-SSH; this is local fs. See § No Analog Found. | partial |
| `src/backend/telegram/telegram-getme-proxy.ts` | service (external HTTP proxy) | request-response (backend → Telegram Bot API) | `src/backend/matrix/matrix-admin-client.ts:127-171` (`loginAsUser`) — same fetch+AbortController+timeout+non-2xx shape | exact-flow |
| `src/backend/config/media-endpoints.ts` (shared TS constant module) | config module | pure constants (imported at module-load) | Grep found NO existing `src/backend/config/` dir OR shared endpoint constants — currently `STT_URL` is inline in `voice.ts:28`. See § No Analog Found for the new-pattern rationale (Alice decision #3). | no-analog |
| `src/backend/matrix/reconcile-dead-tokens.ts` (or extend matrix admin service) | service (periodic sweep) | file I/O sentinel scan → mint via admin → overwrite `.token` → delete sentinel | Phase 73 reconcile-loop shape at `src/backend/distributor/run-sweep.ts` + `sweep-logic.ts` (per-host iterate → detect drift → act). See § Pattern Assignments for concrete excerpt. | role-match |
| **NEW — Frontend** | | | | |
| `src/ui/features/pretty-view/TelegramTab.tsx` | React component (tab in modal) | request-response (POST /telegram/*) | `src/ui/features/pretty-view/HandoffTab.tsx` (single-credential, save/error surface, `TabState<T>` prop) | exact |
| `src/ui/features/pretty-view/TelegramTab.test.tsx` | test | react-testing-library | `src/ui/features/pretty-view/WakeupsTab.test.tsx` (RTL testing pattern for tab modals) | exact |
| `src/ui/api/telegram-api.ts` | frontend fetch wrapper | request-response | `src/ui/api/voice-api.ts` (`authApi.post` + `handleApiError`) | exact |
| **MODIFIED — Schema + storage** | | | | |
| `src/backend/database/db/schema.ts` — add `telegramBotTokens` | schema | drizzle table declaration | `matrixAdminCreds` at schema.ts:680-692 | exact |
| `src/backend/database/db/index.ts` — add `CREATE TABLE telegram_bot_tokens` | migration | DDL at boot + `forceSave` | `matrix_admin_creds` CREATE at index.ts:329-337 + `forceSave` block at index.ts:893-894 | exact |
| `src/backend/utils/field-crypto.ts` — add `telegram_bot_tokens: new Set(["bot_token"])` | config | ENCRYPTED_FIELDS registry | field-crypto.ts:17-50 (specifically line 50 `matrix_admin_creds` entry) | exact |
| **MODIFIED — Distributor** | | | | |
| `src/backend/distributor/catalog.ts` — add 2 entries (tg-bridge.sh + .service) | config | data-only catalog | catalog.ts:186-191 (agent-supervisor row) + catalog.ts:234-239 (agent-supervisor.service row) | exact |
| **MODIFIED — Routes** | | | | |
| `src/backend/matrix/creds-store.ts` — MAYBE add `getMatrixHomeserverBase()` helper | service (extend existing store) | CRUD read | existing `getMatrixAdminCreds()` at matrix-admin-creds-store.ts:64-97 — one-line helper wraps it | exact (in-file extension) |
| `src/backend/matrix/routes.ts` — add `POST /matrix-admin/migrate-cred-files` | controller (extend existing router) | request-response | `POST /matrix-admin/creds` at matrix-admin-routes.ts:30-102 | exact (parallel handler in same file) |
| `src/backend/database/routes/voice.ts` — replace hardcoded STT_URL with import | refactor | one-line change | voice.ts:28 → `import { STT_URL } from "../../config/media-endpoints.js"` | trivial |
| `src/backend/database/database.ts` — mount `/telegram` router + wire migrate route | router mount | request-response | database.ts:22 (import matrix-admin) + database.ts:1818 (`app.use("/matrix-admin", …)`) | exact |
| **MODIFIED — Frontend** | | | | |
| `src/ui/features/pretty-view/IdentityModal.tsx` — extend `NAV_SECTIONS_IDENTITY` (4-line edit at lines 314-319) + add `<TabsContent value="telegram">` (block at ~2186) | component (surgical edit) | request-response | IdentityModal.tsx:314-319 (existing array literal) + IdentityModal.tsx:2177-2186 (existing `<TabsContent value="handoff">` block) | exact (add a fourth row) |
| **MODIFIED — Nginx (CLAUDE.md caveat — BOTH files)** | | | | |
| `docker/nginx.conf` — add `location ~ ^/telegram(/.*)?$` | config | HTTP proxy rule | nginx.conf:153-162 (`/matrix-admin` block) | exact (copy + rename path) |
| `docker/nginx-https.conf` — same block | config | HTTP proxy rule | nginx-https.conf:164-173 (`/matrix-admin` block) | exact (copy + rename path) |
| **MODIFIED — Docker deploy (orchestrator-owned per fleet rule)** | | | | |
| `/opt/skynet/docker-compose.yml` — add `/var/lib/tg-bridge/` bind-mount to `skynet` service | config | rw bind-mount | Phase 70 branding bind-mount at `/opt/skynet/docker-compose.yml` lines 19-25 (verified live via cat) | exact-shape (RW instead of read_only) |
| **MODIFIED — Host DB seed (Alice decision #1: wire SSH cred to host id 6)** | | | | |
| Skynet host DB — attach `credentialId` on host id 6 ("Skynet") | data seed | one-off UPDATE row | `PUT /host/:id` update handler at `src/backend/database/routes/host.ts:1075-1084` (existing `credentialId` update path) — trigger via existing HTTP endpoint, no new code | exact (existing HTTP surface) |

---

## Pattern Assignments

### `substrate/scripts/tg-bridge.sh` (substrate script, event-driven)

**Analog A: `substrate/scripts/agent-supervisor.sh`** (loop-shape + config-source pattern)

Load config from a sourced bash file, exit loud if unset (mirror for reading `config.env` bind-mount):
```bash
# Source: substrate/scripts/agent-supervisor.sh:28, 40-54 (VERIFIED)
CONF="${AGENT_SUPERVISOR_CONF:-$HOME/.claude/agent-supervisor.conf}"
# ---- config ----
MODE=""
IDENTITIES=()
CHECK_INTERVAL=15
STAGGER_SECONDS=8
[ -f "$CONF" ] && . "$CONF"
if [ -z "${MODE:-}" ]; then log "no MODE in $CONF (set MODE=A or MODE=B) — nothing to do"; exit 1; fi
```

For Phase B, source `/var/lib/tg-bridge/config.env` which Skynet writes at startup with `MATRIX_ROOT=…` and `STT_URL=…`. Bounded retry loop (5s × 60 tries) if the file is absent on first boot per RESEARCH.md Assumption A9.

Fail-loud dependency check pattern (mirror for `jq`/`curl` sanity on tg-bridge start):
```bash
# Source: substrate/scripts/agent-supervisor.sh:75-80 (VERIFIED)
if ! command -v tmux >/dev/null 2>&1; then
  log "tmux not found on PATH — cannot supervise. Install it..."
  exit 1
fi
```

**Analog B: `substrate/skills/agent-relay/recv.sh`** (Matrix `since` cursor persistence — Phase B's load-bearing reliability delivery)

Resume-across-restart pattern (verbatim template for `<human>.since`):
```bash
# Source: substrate/skills/agent-relay/recv.sh:102 (VERIFIED)
SINCE=$(cat "$SINCE_FILE" 2>/dev/null)
# If SINCE is empty on entry (fresh identity's first wake, or a corrupted/blank cursor file),
# the main-loop's first iteration below detects that and hits the INITIAL-SYNC path...
```

CURSOR GUARD — critical for restart safety:
```bash
# Source: substrate/skills/agent-relay/recv.sh:226-235 (VERIFIED)
# CURSOR GUARD (critical): only advance the cursor when this sync actually returned a
# next_batch. A homeserver restart (reboot / upgrade / config change) cuts EVERY receiver's
# long-poll at once, so $R comes back empty. The old code blindly wrote that empty value to
# the cursor file; the NEXT sync then sent an empty `since`, which the server treats as an
# INITIAL sync and replays the last ~100 messages as if new...
NB=$(jq -r '.next_batch // empty' <<<"$R" 2>/dev/null)
if [ -z "$NB" ]; then sleep 3; continue; fi
SINCE="$NB"; printf '%s' "$SINCE" > "$SINCE_FILE"
```

Phase B's `mx_sync_for_human()` in `tg-bridge.sh` gets:
- `SINCE_FILE="$REGISTRY_DIR/${human}.since"` at function top
- `since=$(cat "$SINCE_FILE" 2>/dev/null)` before initial-sync-retry loop
- If `since` non-empty on entry, skip initial `?timeout=0` sync
- Write `since` to `$SINCE_FILE` on every cursor advance
- **Delete the entire `<human>.cred` + `relogin()` code path** — Skynet writes `.token` files via `matrix-admin-client.loginAsUser`; on 401, bridge writes a `.token-dead` sentinel and continues (see § Shared Patterns / Dead-token detection).

---

### `substrate/user-onboarding/tg-bridge.service` (systemd unit — USER scope)

**Analog:** `substrate/user-onboarding/agent-supervisor.service` (VERIFIED verbatim shape)

```ini
# Source: substrate/user-onboarding/agent-supervisor.service (VERIFIED)
[Unit]
Description=Agent supervisor — keep this box's /id Claude Code sessions alive
After=default.target

[Service]
Type=simple
ExecStart=%h/.local/bin/agent-supervisor
Restart=always
RestartSec=10
KillMode=process
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
```

**Phase B tg-bridge.service (Alice decision #2 — USER scope, mirrors this exactly):**
```ini
[Unit]
Description=Telegram ↔ Matrix bridge — Apple-Watch reachability for the fleet
After=default.target

[Service]
Type=simple
ExecStart=%h/.local/bin/tg-bridge
Restart=always
RestartSec=5
KillMode=mixed
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
```

Notes: `RestartSec=5` (vs 10) matches Nina's live unit; `KillMode=mixed` matches Nina's live unit (`agent-supervisor` uses `process` because it supervises tmux sessions that must survive a supervisor restart — the bridge has no such invariant, `mixed` cleans up bash + child curl polls).

**Install path:** `~/.config/systemd/user/tg-bridge.service` (matches agent-supervisor at catalog.ts:237). USER scope needs `loginctl enable-linger ubuntu` on t1000 (already set per RESEARCH.md — verified via Alice's other USER-scoped units running post-logout).

---

### `src/backend/telegram/tokens-store.ts` (service, CRUD)

**Analog:** `src/backend/matrix/matrix-admin-creds-store.ts` (VERIFIED — 177 lines, verbatim template)

**Imports pattern** (lines 24-30):
```typescript
// Source: src/backend/matrix/matrix-admin-creds-store.ts:24-30
import { eq } from "drizzle-orm";
import { db } from "../database/db/index.js";
import { matrixAdminCreds } from "../database/db/schema.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";
```

**Core CRUD pattern — encrypt-on-write** (lines 113-160):
```typescript
// Source: src/backend/matrix/matrix-admin-creds-store.ts:113-160 (VERIFIED)
export async function setMatrixAdminCreds(creds: MatrixAdminCreds): Promise<void> {
  const masterKey = await SystemCrypto.getInstance().getEncryptionKey();

  const encryptedAccessToken = FieldCrypto.encryptField(
    creds.accessToken,
    masterKey,
    SINGLETON_ID_STR,
    FIELD_ACCESS_TOKEN,
  );
  // ... same for password ...

  const existing = await db
    .select({ id: matrixAdminCreds.id })
    .from(matrixAdminCreds)
    .where(eq(matrixAdminCreds.id, SINGLETON_ID))
    .limit(1);

  const nowIso = new Date().toISOString();

  if (existing && existing.length > 0) {
    await db.update(matrixAdminCreds).set({ … }).where(eq(…));
  } else {
    await db.insert(matrixAdminCreds).values({ id: SINGLETON_ID, …, createdAt: nowIso, updatedAt: nowIso });
  }
```

**Decrypt-on-read pattern** (lines 64-97):
```typescript
// Source: src/backend/matrix/matrix-admin-creds-store.ts:64-97 (VERIFIED)
export async function getMatrixAdminCreds(): Promise<MatrixAdminCreds | null> {
  const rows = await db.select().from(matrixAdminCreds).where(eq(matrixAdminCreds.id, SINGLETON_ID)).limit(1);
  if (!rows || rows.length === 0) return null;

  const row = rows[0];
  const masterKey = await SystemCrypto.getInstance().getEncryptionKey();
  const accessToken = FieldCrypto.decryptField(row.accessToken, masterKey, SINGLETON_ID_STR, FIELD_ACCESS_TOKEN);
  // ...
  return { homeserverBase: row.homeserverBase, userId: row.userId, accessToken, password };
}
```

**Persist-to-disk trigger** (lines 162-175):
```typescript
// Source: src/backend/matrix/matrix-admin-creds-store.ts:162-175 (VERIFIED)
try {
  await DatabaseSaveTrigger.triggerSave("matrix_admin_creds_save");
} catch (saveError) {
  databaseLogger.warn(
    "[phase-75] matrix_admin_creds triggerSave failed (non-fatal — write is in RAM, next save fires it)",
    { operation: "matrix_admin_creds_save_failed", error: saveError },
  );
}
```

**Phase B key diffs vs. analog:**
- Not a singleton — pk is `identityKey` (string). `SINGLETON_ID_STR` → `String(identityKey)` per record in `FieldCrypto.encryptField` HKDF context.
- `ENCRYPTED_FIELDS` map key: `"bot_token"` (single encrypted column).
- `triggerSave` reason string: `"telegram_bot_tokens_save"`.
- Export functions: `getTelegramBotToken(identityKey)`, `setTelegramBotToken(identityKey, {botToken, botUsername, humanUserId, telegramChatId})`, `deleteTelegramBotToken(identityKey)`, `listTelegramBotTokens()` (all rows for the reconcile pass).

---

### `src/backend/telegram/routes.ts` (controller, request-response)

**Analog:** `src/backend/matrix/matrix-admin-routes.ts` (VERIFIED — 127 lines)

**Imports + router setup** (lines 14-28):
```typescript
// Source: src/backend/matrix/matrix-admin-routes.ts:14-28 (VERIFIED)
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../utils/auth-manager.js";
import { authLogger } from "../utils/logger.js";
import type { AuthenticatedRequest } from "../../types/index.js";
import { setMatrixAdminCreds, getMatrixAdminCreds } from "./matrix-admin-creds-store.js";

const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;

const router = express.Router();
const authManager = AuthManager.getInstance();
const requireAdmin = authManager.createAdminMiddleware();
```

**POST handler shape — validate + write + save + log + respond** (lines 30-102):
```typescript
// Source: src/backend/matrix/matrix-admin-routes.ts:30-102 (VERIFIED)
router.post(
  "/creds",
  express.json(),
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const adminUserId = (req as AuthenticatedRequest).userId;
    const { homeserverBase, userId: mxid, password, accessToken } = (req.body ?? {}) as Record<string, unknown>;

    // Guard each field with early return + 400
    if (typeof homeserverBase !== "string" || !/^https?:\/\/[^\s]+$/.test(homeserverBase)) {
      res.status(400).json({ error: "homeserverBase must be an http(s) URL" }); return;
    }
    // ... (identical shape for the other fields) ...

    try {
      const existing = await getMatrixAdminCreds();
      const isRotation = existing !== null;

      await setMatrixAdminCreds({ homeserverBase, userId: mxid, password, accessToken });

      // Then explicit disk-flush + error log
      try {
        const { saveMemoryDatabaseToFile } = await import("../database/db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error("Failed to persist matrix-admin creds to disk", saveError, {
          operation: "matrix_admin_creds_save_failed",
        });
      }

      authLogger.info("matrix-admin creds ingested", {
        operation: isRotation ? "matrix_admin_creds_rotate" : "matrix_admin_creds_ingest",
        adminId: adminUserId, mxid, homeserverBase,
      });

      res.json({ ok: true, mxid, rotation: isRotation });
    } catch (err) {
      authLogger.error("Failed to ingest matrix-admin creds", err);
      res.status(500).json({ error: "Failed to ingest matrix-admin creds" });
    }
  },
);
```

**GET handler shape** (lines 104-124):
```typescript
// Source: src/backend/matrix/matrix-admin-routes.ts:104-124 (VERIFIED)
router.get(
  "/creds",
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const creds = await getMatrixAdminCreds();
      if (!creds) { res.json({ present: false }); return; }
      res.json({ present: true, mxid: creds.userId, homeserverBase: creds.homeserverBase });
    } catch (err) {
      authLogger.error("Failed to read matrix-admin creds metadata", err);
      res.status(500).json({ error: "Failed to read matrix-admin creds metadata" });
    }
  },
);

export default router;
```

**Phase B route family** (in `src/backend/telegram/routes.ts`):
- `POST /telegram/validate` — proxy `getMe` via `telegram-getme-proxy.ts` (auth: user, not admin)
- `POST /telegram/activate` — write DB row + bridge files + trigger restart (auth: user + own-identity check)
- `POST /telegram/disconnect` — clear DB row + rewrite bridge files + trigger restart
- `GET /telegram/:identityKey` — status view for the tab (auth: user + own-identity check)
- `POST /telegram/restart` — retry restart (admin OR own-identity)

**Admin-gate for the migration route** (belongs in `matrix-admin/routes.ts` per Alice decision #5):
- `POST /matrix-admin/migrate-cred-files` — mirrors `POST /matrix-admin/creds` exactly (same file, same middleware, same error shape); body is empty (idempotent one-shot); returns `{ok:true, minted:["alice","zoey"], deleted:["alice.cred","zoey.cred"]}`.

---

### `src/backend/telegram/telegram-getme-proxy.ts` (service, request-response)

**Analog:** `src/backend/matrix/matrix-admin-client.ts:127-171` (`loginAsUser`)

**External-HTTP proxy pattern** (lines 138-171):
```typescript
// Source: src/backend/matrix/matrix-admin-client.ts:138-171 (VERIFIED)
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  if (!response.ok) {
    return { ok: false, status: response.status, error: ERR_NON_2XX };
  }
  const parsed = (await response.json()) as { access_token?: string };
  const accessToken = parsed.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { ok: false, status: 500, error: ERR_NO_TOKEN };
  }
  return { ok: true, accessToken };
} catch (err: unknown) {
  clearTimeout(timeoutId);
  if (err instanceof DOMException && err.name === "AbortError") {
    return { ok: false, status: 504, error: ERR_TIMEOUT };
  }
  databaseLogger.error("matrix admin proxy error", err, { operation: "matrix_admin_login_as_user" });
  return { ok: false, status: 502, error: ERR_PROXY };
}
```

**Phase B adaptations for `validateBotToken(token)`:**
- URL: `` `https://api.telegram.org/bot${encodeURIComponent(token)}/getMe` ``
- Method: `GET` (no body, no Authorization header)
- Timeout: 10_000 ms (Telegram is fast)
- Response shape parsed as `{ ok: boolean; result?: { id: number; username?: string; first_name?: string }; description?: string }`
- Return `{ok:true, botUsername, botId, firstName}` or `{ok:false, error}`
- Never log the token value; log `operation: "telegram_getme_proxy"` + `botUsername` only

---

### `src/backend/matrix/reconcile-dead-tokens.ts` (service, sentinel-scan sweep)

**Analog:** Phase 73 fleet-substrate reconcile-loop at `src/backend/distributor/run-sweep.ts` + `sweep-logic.ts`.

**Core reconcile shape:** iterate a list of items → detect drift → act. Phase B applies this to `/var/lib/tg-bridge/*.token-dead` sentinels.

**Alice decision #4 sentinel-file flow:**
1. Bridge on any Matrix 401 writes `${REGISTRY_DIR}/<human>.token-dead` (empty file; sentinel).
2. Skynet's reconcile pass (interval: 30s, or on demand from `POST /telegram/reconcile`) does:
   - `fs.readdirSync("/var/lib/tg-bridge")` → filter for `*.token-dead`
   - For each dead human: `await loginAsUser(mxid)` (from `matrix-admin-client.ts:127`) → overwrite `<human>.token` (0600 via `fs.writeFile` + `fs.chmod`) → delete `<human>.token-dead`
   - Trigger bridge restart (single restart batch after all mints — mirror sweep-logic.ts's "restart-once-per-sweep" pattern)

**Restart-trigger pattern** (from `src/backend/distributor/ssh-push.ts:211-242`, VERIFIED):
```typescript
// Source: src/backend/distributor/ssh-push.ts:211-242 (VERIFIED)
export async function restartUserUnit(
  channel: SshChannel,
  unitName: string,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  try {
    const escapedUnit = shellSingleQuote(unitName);
    const cmd = `systemctl --user restart ${escapedUnit} && echo __RESTART_OK__ || echo __RESTART_FAIL__`;
    const raw = await channel.exec(cmd);
    if (raw === null) return { ok: false, errorMessage: "channel returned null" };
    const trimmed = raw.trimEnd();
    if (trimmed.endsWith("__RESTART_OK__")) return { ok: true };
    return { ok: false, errorMessage: trimmed.slice(0, 500) || "systemctl restart failed" };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : "unknown throw" };
  }
}
```

**Phase B key diff:** for the self-Skynet host (t1000), the SSH channel is against `host id 6` (per Alice decision #1) — same code path as every other substrate host after the credential wire-up. USER-scoped (per decision #2) so this `--user` command stays as-is (no changes to `ssh-push.ts` needed).

---

### `src/ui/features/pretty-view/TelegramTab.tsx` (React component)

**Analog:** `src/ui/features/pretty-view/HandoffTab.tsx` (VERIFIED — 200 lines, closest single-credential tab)

**Props signature** (lines 22-36):
```typescript
// Source: src/ui/features/pretty-view/HandoffTab.tsx:22-36 (VERIFIED)
export function HandoffTab({
  state,
  isCoordinator,
  onSave,
}: {
  state: TabState<string>;
  isCoordinator: boolean;   // required (Phase 72 Plan 04 Task 1 — non-optional)
  onSave?: (contents: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
```

**Loading/error/empty branches** (lines 83-107):
```typescript
// Source: src/ui/features/pretty-view/HandoffTab.tsx:83-107 (VERIFIED)
if (state.status === "loading") {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
    </div>
  );
}
if (state.status === "error") {
  return <div className="text-sm text-[color:var(--color-pv-code-fg)]">Couldn't load handoff: {state.error}</div>;
}
if (!state.data) {
  return <div className="text-sm text-[var(--color-pv-fg-muted)]">No handoff carry (fresh session or first run).</div>;
}
```

**Save flow with confirm/cancel/error surface** (lines 57-81):
```typescript
// Source: src/ui/features/pretty-view/HandoffTab.tsx:57-81 (VERIFIED)
async function handleSave() {
  if (!onSave) return;
  setSaving(true);
  setSaveError(null);
  try {
    await onSave(draft);
    setEditing(false);
  } catch (e) {
    setSaveError(e instanceof Error ? e.message : String(e));
  } finally {
    setSaving(false);
  }
}

function handleCancel() {
  const confirmedMarkdown = state.status === "ready" ? state.data : "";
  if (draft === confirmedMarkdown) { setEditing(false); }
  else {
    if (window.confirm("Discard unsaved changes?")) {
      setEditing(false);
      setDraft(confirmedMarkdown);
    }
  }
}
```

**Phase B TelegramTab per RESEARCH.md § Q10 answer:**
```tsx
// Phase B state shape (state discriminant maps to RESEARCH.md § 3A/3B/3D):
type TelegramState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "unconfigured" }                                     // no DB row → paste-token UI
  | { status: "pending-start"; botUsername: string; botLink: string }  // token accepted, waiting on /start
  | { status: "connected"; botUsername: string; telegramHandle: string }  // 3A minimal view
  | { status: "restart-failed"; error: string };                   // 3B: bridge didn't come back

export function TelegramTab({
  state, hue, identityKey, humanUserId,
  onValidate,  // POST /telegram/validate
  onActivate,  // POST /telegram/activate (after Confirm)
  onDisconnect,  // POST /telegram/disconnect
  onRetry,     // POST /telegram/restart
}: { … })
```

Recovery-from-bad-clicks confirm dialog (per CONTEXT.md § 3D) uses `AlertDialog` from `@/components/alert-dialog` — pattern seen in `WakeupsTab.tsx:6-12`.

**Icon:** `Send` from `lucide-react` (RESEARCH.md § Standard Stack recommendation — matches IdentityModal.tsx's existing lucide-react import at line 2, no new npm dep).

---

### `src/ui/features/pretty-view/IdentityModal.tsx` — surgical edit

**Analog:** the file's own existing pattern (extend `NAV_SECTIONS_IDENTITY` + add matching `<TabsContent>`).

**Existing NAV_SECTIONS_IDENTITY** (lines 314-319):
```typescript
// Source: src/ui/features/pretty-view/IdentityModal.tsx:314-319 (VERIFIED)
const NAV_SECTIONS_IDENTITY = [
  { value: "identity", label: "Identity file", Icon: User },
  { value: "identity-wakeups", label: "Wakeups", Icon: AlarmClock },
  { value: "handoff", label: "Handoff", Icon: Handshake },
] as const;
```

**Phase B edit — add fourth entry:**
```typescript
const NAV_SECTIONS_IDENTITY = [
  { value: "identity", label: "Identity file", Icon: User },
  { value: "identity-wakeups", label: "Wakeups", Icon: AlarmClock },
  { value: "handoff", label: "Handoff", Icon: Handshake },
  { value: "telegram", label: "Telegram", Icon: Send },   // Phase 79 — NEW (4-line surgical)
] as const;
```

Also add `Send` to the lucide-react import at line 2:
```typescript
// Source: src/ui/features/pretty-view/IdentityModal.tsx:2 (VERIFIED)
import { AlarmClock, Clock, Handshake, Pencil, Target, User, Users, X } from "lucide-react";
// Phase B: → import { AlarmClock, Clock, Handshake, Pencil, Send, Target, User, Users, X } from "lucide-react";
```

**Existing TabsContent slot** (lines 2177-2186):
```tsx
// Source: src/ui/features/pretty-view/IdentityModal.tsx:2177-2186 (VERIFIED)
<TabsContent
  value="handoff"
  className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
>
  <HandoffTab
    state={handoffState}
    isCoordinator={identity.coordinator}
    onSave={updateHandoff}
  />
</TabsContent>
```

**Phase B edit — add matching TelegramTab TabsContent** (immediately after handoff, ~2186):
```tsx
<TabsContent
  value="telegram"
  className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
>
  <TelegramTab
    state={telegramState}
    hue={hue}
    identityKey={identity.key}
    humanUserId={/* current user's ID */}
    onValidate={validateTelegramToken}
    onActivate={activateTelegram}
    onDisconnect={disconnectTelegram}
    onRetry={retryBridgeRestart}
  />
</TabsContent>
```

**Bottom icon-bar auto-updates** — the renderer at IdentityModal.tsx:2198 iterates `NAV_SECTIONS.map(...)`, so adding to `NAV_SECTIONS_IDENTITY` auto-renders the new pill. No changes to the icon-bar block needed.

Also add a state slot next to existing `handoffState` (~line 338):
```typescript
const [telegramState, setTelegramState] = useState<TelegramState>({ status: "loading" });
```

---

### `src/backend/database/db/schema.ts` — add `telegramBotTokens`

**Analog:** `matrixAdminCreds` at schema.ts:680-692 (VERIFIED)

```typescript
// Source: src/backend/database/db/schema.ts:680-692 (VERIFIED)
export const matrixAdminCreds = sqliteTable("matrix_admin_creds", {
  id: integer("id").primaryKey(),
  homeserverBase: text("homeserver_base").notNull(),
  userId: text("user_id").notNull(),
  accessToken: text("access_token").notNull(),
  password: text("password").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

**Phase B addition** (mirror shape; per-identity keyed instead of singleton):
```typescript
// Phase 79 — Telegram bot tokens, one row per identity, bot_token
// FieldCrypto-encrypted per field-crypto.ts ENCRYPTED_FIELDS.
export const telegramBotTokens = sqliteTable("telegram_bot_tokens", {
  identityKey: text("identity_key").primaryKey(),
  botToken: text("bot_token").notNull(),           // encrypted at rest — see field-crypto.ts
  botUsername: text("bot_username").notNull(),     // display only, not sensitive
  humanUserId: text("human_user_id").notNull(),    // authz: only this Skynet user can activate/disconnect
  telegramChatId: text("telegram_chat_id"),        // nullable until first /start seen
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```

---

### `src/backend/database/db/index.ts` — CREATE TABLE at boot

**Analog:** `matrix_admin_creds` CREATE at index.ts:329-337 (VERIFIED)

```sql
-- Source: src/backend/database/db/index.ts:329-337 (VERIFIED)
CREATE TABLE IF NOT EXISTS matrix_admin_creds (
    id INTEGER PRIMARY KEY,
    homeserver_base TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**forceSave block** (lines 878-905, VERIFIED):
```typescript
// Source: src/backend/database/db/index.ts:878-905 (VERIFIED)
// Phase 75 Plan 01 — persist the new matrix_admin_creds table + users.mxid
// column to the encrypted SQLite file. Both DDLs [...] execute against the
// RAM SQLite; without an explicit forceSave the new schema lives only in
// memory until an unrelated write fires the debounced save trigger.
//
// Wrapped in try/catch with a non-fatal warn: DatabaseSaveTrigger may not
// yet be initialized on the first-ever boot [...]
try {
  await DatabaseSaveTrigger.forceSave("phase-75-matrix-admin-schema");
} catch (saveError) {
  databaseLogger.warn(
    "[phase-75] forceSave failed (non-fatal — CREATE TABLE is idempotent, next boot retries)",
    { operation: "schema_migration_force_save_matrix_admin", error: saveError },
  );
}
```

**Phase B additions:**
- CREATE TABLE block: identical shape, `telegram_bot_tokens (identity_key TEXT PRIMARY KEY, bot_token TEXT NOT NULL, bot_username TEXT NOT NULL, human_user_id TEXT NOT NULL, telegram_chat_id TEXT, created_at ..., updated_at ...)`
- `forceSave("phase-79-telegram-bot-tokens-schema")` block with same try/catch/warn shape

---

### `src/backend/utils/field-crypto.ts` — add ENCRYPTED_FIELDS entry

**Analog:** field-crypto.ts:17-50 (VERIFIED — the whole ENCRYPTED_FIELDS map)

```typescript
// Source: src/backend/utils/field-crypto.ts:17-50 (VERIFIED)
private static readonly ENCRYPTED_FIELDS = {
  users: new Set(["passwordHash", "clientSecret", …]),
  ssh_data: new Set(["password", "key", "keyPassword", …]),
  ssh_credentials: new Set(["password", "privateKey", "keyPassword", "key", "publicKey"]),
  opkssh_tokens: new Set(["sshCert", "privateKey"]),
  // Phase 75 Plan 01 — @skynet-admin Matrix relay credentials, encrypted
  // at rest via FieldCrypto. Column names use snake_case (DB column form)
  // because matrix-admin-creds-store.ts calls encryptField/decryptField
  // with fieldName="access_token" / "password" against the DB rows.
  matrix_admin_creds: new Set(["access_token", "password"]),
};
```

**Phase B addition — one line:**
```typescript
  // Phase 79 — Telegram bot tokens, per-identity, FieldCrypto AES-256-GCM.
  // Column name uses snake_case (DB form); tokens-store.ts calls
  // encryptField/decryptField with fieldName="bot_token".
  telegram_bot_tokens: new Set(["bot_token"]),
```

---

### `src/backend/distributor/catalog.ts` — add 2 rows

**Analog:** the agent-supervisor pair at catalog.ts:186-191 + 234-239 (VERIFIED)

**Bash-script row shape** (lines 186-191):
```typescript
// Source: src/backend/distributor/catalog.ts:186-191 (VERIFIED)
{
  slug: "agent-supervisor",
  bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
  installPath: "~/.local/bin/agent-supervisor",
  restartHook: "agent-supervisor.service",
},
```

**Systemd unit row shape** (lines 234-239):
```typescript
// Source: src/backend/distributor/catalog.ts:234-239 (VERIFIED)
{
  slug: "agent-supervisor-service-unit",
  bundledPath: "/app/fleet-substrate/user-onboarding/agent-supervisor.service",
  installPath: "~/.config/systemd/user/agent-supervisor.service",
  restartHook: "agent-supervisor.service",
},
```

**Phase B additions (2 rows — USER scope per Alice decision #2):**
```typescript
{
  slug: "tg-bridge",
  bundledPath: "/app/fleet-substrate/scripts/tg-bridge.sh",
  installPath: "~/.local/bin/tg-bridge",
  restartHook: "tg-bridge.service",
},
{
  slug: "tg-bridge-service-unit",
  bundledPath: "/app/fleet-substrate/user-onboarding/tg-bridge.service",
  installPath: "~/.config/systemd/user/tg-bridge.service",
  restartHook: "tg-bridge.service",
},
```

**No `unitScope` field needed** (Alice locked USER scope in decision #2 — so ssh-push.ts's hardcoded `--user` at line 218 continues to work for tg-bridge exactly as it does for agent-supervisor). The RESEARCH.md § Alternatives Considered discussion of SYSTEM scope is overridden by decision #2.

---

### `src/backend/database/database.ts` — mount `/telegram` router

**Analog:** matrix-admin mount at database.ts:22 + 1818 (VERIFIED)

**Import** (line 22):
```typescript
// Source: src/backend/database/database.ts:22 (VERIFIED)
import matrixAdminRoutes from "../matrix/matrix-admin-routes.js";
```

**Mount** (line 1818):
```typescript
// Source: src/backend/database/database.ts:1818 (VERIFIED)
// Phase 75 amendment: matrix-admin creds ingestion + rotation surface. Admin-gated
// (authenticateJWT + requireAdmin middleware). [...]
app.use("/matrix-admin", matrixAdminRoutes);
```

**Phase B additions — one import + one mount:**
```typescript
// Phase 79: Telegram bridge routes (bot-token activation, disconnect, status, restart).
// User-auth + own-identity-check middleware inside routes.ts (admin only for /restart).
import telegramRoutes from "../telegram/routes.js";
// ... later, alongside matrixAdminRoutes mount:
app.use("/telegram", telegramRoutes);
```

The `POST /matrix-admin/migrate-cred-files` route is added inside the existing `matrix-admin-routes.ts` (no new mount needed — it's a new handler in the same router).

---

### `docker/nginx.conf` + `docker/nginx-https.conf` — CLAUDE.md caveat

**Analog:** `/matrix-admin` block at nginx.conf:153-162 and nginx-https.conf:164-173 (VERIFIED both files carry the identical block).

```nginx
# Source: docker/nginx.conf:153-162 (VERIFIED — same block at docker/nginx-https.conf:164-173)
location ~ ^/matrix-admin(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
    proxy_set_header X-Forwarded-Port $proxy_x_forwarded_port;
    proxy_set_header X-Forwarded-Host $proxy_x_forwarded_host;
}
```

**Phase B addition — copy the block verbatim, rename path to `/telegram` — into BOTH files (CLAUDE.md § "Nginx caveat"):**
```nginx
location ~ ^/telegram(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    # ... (rest identical) ...
}
```

**Verification post-deploy** (per RESEARCH.md Pitfall 1): `curl -si https://term.example.com/telegram/nonexistent -X POST` should return 401/404 (backend), NOT 200 text/html.

---

### `/opt/skynet/docker-compose.yml` — add `/var/lib/tg-bridge/` bind-mount

**Analog:** Phase 70 branding bind-mount at `/opt/skynet/docker-compose.yml` (VERIFIED live at `cat /opt/skynet/docker-compose.yml`)

```yaml
# Source: /opt/skynet/docker-compose.yml (VERIFIED live 2026-09-06)
# Phase 70: branding config + assets — single directory bind-mount from
# host, read-only. [...]
- type: bind
  source: /opt/skynet/branding
  target: /etc/skynet/branding
  read_only: true
  bind:
    create_host_path: true
```

**Phase B addition (per RESEARCH.md § Q5 answer — READ-WRITE, same source/target path for unambiguous log lines):**
```yaml
# Phase 79: tg-bridge substrate — bind-mount for registry.json, <human>.token,
# <human>.since cursors, and config.env. READ-WRITE: Skynet writes registry.json
# + tokens + config; bridge writes cursors, offset.<agent>, bridge.log.
- type: bind
  source: /var/lib/tg-bridge
  target: /var/lib/tg-bridge
  # NOT read_only — Skynet writes here from the container
  bind:
    create_host_path: true
```

**Note (Alice decision #2 — USER-scope):** if the bridge is user-scoped and runs as `ubuntu`, the host dir needs `chown ubuntu:ubuntu /var/lib/tg-bridge` (or `750 ubuntu:ubuntu` if we want it group-restricted). The `create_host_path` flag creates the dir as root-owned by default; a one-shot `chown` runs at first-boot (or the operator sets it manually per RESEARCH.md § Q7 recommendation).

---

### Skynet host DB — wire SSH credential to host id 6 (Alice decision #1)

**Analog:** existing `PUT /host/:id` credentialId update handler at `src/backend/database/routes/host.ts:1075-1084` (VERIFIED)

```typescript
// Source: src/backend/database/routes/host.ts:1075-1084 (VERIFIED)
if (sshDataObj.credentialId !== undefined) {
  if (
    hostRecord[0].credentialId !== null &&
    sshDataObj.credentialId === null
  ) {
    await db
      .delete(hostAccess)
      .where(eq(hostAccess.hostId, Number(hostId)));
  }
}
```

**Phase B execution (no new code — use existing HTTP surface):**
1. Create an SSH credential entry (`POST /credentials` — existing endpoint at `src/backend/database/routes/credentials.ts:75`) with an ed25519 keypair for `ubuntu@localhost` (Skynet SSH-ing to itself over t1000's SSH server).
2. Attach it to host id 6 via `PUT /host/6` with `{credentialId: <new-id>}` — the D-08 guard at host.ts:1088-1097 verifies `runsFleetSubstrate && credentialId` invariant holds.
3. Verify: `docker logs skynet` should stop emitting the `[WARN] fleet_substrate_host_no_credential_id, host:6, hostName:Skynet` line (RESEARCH.md § Pitfall 3 evidence).

This is an **operator runbook step**, not a code change — the pattern is "use the existing endpoint the way any user would attach a credential to a host." A one-shot script placed in `.planning/phases/79-…/wave-N/` invokes it.

---

## Shared Patterns

### Authentication
**Source:** `src/backend/utils/auth-manager.ts` (via `src/backend/matrix/matrix-admin-routes.ts:27-28`)
**Apply to:** All new `/telegram/*` and `/matrix-admin/migrate-cred-files` handlers
```typescript
// Source: src/backend/matrix/matrix-admin-routes.ts:27-28 (VERIFIED)
const authManager = AuthManager.getInstance();
const requireAdmin = authManager.createAdminMiddleware();
```
- Admin-gate: `/matrix-admin/migrate-cred-files`, `/telegram/restart`
- User-auth (not admin): `/telegram/validate`, `/telegram/activate`, `/telegram/disconnect`, `GET /telegram/:identityKey`
- For user-auth routes, `AuthManager.getInstance().createAuthMiddleware()` (see voice.ts:43 for the pattern: `const authenticateJWT = authManager.createAuthMiddleware()`).

### Error Handling
**Source:** `src/backend/matrix/matrix-admin-routes.ts:97-100` + `src/backend/matrix/matrix-admin-client.ts:161-170`
**Apply to:** All new backend routes + client modules

Route-level (verbatim shape from matrix-admin-routes.ts):
```typescript
} catch (err) {
  authLogger.error("Failed to <op>", err);
  res.status(500).json({ error: "Failed to <op>" });
}
```

External-HTTP-call level (from matrix-admin-client.ts loginAsUser):
```typescript
} catch (err: unknown) {
  clearTimeout(timeoutId);
  if (err instanceof DOMException && err.name === "AbortError") {
    return { ok: false, status: 504, error: ERR_TIMEOUT };
  }
  databaseLogger.error("<op> proxy error", err, { operation: "<op_name>" });
  return { ok: false, status: 502, error: ERR_PROXY };
}
```

**Invariant (per RESEARCH.md § Security Domain V7):** never leak bot token, Matrix token, or Telegram response bodies in error responses — return `{error: <stable-code>}` shape mirroring `matrix-admin-client.ts`.

### Validation
**Source:** `src/backend/matrix/matrix-admin-routes.ts:24` (regex constants at top), `matrix-admin-routes.ts:44-61` (early-return 400 guards)
**Apply to:** All new POST handlers

```typescript
// Source: src/backend/matrix/matrix-admin-routes.ts:24, 44-61 (VERIFIED)
const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;
// ...
if (typeof homeserverBase !== "string" || !/^https?:\/\/[^\s]+$/.test(homeserverBase)) {
  res.status(400).json({ error: "homeserverBase must be an http(s) URL" }); return;
}
```

**Phase B regex constants** (per RESEARCH.md § V5):
- `TELEGRAM_BOT_TOKEN_RE = /^[0-9]{9,10}:[A-Za-z0-9_-]{35}$/`
- `IDENTITY_KEY_RE` — reuse existing (per identity-birth-orchestrator.ts convention)
- `MXID_RE` — reuse from matrix-admin-routes.ts:24

### FieldCrypto encryption
**Source:** `src/backend/utils/field-crypto.ts:17-50` + `src/backend/matrix/matrix-admin-creds-store.ts:113-160`
**Apply to:** `src/backend/telegram/tokens-store.ts`

Register in `ENCRYPTED_FIELDS`, then encrypt-before-INSERT/UPDATE with HKDF-context `${recordId}:${fieldName}` (recordId = `String(identityKey)` per row).

### Persist-to-disk trigger
**Source:** `src/backend/matrix/matrix-admin-creds-store.ts:162-175`
**Apply to:** Every write in `tokens-store.ts` + any new bridge-related mutations

Debounced `DatabaseSaveTrigger.triggerSave("<op_name>")` wrapped in try/catch → non-fatal warn.

### Logging (structured, secret-free)
**Source:** `src/backend/utils/logger.ts` → `authLogger` / `databaseLogger`
**Apply to:** All new backend files
- Log operation names as `operation: "telegram_activate"` etc. NEVER log token values.
- Log `{botUsername}` for display, not `{botToken}`.
- Bridge script (bash side) mirrors: `log()` helper at agent-supervisor.sh:31 (`printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"`).

### Dead-token detection (Alice decision #4)
**Source:** No exact analog exists in-tree — closest is the recv.sh `SINCE_FILE` pattern (write-file-as-persistent-state, read-file-on-startup).
**Apply to:** `src/backend/matrix/reconcile-dead-tokens.ts` + tg-bridge.sh's 401 branch

Bridge side (bash): on Matrix 401, write empty sentinel `${REGISTRY_DIR}/<human>.token-dead` (equivalent to `> "$SINCE_FILE"` shape at recv.sh:222).

Skynet side (Node): `fs.readdirSync(TG_BRIDGE_DIR)` → filter `.token-dead` → for each → `loginAsUser(mxid)` → write new `.token` (0600) → `fs.unlink` sentinel → restart bridge.

Trigger: periodic 30s interval `setInterval` OR ad-hoc via `POST /matrix-admin/reconcile-dead-tokens` (admin-gated). RESEARCH.md § Q6 confirms no polling of live tokens needed — purely reactive to sentinel.

---

## No Analog Found

Files with no close match in the codebase — planner should design from first principles guided by RESEARCH.md:

| File | Role | Data Flow | Reason / Guidance |
|------|------|-----------|-------------------|
| `src/backend/telegram/bridge-config-writer.ts` | service (local-fs writer to bind-mount) | file I/O (write `registry.json`, `<human>.token`, `config.env` to `/var/lib/tg-bridge/`) | **No exact analog exists.** Closest partial: `identity-birth-orchestrator.ts:562-584` (SFTP write + chmod 600) but that's *remote* over SSH. This is *local* fs (bind-mount visible to both Node and the bridge). Design: use `fs.promises.writeFile` to `<path>.tmp` → `fs.promises.rename(<path>.tmp, <path>)` (POSIX atomic on same filesystem, per RESEARCH.md § Security — "Bind-mount write-race with bridge reads"). Then `fs.promises.chmod(path, 0o600)`. Bridge reads full-file `cat` (atomic-visible via inode). For `registry.json`, parse+mutate+re-serialize via `JSON.parse`/`JSON.stringify` (container has no `jq` — RESEARCH.md § Standard Stack). |
| `src/backend/config/media-endpoints.ts` (shared TS constants) | config module | pure constants imported at module-load | **No existing `src/backend/config/` dir.** `voice.ts:28` currently hardcodes `STT_URL` inline. Alice decision #3 locks this as a shared TS module (Option 2 from RESEARCH.md § Pitfall 5). Design: create the dir, export `STT_URL`, `TTS_URL`, `TTS_STREAM_URL`, `VOICES_URL` as `export const` string literals (verbatim values from voice.ts:28-34). `voice.ts` imports from this module. `bridge-config-writer.ts` imports STT_URL and writes it to `config.env` at Skynet startup. For Matrix homeserver base, per RESEARCH.md § Q3 (Option 1 recommendation), Skynet reads from `matrix_admin_creds.homeserverBase` via `getMatrixAdminCreds()` and writes to `config.env` as `MATRIX_ROOT`. |

**For both:** since no analog exists, the planner should ground the design in the specific RESEARCH.md sections cited and prefer minimal surface area (single-purpose module, pure functions, no side effects at import time).

---

## Metadata

**Analog search scope:**
- `/home/ubuntu/skynet-tina/src/backend/matrix/` (Phase 77 admin foundation — 5 source files)
- `/home/ubuntu/skynet-tina/src/backend/distributor/` (Phase 73/75 substrate — 11 source files)
- `/home/ubuntu/skynet-tina/src/backend/database/` (schema + routes — 30+ files)
- `/home/ubuntu/skynet-tina/src/backend/utils/` (field-crypto, auth-manager, logger — 40+ files)
- `/home/ubuntu/skynet-tina/src/backend/database/routes/voice.ts` (STT_URL current location)
- `/home/ubuntu/skynet-tina/src/ui/features/pretty-view/` (HandoffTab, WakeupsTab, IdentityModal — 20+ files)
- `/home/ubuntu/skynet-tina/src/ui/api/` (frontend fetch wrappers)
- `/home/ubuntu/skynet-tina/substrate/scripts/` + `substrate/user-onboarding/` + `substrate/skills/agent-relay/`
- `/home/ubuntu/skynet-tina/docker/nginx.conf` + `docker/nginx-https.conf`
- `/opt/skynet/docker-compose.yml` (live operator artifact)

**Files scanned:** ~35 concrete Read/Grep passes. All excerpts VERIFIED via direct Read calls (no re-reads).

**Pattern extraction date:** 2026-09-06

**Ready for planning:** yes — every new file has a "Closest analog:" section with a 5-30 line concrete code excerpt from a real in-tree file, OR is flagged in § No Analog Found with a design-from-first-principles pointer to the specific RESEARCH.md section that locks the choice.
