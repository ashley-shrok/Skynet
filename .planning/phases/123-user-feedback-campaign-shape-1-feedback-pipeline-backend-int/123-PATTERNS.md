# Phase 123: user-feedback campaign shape 1 — feedback pipeline - Pattern Map

**Mapped:** 2026-09-19
**Files analyzed:** 17 new / 5 modified
**Analogs found:** 22 / 22
**Analog search scope:** `src/backend/branding/`, `src/backend/database/`, `src/backend/database/routes/`, `src/backend/starter.ts`, `src/backend/utils/`, `src/ui/branding/`, `src/ui/features/pretty-view/`, `src/ui/hooks/`, `src/ui/components/`, `src/ui/AppShell.tsx`, `src/main.tsx`, `src/ui/main-axios.ts`, `docker/nginx.conf`, `docker/nginx-https.conf`
**Pattern extraction date:** 2026-09-19

---

## File Classification

### New files

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/backend/feedback/feedback-config.ts` | config loader (env parser + module-scope cache) | boot-time load, request-time read-only | `src/backend/branding/branding-config-loader.ts` | exact (same never-throws + boot-cache contract) |
| `src/backend/feedback/feedback-email.ts` | utility (pure composition) | pure transform (no I/O) | `src/backend/branding/branding-template.ts` (pure config→string) | role-match |
| `src/backend/feedback/feedback-transport.ts` | service (SMTP send) | fire-and-forget outbound I/O | *NO CLOSE ANALOG* — nodemailer is greenfield; falls back to RESEARCH.md Pattern 2 + logger-error house style | no-analog for the send, sshLogger.error usage matches `branding-config-loader.ts` L159-170 |
| `src/backend/feedback/feedback-routes.ts` | route (Express router) | request-response, auth-gated + fire-and-forget send | `src/backend/database/routes/relay-room-participants.ts` (auth-gated router with userId→username drizzle lookup) + `src/backend/branding/branding-routes.ts` (Cache-Control no-store on GET config route) | exact (composite) |
| `src/backend/feedback/feedback-config.test.ts` | test (vitest, unit) | env parsing edge cases | *no direct branding-config test extracted at scout time* — follows house vitest layout | partial |
| `src/backend/feedback/feedback-email.test.ts` | test (vitest, snapshot) | pure function permutations | *no direct branding-template test extracted at scout time* — follows house vitest layout | partial |
| `src/backend/feedback/feedback-routes.test.ts` | test (vitest, supertest-style) | route integration | *no direct branding-routes test extracted at scout time* — follows house vitest layout | partial |
| `src/ui/feedback/feedback-store.ts` | state (useSyncExternalStore singleton) | boot-set / hook-read | `src/ui/branding/branding-store.ts` | exact (verbatim mirror) |
| `src/ui/feedback/feedback-fetch.ts` | boot-time GET fetch | one-shot boot fetch, silent no-op on fail | `src/ui/branding/branding-fetch.ts` | exact (verbatim mirror) |
| `src/ui/feedback/feedback-api.ts` | api wrapper (authApi.post) | request-response (POST) | `src/ui/main-axios.ts` L1657-1665 (`registerUser` — `authApi.post` + `response.data` + `handleApiError`) | exact |
| `src/ui/feedback/FeedbackModal.tsx` | component (Radix Dialog, two variants) | user-input → parent onSubmit | `src/ui/features/pretty-view/AddWakeupDialog.tsx` (input-heavy modal, gradient chrome, uppercase labels) + `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` (small-modal, close-X, hue=220 neutral) | exact (composite) |
| `src/ui/hooks/use-keyboard-trigger-feedback-dev.ts` | hook (dev-only keyboard chord) | event-driven | `src/ui/hooks/use-keyboard-toggle-pretty-mode.ts` | exact (verbatim mirror + `import.meta.env.DEV` fence) |

### Modified files

| Modified File | Role | Data Flow | Closest In-File Pattern | Match Quality |
|---------------|------|-----------|-------------------------|---------------|
| `src/backend/starter.ts` (add boot hook near L405) | boot chain | one-time init | existing `assertBrandingConfigAtBoot()` call at L402-405 — but feedback DOES NOT throw/exit | role-match, deliberate divergence per D-07 |
| `src/backend/database/database.ts` (mount router near L2085) | route mount | Express `app.use(...)` | `app.use("/voice", voiceRoutes)` at L2085 + unmounted-prefix `app.use(brandingRoutes)` at L2093 | exact |
| `src/main.tsx` (add fire-and-forget fetch near L282) | boot fetch | one-shot | existing `void fetchBrandingConfig();` at L282 | exact |
| `src/ui/AppShell.tsx` (mount modal + wire dev hook) | modal mount + hook wire | keyboard event → open state | existing keyboard-hook imports L21 + `CommandPalette` mounted at L3996 | exact |
| `docker/nginx.conf` + `docker/nginx-https.conf` (add feedback location blocks) | reverse proxy | HTTP passthrough | branding blocks at nginx.conf L1172-1191 + nginx-https.conf L1154-... | exact (verbatim shape) |

---

## Pattern Assignments

### `src/backend/feedback/feedback-config.ts` (config loader, boot-time load)

**Analog:** `src/backend/branding/branding-config-loader.ts` (definitive Skynet never-throws-loader canonical example)

**Contract-defining docstring pattern to copy** (branding-config-loader.ts L1-31):
```typescript
/**
 * Phase 123 (feedback-config): reads FEEDBACK_* env vars ONCE at backend boot
 * and caches the parsed FeedbackConfig in module scope. Called from starter.ts's
 * boot IIFE via loadFeedbackConfig(); downstream getFeedbackConfig() returns
 * the cached value with no I/O.
 *
 * Error handling contract (mirrors branding-config-loader.ts L13-21):
 *   - Missing env vars → cached = {enabled: false, reason: "..."} + sshLogger.info
 *   - Present but invalid (bad port, etc.) → cached = {enabled: false, reason: "..."}
 *     + sshLogger.info
 *   - This function never throws; failure modes populate cached with a disabled sentinel.
 *
 * Divergence from branding pattern (D-07):
 *   No transporter.verify() at load — bad-but-present SMTP creds surface at
 *   real send time, not at boot. Contrast with assert-boot.ts's Phase 74 gate.
 *
 * Pure module-scope state: no Express, no drizzle, no SSH — safe to import anywhere.
 */
```

**Imports pattern** (branding-config-loader.ts L33-35):
```typescript
import { sshLogger } from "../utils/logger.js";
```
(feedback-config does NOT need `fs`/`path` — env-only, unlike branding which reads a JSON file. Just import `sshLogger`.)

**Type shape pattern** — discriminated union with `enabled` boolean (RESEARCH.md Pattern 1):
```typescript
export type FeedbackConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      smtp: { host: string; port: number; user: string; password: string; fromAddress: string };
      toAddress: string;
      includeContent: boolean;
    };
```

**Module-scope cache pattern** (mirrors branding-config-loader.ts L137-174 `cachedBundledDefaults` / `getBundledDefaults()` shape, adapted from lazy-init to boot-init):
```typescript
let cached: FeedbackConfig | null = null;

export function loadFeedbackConfig(): void {
  // called ONCE from starter.ts; assign cached exactly once per process lifetime.
  const host = process.env.FEEDBACK_SMTP_HOST?.trim() ?? "";
  // ... validate + populate cached ...
}

export function getFeedbackConfig(): FeedbackConfig {
  if (cached === null) {
    return { enabled: false, reason: "not_yet_loaded" };
  }
  return cached;
}
```

**Structured logging pattern** (branding-config-loader.ts L159-170):
```typescript
sshLogger.error("branding-config-loader: bundled defaults shape invalid", {
  operation: "branding_config_bundled_shape",
  error: "Bundled /app/branding-defaults/branding.json fails shape guard",
  path: defaultsPath,
});
```
Feedback maps this to (adapted for env-var vs. file-shape context):
```typescript
sshLogger.info("feedback-config: feature disabled", {
  operation: "feedback_config_load",
  enabled: false,
  reason: cached.reason,
});
```
Note the `operation:` key convention — every backend log line uses this shape.

---

### `src/backend/feedback/feedback-email.ts` (utility, pure functions)

**Analog:** No pure-composition analog in the codebase; the pattern is trivial (RESEARCH.md § Code Examples supplies it verbatim). Related pure-file pattern: `branding-template.ts` (which reads BrandingConfig and produces an HTML string).

**Anti-injection pattern** (RESEARCH.md Pitfall 6):
```typescript
export function composeSubject(args: { appName: string; type: string }): string {
  const safeAppName = args.appName.replace(/[\r\n]/g, ""); // Pitfall 6: no header injection
  return `[${safeAppName} feedback] ${args.type}`;
}
```

**Body composition** — from RESEARCH.md L702-732 verbatim. Executor should copy it as-is; the pattern threads D-19 (header block), D-22 (exchange section only when includeContent + thumb type), D-23 (general never has exchange).

---

### `src/backend/feedback/feedback-transport.ts` (service, fire-and-forget SMTP)

**Analog:** No existing SMTP transport in codebase — greenfield. Falls back to nodemailer official pattern (RESEARCH.md Pattern 2) with Skynet-house error handling.

**Imports pattern** (fresh — no existing analog for nodemailer import):
```typescript
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { sshLogger } from "../utils/logger.js";
import { getFeedbackConfig } from "./feedback-config.js";
```

**Try/catch + sshLogger.error pattern** (branding-config-loader.ts L164-170):
```typescript
try {
  await t.sendMail({
    from: cfg.smtp.fromAddress,
    to: cfg.toAddress,
    subject: args.subject,
    text: args.body, // D-15: plain text ONLY. Never html: field.
  });
  sshLogger.info("feedback-transport: send succeeded", {
    operation: "feedback_submit",
    submitter: args.submitter,
    type: args.type,
    hasNote: args.hasNote,
    hasExchange: args.hasExchange,
  });
} catch (err) {
  // D-27: log to console + drop. Full payload was already logged upstream.
  sshLogger.error("feedback-transport: send failed", err, {
    operation: "feedback_send_failed",
    submitter: args.submitter,
    type: args.type,
    error: err instanceof Error ? err.message : String(err),
  });
}
```

**Anti-pattern lock** (D-07 divergence from branding assert-boot):
- Do NOT call `transporter.verify()` at boot OR at first send.
- Lazy-instantiate the transporter on first send; hold in module-scope `let transporter: Transporter | null = null;`.

---

### `src/backend/feedback/feedback-routes.ts` (route, auth-gated + fire-and-forget)

**Analog A (auth + userId→username lookup):** `src/backend/database/routes/relay-room-participants.ts` L47-99

**Auth setup pattern** (relay-room-participants.ts L47-63):
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```

**userId → username drizzle lookup** (relay-room-participants.ts L78-99):
```typescript
async function lookupViewingUserMxid(userId: string): Promise<string | null> {
  try {
    const rows = (await db
      .select({ mxid: users.mxid })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)) as Array<{ mxid: string | null }>;
    const row = rows[0];
    if (row === undefined) return null;
    return typeof row.mxid === "string" && row.mxid.length > 0 ? row.mxid : null;
  } catch (err) { /* log + return null */ }
}
```
For feedback, adapt to select `users.username` and default to `"unknown"` when missing (RESEARCH.md Pattern 3 line 483).

**Analog B (Cache-Control no-store on GET-config route):** `src/backend/branding/branding-routes.ts` L45-68

**Cache-Control + never-throws GET pattern** (branding-routes.ts L45-68):
```typescript
const NO_STORE_CACHE =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

router.get("/api/branding", async (_req: Request, res: Response) => {
  try {
    const config = await loadBrandingConfig();
    res.setHeader("Cache-Control", NO_STORE_CACHE);
    return res.status(200).json(config);
  } catch (err) {
    sshLogger.error("branding-routes: /api/branding unexpected error", {
      operation: "branding_route_config",
      error: err instanceof Error ? err.message : String(err),
    });
    res.setHeader("Cache-Control", NO_STORE_CACHE);
    return res.status(200).json(getBundledDefaults());
  }
});
```
For feedback `GET /api/feedback/enabled` — same shape, returns `{enabled: cfg.enabled}`. NOTE: unlike branding (which is deliberately unauthenticated pre-login per branding-routes.ts L11), feedback `/api/feedback/enabled` is auth-gated (RESEARCH.md § Alternatives Considered — reason: feedback POST needs `req.userId`, and to avoid pre-login flag leak).

**Payload guard pattern** — RESEARCH.md Pattern 3 L463-475 supplies the inline `typeof`/enum discriminant guard. This matches `branding-config-loader.ts::isValidBrandingShape` house style (inline typeof, no zod required).

**Fire-and-forget response pattern** (RESEARCH.md Pattern 3 L513-524):
```typescript
// D-27: log the full attempted payload BEFORE the send so nothing is lost on failure.
sshLogger.info("feedback-submit: attempting send", { /* full payload */ });

// Fire-and-forget from the response's perspective.
void sendFeedbackEmail({ /* ... */ });

return res.status(202).json({ ok: true });
```

**Body-size defense** (RESEARCH.md Pattern 3 L453 + Pitfall 5):
```typescript
router.post("/feedback", authenticateJWT, express.json({ limit: "512kb" }), async (req, res) => { ... });
```
Inline `express.json({limit:"512kb"})` because the global bodyParser at `database.ts:350` is `1gb` — too permissive for this route.

---

### `src/ui/feedback/feedback-store.ts` (state singleton, useSyncExternalStore)

**Analog:** `src/ui/branding/branding-store.ts` (verbatim mirror; simplified to boolean state)

**Full file pattern** (branding-store.ts L99-166):
```typescript
import { useSyncExternalStore } from "react";

let state: { enabled: boolean } = { enabled: false }; // default: hidden

let snapshotVersion = 0;
const listeners = new Set<() => void>();

function notify(): void {
  snapshotVersion += 1;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function publishFeedbackEnabled(next: boolean): void {
  if (state.enabled === next) return;   // JSON-stringify equality is overkill for a boolean
  console.info({
    operation: "feedback_enabled_publish",
    previous: state.enabled,
    next,
  });
  state = { enabled: next };
  notify();
}

export function useFeedbackEnabled(): boolean {
  const getSnapshot = (): boolean => state.enabled;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

void snapshotVersion; // suppress unused-var (mirrors branding-store L170)

export function __resetForTest(): void {
  state = { enabled: false };
  notify();
}
```

**Anti-pattern lock** (branding-store.ts L28-36 — applies verbatim to feedback):
- ❌ NO React Context provider for this state.
- ❌ NO external state-management package.
- ✅ useSyncExternalStore singleton in `src/ui/feedback/` matches all other app-scoped state.

---

### `src/ui/feedback/feedback-fetch.ts` (boot-time GET, silent no-op on fail)

**Analog:** `src/ui/branding/branding-fetch.ts` (verbatim mirror; simplified guard)

**Full pattern** (branding-fetch.ts L45-86):
```typescript
import { publishFeedbackEnabled } from "./feedback-store";

function isFeedbackEnabledResponse(v: unknown): v is { enabled: boolean } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.enabled === "boolean";
}

export async function fetchFeedbackConfig(): Promise<void> {
  try {
    // NOTE: /api/feedback/enabled is auth-gated. This fetch must run
    // AFTER auth is established (or must use the authApi wrapper for JWT).
    // Contrast with /api/branding which is unauthenticated pre-login.
    const res = await fetch("/api/feedback/enabled", { credentials: "include" });
    if (!res.ok) return;
    const json = (await res.json()) as unknown;
    if (!isFeedbackEnabledResponse(json)) return;
    publishFeedbackEnabled(json.enabled);
  } catch {
    // Silent retain-default; matches branding-fetch philosophy.
  }
}
```
**IMPORTANT deviation from branding-fetch:** feedback route is auth-gated, so this fetch must happen AFTER the user is authenticated (not at `main.tsx` boot time like branding, which is pre-login). Planner decides where to fire this — likely inside `AppShell.tsx` on mount after `getUserInfo()` resolves, OR use the `appReadyPromise` from `main-axios` as a gate.

---

### `src/ui/feedback/feedback-api.ts` (authApi.post wrapper)

**Analog:** `src/ui/main-axios.ts` L1652-1665 (`registerUser`)

**Full wrapper pattern** (main-axios.ts L1652-1665):
```typescript
export async function registerUser(
  username: string,
  password: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/create", {
      username,
      password,
    });
    return response.data;  // authApi is axios — response.data holds the JSON body (Pitfall 7)
  } catch (error) {
    handleApiError(error, "register user");
  }
}
```
For feedback:
```typescript
// New file src/ui/feedback/feedback-api.ts (or add to main-axios.ts as postFeedback())
import { authApi, handleApiError } from "@/main-axios";

export type FeedbackPayload = {
  kind: "general" | "thumbs_up" | "thumbs_down";
  userNote: string;
  messageRef?: string;
  exchangeText?: string;
};

export async function postFeedback(payload: FeedbackPayload): Promise<void> {
  try {
    await authApi.post("/feedback", payload);
    // No response body needed — 202 accepted.
  } catch (error) {
    // D-27: user always sees "thanks" toast. Log locally; do not surface.
    handleApiError(error, "submit feedback");
  }
}
```

---

### `src/ui/feedback/FeedbackModal.tsx` (Radix Dialog, two variants)

**Analog A (input-heavy chrome + gradient + uppercase labels):** `src/ui/features/pretty-view/AddWakeupDialog.tsx` L142-168

**Analog B (small modal + close-X + neutral hue=220):** `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` L42-95

**Imports pattern** (AddWakeupDialog.tsx L22-26):
```typescript
import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";
```

**Props shape** (RESEARCH.md § Component Responsibilities, adapted from AddWakeupDialog.tsx L61-68):
```typescript
export type FeedbackModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  variant: "general" | "thumbs_down";
  hue?: number;   // optional — default 220 (neutral, matches DeleteConfirmDialog)
  onSubmit: (userNote: string) => Promise<void> | void;
  onDismissWithoutSubmit?: () => void; // thumbs-down close-X still fires ONE email (D-11)
};
```

**Radix Dialog chrome (large-modal variant — general)** (AddWakeupDialog.tsx L142-168):
```typescript
<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm"
    />
    <DialogPrimitive.Content
      data-testid="feedback-dialog"
      onInteractOutside={(e) => e.preventDefault()}
      onPointerDownOutside={(e) => e.preventDefault()}
      className={cn(
        "fixed top-1/2 left-1/2 z-[131] -translate-x-1/2 -translate-y-1/2",
        "w-full max-w-lg max-h-[90vh] overflow-y-auto",
        "rounded-[20px] px-5 py-4 flex flex-col gap-3",
        "text-[#e8e4d8]",
      )}
      style={{
        background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.82), hsla(${hue}, 40%, 15%, 0.88))`,
        backdropFilter: "blur(28px) saturate(1.4)",
        WebkitBackdropFilter: "blur(28px) saturate(1.4)",
        border: `1px solid hsla(${hue}, 65%, 55%, 0.32)`,
        boxShadow: `0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(${hue}, 65%, 55%, 0.2)`,
      }}
    >
      <DialogPrimitive.Title className="font-heading text-sm font-semibold text-[#f0ebe0]">
        {variant === "general" ? "Send feedback" : "What went wrong?"}
      </DialogPrimitive.Title>
      {/* ... textarea + footer ... */}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```
**IMPORTANT** for D-11 (thumbs-down variant): planner should NOT preventDefault on `onInteractOutside`/`onPointerDownOutside` for the thumbs-down variant — instead, wire those events to `onDismissWithoutSubmit()` so backdrop click still fires ONE email without a note. Or use Radix's `onOpenChange={(open) => { if (!open) onDismissWithoutSubmit?.(); }}` pattern.

**Textarea styling** (adapted from AddWakeupDialog.tsx L184-188):
```typescript
<textarea
  value={draft}
  onChange={(e) => setDraft(e.target.value)}
  placeholder={variant === "general" ? "What's on your mind?" : "Anything you want to add?"}
  className={cn(
    "bg-black/30 text-[#e8e4d8] border border-white/10",
    "focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs",
    "min-h-[120px] resize-y",
  )}
/>
```

**Close-X pattern (thumbs-down only)** (adapted from `src/ui/components/dialog.tsx` L85-95 — the shared `DialogContent` close button):
```typescript
{variant === "thumbs_down" && (
  <DialogPrimitive.Close asChild>
    <button
      type="button"
      aria-label="Close without note"
      className="absolute top-2 right-2 p-1 rounded hover:bg-white/10"
    >
      <XIcon className="w-4 h-4" />
    </button>
  </DialogPrimitive.Close>
)}
```

**Footer button pattern** (AddWakeupDialog.tsx L447-475):
```typescript
<div className="flex items-center gap-2 flex-wrap pt-1 justify-end">
  {variant === "general" && (
    <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer h-7">
      Cancel
    </Button>
  )}
  <Button
    variant="outline"
    onClick={handleSend}
    disabled={sending}
    className="cursor-pointer h-7"
    style={{
      background: `hsla(${hue}, 55%, 40%, 0.55)`,
      borderColor: `hsla(${hue}, 60%, 55%, 0.55)`,
      color: "#f0ebe0",
    }}
  >
    {sending ? "Sending…" : "Send"}
  </Button>
</div>
```

**Draft-state discipline** (D-30): textarea state is `useState` local to the modal; DO NOT lift into a store, DO NOT preserve across `open` transitions. On `open` transitioning `true→false`, either unmount (via `if (!open) return <></>;` guard as in AddWakeupDialog.tsx L140) OR clear draft state in `onOpenChange` callback.

**Neutral hue default** (DeleteConfirmDialog.tsx L56 — uses `hsla(220, ...)`): default `hue = 220` when caller does not specify. Matches "no scope confusion" spirit.

---

### `src/ui/hooks/use-keyboard-trigger-feedback-dev.ts` (dev-only chord)

**Analog:** `src/ui/hooks/use-keyboard-toggle-pretty-mode.ts` (verbatim structural mirror; add `import.meta.env.DEV` fence)

**Full pattern to mirror** (use-keyboard-toggle-pretty-mode.ts L1-57):
```typescript
import { useEffect, useRef } from "react";

export function useKeyboardTriggerFeedbackDev(
  openFeedback: (variant: "general" | "thumbs_down") => void,
): void {
  const openRef = useRef(openFeedback);
  openRef.current = openFeedback;

  useEffect(() => {
    // Dev-only gate — D-31. Vite tree-shakes this branch out of prod bundles.
    if (!import.meta.env.DEV) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;  // Ctrl+Alt (not Ctrl+Shift)
      // Ctrl+Alt+F conflicts less than Ctrl+Shift+F (Firefox find-bar); RESEARCH.md A4.
      if (e.code === "KeyF") {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        openRef.current("general");
      }
      if (e.code === "KeyT") {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        openRef.current("thumbs_down");
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
```

**Chord modifier discipline** (use-keyboard-toggle-pretty-mode.ts L39):
- `!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey` — REJECT if any wrong modifier present. Feedback uses Ctrl+Alt (not Ctrl+Shift) per RESEARCH A4 to avoid Firefox find-bar collision.

**Event capture flag `true`** (L47): `addEventListener("keydown", onKeyDown, true)` — capture phase, matches the pretty-mode hook. Ensures the chord fires even if a focused element would otherwise consume the event.

---

### `src/backend/starter.ts` (add boot hook near L405)

**Analog:** In-file — the existing `assertBrandingConfigAtBoot()` call at L402-405.

**Existing pattern to insert AFTER** (starter.ts L398-405):
```typescript
// Phase 74: fail-fast if the branding config lacks a non-empty
// avatarDirectorSpec. Placed AFTER initializeDatabase() so the DB
// logger stream is live, and BEFORE AuthManager + the dbServer
// route mounts at L292 so no HTTP routes come up if the gate fires.
const { assertBrandingConfigAtBoot } = await import(
  "./branding/assert-boot.js"
);
await assertBrandingConfigAtBoot();
```

**Insertion pattern for feedback** (mirror shape, but NO throw/exit — D-07):
```typescript
// Phase 123 (feedback-config): boot-time env parse + module-scope cache.
// DELIBERATELY DIVERGES from the branding assert-boot pattern above:
// - No throw / process.exit on missing env (feedback is optional per D-01/D-06)
// - No transporter.verify() call (D-07 — SMTP handshake at boot is fragile)
// A disabled feedback config is a valid state; the frontend hides the UI.
const { loadFeedbackConfig } = await import("./feedback/feedback-config.js");
loadFeedbackConfig();  // synchronous, never-throws
```

**Anti-pattern lock**: DO NOT copy `assert-boot.ts`'s `process.exit(1)` branch. Feedback config load NEVER exits.

---

### `src/backend/database/database.ts` (mount router near L2085)

**Analog:** In-file — `voiceRoutes` and `brandingRoutes` mounts.

**Existing patterns** (database.ts L2085 + L2093):
```typescript
app.use("/voice", voiceRoutes);            // path-prefixed mount
// Phase 70 (branding-config): unauthenticated pre-login surface. ...
// Per CLAUDE.md nginx caveat, matching location blocks for /api/branding, /branding/*,
// and /manifest.webmanifest MUST exist in BOTH docker/nginx.conf AND
// docker/nginx-https.conf ...
app.use(brandingRoutes);                   // unprefixed mount — router uses full paths internally
```

**Which pattern to copy for feedback:** the unprefixed `app.use(brandingRoutes)` pattern — because the feedback router registers TWO different path prefixes (`GET /api/feedback/enabled` AND `POST /feedback`) that would be awkward under a single `app.use("/feedback", ...)`.

**Insertion pattern** (add near L2094 after brandingRoutes):
```typescript
// Phase 123 (feedback-pipeline): auth-gated feedback intake + enabled-check.
// Per CLAUDE.md nginx caveat, matching location blocks for /api/feedback/enabled
// AND /feedback MUST exist in BOTH docker/nginx.conf AND docker/nginx-https.conf.
// Mounted AFTER bodyParser.json (L350) so req.body is populated.
app.use(feedbackRoutes);
```

**Import placement** (database.ts L131, L137):
```typescript
import voiceRoutes from "./routes/voice.js";
// ...
import brandingRoutes from "../branding/branding-routes.js";
```
Add: `import feedbackRoutes from "../feedback/feedback-routes.js";` near L137.

---

### `src/main.tsx` (add feedback fetch near L282) — CONDITIONAL

**Analog:** In-file — `void fetchBrandingConfig();` at L282.

**Existing pattern** (main.tsx L275-282):
```typescript
// Phase 70: hydrate the branding-store from /api/branding.
// Fire-and-forget: the store's initial state is a bundled-default sentinel ...
// createRoot render is NOT gated on the branding promise.
void fetchBrandingConfig();
```

**IMPORTANT — feedback DIVERGES:** `/api/feedback/enabled` is auth-gated (unlike `/api/branding` which is pre-login). Firing `void fetchFeedbackConfig()` at L282 alongside branding would 401 for logged-out users. Two acceptable options for the planner:

1. **Deferred fetch** — call `fetchFeedbackConfig()` inside `AppShell.tsx` (or wherever `getUserInfo()` resolves) via a `useEffect(() => { void fetchFeedbackConfig(); }, []);` on mount. AppShell only mounts after auth succeeds.
2. **Post-login hook** — chain onto the auth-success path. Analog: `handleLogin` in main.tsx.

Recommended: option (1). AppShell already imports app-scoped stores/hooks (see `useBrandingConfig` at L16) — adding one more `useEffect` for the fetch matches the existing pattern.

---

### `src/ui/AppShell.tsx` (mount modal + wire dev hook)

**Analog (modal mount surface):** In-file — `CommandPalette` mounted at L3996-3998.

**Existing pattern** (AppShell.tsx L3996-3998 + hook imports L21):
```typescript
import { useKeyboardTogglePrettyMode } from "@/hooks/use-keyboard-toggle-pretty-mode";
// ... elsewhere in the component body ...
const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
// ... near the JSX return ...
<CommandPalette
  isOpen={commandPaletteOpen}
  setIsOpen={setCommandPaletteOpen}
  // ...
/>
```

**Wire pattern for feedback:**
```typescript
import { useKeyboardTriggerFeedbackDev } from "@/hooks/use-keyboard-trigger-feedback-dev";
import { FeedbackModal } from "@/feedback/FeedbackModal";
import { postFeedback } from "@/feedback/feedback-api";
import { fetchFeedbackConfig } from "@/feedback/feedback-fetch";
import { toast } from "sonner";
// ... in component body ...
const [feedbackOpen, setFeedbackOpen] = useState<false | "general" | "thumbs_down">(false);
useKeyboardTriggerFeedbackDev((variant) => setFeedbackOpen(variant));
useEffect(() => { void fetchFeedbackConfig(); }, []);
// ... in JSX ...
<FeedbackModal
  open={feedbackOpen !== false}
  onOpenChange={(next) => { if (!next) setFeedbackOpen(false); }}
  variant={feedbackOpen === false ? "general" : feedbackOpen}
  onSubmit={async (note) => {
    void postFeedback({
      kind: feedbackOpen === "general" ? "general" : "thumbs_down",
      userNote: note,
      // messageRef/exchangeText are shape-3/dev-only concerns — omit for general
    });
    toast.success("Thanks — feedback sent.");
    setFeedbackOpen(false);
  }}
/>
```

**Toast usage pattern** (AppShell.tsx L3 already imports `toast` from `sonner`):
```typescript
import { toast } from "sonner";
// ...
toast.success("Thanks — feedback sent.");
```
(Sonner is already mounted globally at `src/main.tsx:243` — no new component needed.)

---

### `docker/nginx.conf` + `docker/nginx-https.conf` (verify + add location blocks)

**Analog:** In-file — `docker/nginx.conf` L1172-1191 (branding location blocks).

**Existing branding blocks** (nginx.conf L1172-1191):
```nginx
# Phase 70: branding config JSON — mirrors block in nginx-https.conf.
location = /api/branding {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Phase 70: branding assets — mirrors block in nginx-https.conf.
# `^~` prefix match wins over the ~* extension regex at L86 (which
# would otherwise 404 every /branding/*.png|svg from /app/html).
location ^~ /branding/ {
    proxy_pass http://127.0.0.1:30001;
    # ... same proxy_set_header block ...
}
```

**Insertion pattern for feedback (both files):**
```nginx
# Phase 123: feedback config enabled-check — mirrors block in nginx-https.conf.
location = /api/feedback/enabled {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Phase 123: feedback intake — mirrors block in nginx-https.conf.
location = /feedback {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**CLAUDE.md dual-file rule** (branding-routes.ts L13-20 documents this verbatim): "matching location blocks MUST exist in BOTH docker/nginx.conf AND docker/nginx-https.conf." Same rule applies. `nginx-https.conf` insertion goes near L1167 (mirror position of branding block).

---

## Shared Patterns

### Auth (backend)

**Source:** `src/backend/database/routes/relay-room-participants.ts` L47-63 + `src/backend/utils/auth-manager.ts::AuthManager.createAuthMiddleware()`.

**Apply to:** `feedback-routes.ts` (BOTH `GET /api/feedback/enabled` AND `POST /feedback`).

```typescript
import { AuthManager } from "../../utils/auth-manager.js";
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
// ... on each route:
router.post("/feedback", authenticateJWT, express.json({ limit: "512kb" }), async (req, res) => { ... });
// After middleware, req.userId is populated (typed via `as Request & { userId?: string }`).
```

---

### Structured logging

**Source:** `src/backend/branding/branding-config-loader.ts` L159-170 (canonical `sshLogger.error` shape) + `src/backend/utils/logger.ts` L326.

**Apply to:** ALL backend files in `src/backend/feedback/`.

**Log keys (from CONTEXT.md § Code Insights):**
- `operation: "feedback_config_load"` — on env parse (info level; include `enabled` boolean + `reason` on disabled).
- `operation: "feedback_submit"` — on send-attempt (info level; include `submitter`, `type`, `hasNote`, `hasExchange`, `messageRef`, and — per D-27 — the FULL `userNote` + `exchangeText` so failures don't lose user data).
- `operation: "feedback_send_failed"` — on send failure (error level; include `error`).
- `operation: "feedback_send_skipped"` — on send when feature disabled (info level).

**Convention** (logger.ts L326-337):
```typescript
export const sshLogger = new Logger("SSH", "🖥️", "#0ea5e9");
```
Every log line uses the `{ operation: "..." }` key as its structured index — matches every other backend module.

---

### Error handling (frontend)

**Source:** `src/ui/main-axios.ts` `handleApiError` (used by every `authApi.post`/`authApi.get` wrapper — see L1663 in `registerUser`).

**Apply to:** `feedback-api.ts::postFeedback`. Note that per D-27, feedback UI does NOT surface send errors to the user — the "Thanks" toast fires regardless. So `handleApiError` should be called but its user-facing toast should NOT be visible if it emits one; if it does, prefer swallowing (`catch {}`) at this call site.

---

### Payload validation (backend)

**Source:** `src/backend/branding/branding-config-loader.ts::isValidBrandingShape` (L180-219) — inline `typeof`/`Array.isArray` guard, no zod.

**Apply to:** `feedback-routes.ts::POST /feedback` body guard.

**House-style guard pattern:**
```typescript
const body = req.body as {
  kind?: string;
  userNote?: string;
  messageRef?: string;
  exchangeText?: string;
};
if (body.kind !== "general" && body.kind !== "thumbs_up" && body.kind !== "thumbs_down") {
  return res.status(400).json({ error: "invalid kind" });
}
const userNote = typeof body.userNote === "string" ? body.userNote : "";
const messageRef = typeof body.messageRef === "string" ? body.messageRef : undefined;
const exchangeText = typeof body.exchangeText === "string" ? body.exchangeText : undefined;
```
Zod is available (`^4.4.3` per package.json L173) but inline typeof matches the shape-file "no new abstractions" philosophy AND matches `branding-config-loader.ts::isValidBrandingShape` at the identical trust boundary.

---

### Cache-Control on config-check GET

**Source:** `src/backend/branding/branding-routes.ts` L47-48 (`NO_STORE_CACHE`).

**Apply to:** `GET /api/feedback/enabled` response headers.

```typescript
const NO_STORE_CACHE =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
res.setHeader("Cache-Control", NO_STORE_CACHE);
```

---

### Radix Dialog chrome (frontend)

**Source:** `src/ui/features/pretty-view/AddWakeupDialog.tsx` L142-168 (large-modal variant) + `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` L42-95 (small-modal variant, neutral hue=220).

**Apply to:** `FeedbackModal.tsx`. Locked visual language (D-13):
- Gradient: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.82), hsla(${hue}, 40%, 15%, 0.88))`
- `backdrop-filter: blur(28px) saturate(1.4)`
- Border: `1px solid hsla(${hue}, 65%, 55%, 0.32)`
- Text: `#e8e4d8` (warm off-white)
- Labels (if any): `text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold`
- Buttons: pill-shaped via `rounded` + `h-7`, hue-tinted primary via `hsla(${hue}, 55%, 40%, 0.55)`

---

### useSyncExternalStore singleton (frontend)

**Source:** `src/ui/branding/branding-store.ts` (verbatim canonical example; also `src/ui/state/session-tmux-store.ts`, `src/ui/state/session-queue-pending-store.ts`).

**Apply to:** `src/ui/feedback/feedback-store.ts`.

**Anti-pattern lock** (branding-store.ts L28-36 comment, applies verbatim): NO React Context providers for app-scoped state in this codebase; the pattern is a module-scoped `let state`, `Set<() => void>` of listeners, `subscribe`, `notify`, and `useSyncExternalStore` hook.

---

## No Analog Found

Files with no close in-repo match; the planner should defer to RESEARCH.md and/or nodemailer official docs:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/backend/feedback/feedback-transport.ts` (nodemailer send) | service | outbound SMTP | No existing SMTP transport in codebase. Use RESEARCH.md Pattern 2 (nodemailer + no verify) + house `sshLogger.error` shape from `branding-config-loader.ts` L164-170. |
| `src/backend/feedback/*.test.ts` (vitest tests) | test | route/unit integration | No branding-config-loader.test.ts or branding-routes.test.ts extracted at scout time; executor should follow the general vitest patterns present in the wider `src/backend/` tree (vitest is at ^4.1.8 per package.json). |

---

## Metadata

**Analog search scope:**
- Backend: `src/backend/branding/`, `src/backend/database/`, `src/backend/database/routes/`, `src/backend/starter.ts`, `src/backend/utils/`
- Frontend: `src/ui/branding/`, `src/ui/features/pretty-view/`, `src/ui/hooks/`, `src/ui/components/`, `src/ui/AppShell.tsx`, `src/main.tsx`, `src/ui/main-axios.ts`
- Infra: `docker/nginx.conf`, `docker/nginx-https.conf`

**Files scanned (concrete extractions):** 14
- `src/backend/branding/branding-config-loader.ts` (loader canonical, L1-467)
- `src/backend/branding/branding-routes.ts` (Cache-Control + never-throws GET, L1-272)
- `src/backend/branding/assert-boot.ts` (DIVERGENCE reference — what NOT to copy for D-07)
- `src/backend/starter.ts` (boot chain hook location, L380-440)
- `src/backend/database/database.ts` (route mount patterns, L131-2093 sample)
- `src/backend/database/routes/relay-room-participants.ts` (auth-gated router + drizzle username lookup, L1-160)
- `src/backend/utils/logger.ts` (sshLogger definition, L1-338)
- `src/ui/branding/branding-store.ts` (useSyncExternalStore singleton, L1-184)
- `src/ui/branding/branding-fetch.ts` (silent-no-op boot fetch, L1-87)
- `src/ui/features/pretty-view/AddWakeupDialog.tsx` (input-heavy modal chrome, L1-493)
- `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` (small modal + close-X, L1-96)
- `src/ui/components/dialog.tsx` (shared Radix wrappers + close-X pattern, L1-183)
- `src/ui/components/sonner.tsx` (Toaster wrapper — no change needed, L1-59)
- `src/ui/hooks/use-keyboard-toggle-pretty-mode.ts` (chord hook, L1-58)
- `src/ui/main-axios.ts` (authApi wrapper + `handleApiError`, L1-1665 sample)
- `src/main.tsx` (fire-and-forget boot fetch position L282, Toaster mount L243)
- `docker/nginx.conf` (branding location blocks L1172-1191)
- `docker/nginx-https.conf` (branding location blocks L1154+)

**Pattern extraction date:** 2026-09-19

---

*Phase: 122-user-feedback campaign shape 1: feedback pipeline*
*Pattern mapping ready for planner consumption.*
