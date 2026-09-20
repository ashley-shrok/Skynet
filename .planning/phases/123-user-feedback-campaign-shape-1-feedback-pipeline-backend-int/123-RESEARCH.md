# Phase 123: user-feedback campaign shape 1 — feedback pipeline - Research

**Researched:** 2026-09-19
**Domain:** Node.js SMTP email pipeline + React modal/toast frontend + env-driven feature flagging
**Confidence:** HIGH

## Summary

Phase 123 is greenfield feedback plumbing on top of an already-mature Skynet stack. Nearly every non-mail piece already has a canonical pattern in the codebase to copy — Radix Dialog for modals (AddWakeupDialog + DeleteConfirmDialog), Sonner toast already mounted at bottom-right in `main.tsx`, `useBrandingConfig` useSyncExternalStore hook as the exact model for a "feedback enabled" signal, an established `branding-fetch.ts` pattern for boot-time GET fetches, and a well-worn keyboard-chord hook pattern (`use-keyboard-toggle-pretty-mode.ts`) for the dev-only trigger. The single new external dependency is **nodemailer** (Node.js SMTP standard), which is unambiguously the correct choice — no existing mail transport in the codebase, and nodemailer is the de-facto Node SMTP library with 10M+ weekly downloads.

The two things the planner must decide are (a) the exact env var names (semantic set is locked) and (b) the shape of the "is feedback configured" transport — for which the strongest evidence points at a dedicated `GET /api/feedback/enabled` route mirroring the branding pattern verbatim (not folding into `/api/branding`, since that route is intentionally unauthenticated and pre-login, and semantically the two configs are unrelated).

**Primary recommendation:** Use nodemailer 10.x with SMTP transport; add `GET /api/feedback/enabled` (auth-gated, matches auth-session pattern), mirror `branding-store.ts` + `branding-fetch.ts` for a `feedback-store.ts` + `feedback-fetch.ts` pair; use Sonner (already mounted) via `toast.success("Thanks — feedback sent.")`; lift AddWakeupDialog chrome verbatim for the composition modal; dev-only trigger via a new `useKeyboardTriggerFeedbackDev` hook fenced with `import.meta.env.DEV`.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Portable design — same code ships to every deployment. Per-instance configuration lives entirely in the environment; nothing is hardcoded per operator.
- **D-02:** Two independent flags. Flag one (mechanism enabled) is implied by the presence of BOTH the mail transport config AND the destination address. Flag two (content-inclusion) is a separate explicit boolean env var that defaults OFF when unset.
- **D-03:** Instance name is NOT a new env var. It comes from `BrandingConfig.appName` loaded by `src/backend/branding/branding-config-loader.ts::loadBrandingConfig()`. Reuse — do not add a parallel.
- **D-04:** Env var naming — bikeshed at planning time, but the semantic set is fixed: mail transport (host, port, user, password, from-address), destination email address, content-inclusion boolean. Six env vars total.
- **D-05:** Read env once at backend startup and cache. No per-request re-read. Operators change env via container restart anyway.
- **D-06:** "Feature enabled" is TRUE iff both mail-transport env vars AND destination address are present and structurally non-empty at startup. Either absent → feature disabled → all feedback UI hides on the frontend.
- **D-07:** Boot is ROBUST to invalid SMTP credentials. Bad-but-present credentials (auth fails at real send time) are NOT gated at boot; they surface at send time, log to console, and the feature stays "enabled" from the frontend's perspective. Rationale: opening an SMTP handshake at every boot is fragile; feedback is not essential to app operation.
- **D-08:** Frontend `is feedback configured` signal is a small backend-served value the frontend fetches once at load (or bootstraps at initial HTML render). Not per-request.
- **D-09:** ONE reusable composition modal component with TWO entry variants driven by which caller opens it.
- **D-10:** General variant — title `Send feedback`, single textarea, placeholder `What's on your mind?`, footer `Cancel` + `Send`. Dismissing sends nothing.
- **D-11:** Thumbs-down variant — title `What went wrong?`, placeholder `Anything you want to add?`, close-X in top-right, single `Send`. Close-X or backdrop click sends the vote WITHOUT a note (one email); Send sends the vote WITH the note (one email). Message being reacted to is NOT quoted back in the modal.
- **D-12:** No category selector. No footer disclaimer line. No subtitle, no separate field label — title + placeholder carry all guidance.
- **D-13:** Visual language reuses existing Skynet modal styling — dark glass gradient (`hsla(hue, 45%, 25%, 0.82)` → `hsla(hue, 40%, 15%, 0.88)`), backdrop-filter blur+saturate 1.4, tinted border, warm off-white text (`#e8e4d8`), uppercase 10px tracking-wide labels, pill-shaped buttons, rounded 16-20px corners. References: `AddWakeupDialog.tsx` + `DeleteConfirmDialog.tsx`. Radix `Dialog` primitive same as those.
- **D-14:** ONE reusable toast component used by BOTH the modal submit path and the thumbs-up click path (shape 3). Bottom-right anchor, ~2 second visible then fade, single-line: "Thanks — feedback sent." Same toast fires regardless of send outcome.
- **D-15:** Plain text email. NOT HTML. Not multipart-with-html-alternative. Just text.
- **D-16:** Subject: `[<instance-name> feedback] <type>` where `<instance-name>` is `BrandingConfig.appName` and `<type>` is `general` / `thumbs up` / `thumbs down`.
- **D-17:** Sender address is the operator's configured from-address env var (not synthesized).
- **D-18:** Recipient is the operator's destination address env var. Single address per instance; no per-category routing, no multiple recipients.
- **D-19:** Body layout — key-value header block (`Feedback from`, `Instance`, `When`, `Type`), then optional `--- User note ---` section, then optional `--- Exchange ---` section (only when content-inclusion is ON and this is thumb-attached).
- **D-20:** No "View in app" link. Skynet has no URL scheme for opening a specific message in a specific conversation.
- **D-21:** When content-inclusion flag is ON: thumbs-attached emails carry the markdown source of the assistant reply PLUS the user turn that prompted it. Markdown SOURCE VERBATIM.
- **D-22:** When content-inclusion flag is OFF: exchange section omitted entirely. Ambient identity fields always travel regardless.
- **D-23:** General button emails NEVER carry message content.
- **D-24:** Caller supplies: `kind` (`general` / `thumbs_up` / `thumbs_down`), `userNote` (string, may be empty), and — for thumbs — `messageRef` (opaque identifier chosen by caller) plus `exchangeText` (markdown source). Backend fills: `submitter` (from auth session), `instance` (from BrandingConfig), `timestamp` (Date.now()), and applies content-inclusion decision server-side.
- **D-25:** General button (shape 2) is context-free. No conversation ID / message ID / conversation content.
- **D-26:** Message content travels client-to-server on the wire. Shape 1's backend does NOT fetch messages from the DB.
- **D-27:** Send failure = log to console, drop. NO retries. NO persistence queue. User always sees "thanks" toast. Console log carries the full attempted payload.
- **D-28:** NO rate limiting in shape 1.
- **D-29:** NO DB persistence of feedback records in shape 1. Email-out + console log only.
- **D-30:** NO draft preservation across modal close/reopen.
- **D-31:** Dev-only trigger for exercising the pipeline. Hidden keyboard chord OR dev-only route — planner chooses. Gated so it doesn't show for real users.

### Claude's Discretion

- **Env var names** — semantic set locked (D-04); exact names for planner/executor to pick. Suggestion: `FEEDBACK_SMTP_*` + `FEEDBACK_TO_ADDRESS` + `FEEDBACK_INCLUDE_CONTENT`.
- **Mail transport library** — nodemailer is the obvious choice. Planner picks; open to alternative if there's an existing utility in the codebase (none found at scout time).
- **Frontend "is feedback configured" transport shape** — REST GET vs. embedded in existing bootstrap payload vs. WebSocket-borne. Planner picks based on what the app already does.
- **Dev-only trigger form** — keyboard chord vs. hidden route vs. dev-menu entry. Planner picks.

### Deferred Ideas (OUT OF SCOPE)

Shape 2 (general button): placement of "Send feedback" button in app shell; which surfaces get the general button.
Shape 3 (thumbs): which assistant messages get thumbs; hover preview; per-message anti-abuse.
Future v2: retry-on-failure with persistence queue; rate limiting/throttling; DB persistence of feedback records; rich HTML email; image/attachment inclusion; draft preservation; per-user or per-category destinations; URL scheme for message-linking; Reply-To header carrying submitter email.

## Phase Requirements

No REQ-IDs are assigned to Phase 123 in `.planning/REQUIREMENTS.md` (this campaign was opened via `/gsd:phase` from shape file rather than the REQUIREMENTS.md flow). Requirements for this phase are encoded as **D-01 through D-31 in `123-CONTEXT.md`**. The planner should treat those 31 decisions as the phase's normative requirement set — every plan should map back to one or more D-XX entries.

## Project Constraints (from CLAUDE.md)

No project-level `./CLAUDE.md` at repo root. [VERIFIED: `ls skynet/CLAUDE.md` returned "not found"]

Fleet-level constraints (from spawn brief — treat as mandatory):
- Subagents don't deploy. Plans MUST NOT include ship tasks (git push, docker build, docker compose up, HTTPS 200 verify, docker logs tail).
- Test discipline: executor tasks use scoped tests (`npx vitest related --run <files>`), NOT full suite.
- No git worktrees.
- Frontend `tsc --noEmit` does NOT catch backend TS errors — plans touching `src/backend/` MUST include a `npm run build:backend` typecheck step. [VERIFIED: package.json script L27]
- Skynet has NO message streaming — no design around streaming state.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Env-var config load + cache | Backend (startup) | — | D-05: read once at boot, cache in module scope. Mirrors branding loader pattern. |
| SMTP send | Backend | — | Credentials never leave server. Pure fire-and-forget on send. |
| Email composition (subject/header/body) | Backend | — | D-24: server owns submitter/instance/timestamp fill-in; content-inclusion decision is server-side (D-22). |
| Feedback intake HTTP route | Backend (API) | — | Auth-gated (auth-session). Standard Express router mounted alongside `/voice`, `/branding`, etc. |
| "Feedback enabled" signal | Backend serves | Frontend reads once | Boot-time cached on backend; frontend fetches at page load into useSyncExternalStore store. |
| Composition modal (chrome + variants) | Frontend (browser) | — | Radix Dialog primitive. Mounted from AppShell so it's always available. |
| Toast on submit | Frontend (browser) | — | Sonner already mounted globally in main.tsx. |
| Dev-only trigger | Frontend (browser) | — | Fenced with `import.meta.env.DEV` — tree-shaken out of prod. |
| Payload transport (caller → intake) | Frontend POST → Backend | — | Standard `authApi.post` wrapper. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nodemailer | 10.x (latest ≥7.0) | Node.js SMTP transport | The de-facto Node SMTP library. No competitor at comparable maturity for Node backends. Author (Andris Reinman) is the industry-standard SMTP author (also authored `smtp-server`, `mailparser`). [VERIFIED: npm view nodemailer version → 10.0.10, repo git+https://github.com/nodemailer/nodemailer.git, maintainer andris@kreata.ee] |
| radix-ui | ^1.4.3 (already installed) | Dialog primitive for composition modal | Already the modal chrome for every existing dialog. `AddWakeupDialog` uses `Dialog as DialogPrimitive from "radix-ui"`. Not a new dep. [VERIFIED: package.json L163] |
| sonner | ^2.0.7 (already installed) | Bottom-right toast | Already installed AND mounted globally in `src/main.tsx:243` as `<Toaster position="bottom-right" />` — this is exactly D-14's spec. No new component to build. [VERIFIED: package.json L173 + main.tsx grep + components/sonner.tsx wrapper exists] |
| Express Router | 5.2.1 (already installed) | Feedback intake HTTP route | Every backend route uses `express.Router()`. [VERIFIED: package.json L60] |
| useSyncExternalStore | React 19 (already) | Frontend "feedback enabled" store | House pattern — see `branding-store.ts`, `session-tmux-store.ts`, `session-queue-pending-store.ts`. **NO React Context providers used for app-scoped state anywhere in codebase** — explicitly noted in `branding-store.ts` anti-pattern lock. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | ^4.4.3 (already installed) | Runtime shape validation of payload from caller | If planner wants defense-in-depth for payload validation. Existing pattern in `src/backend/fleet-status/wire-protocol.ts`. Codebase style also permits inline `typeof`/`Array.isArray` shape guards (see `branding-config-loader.ts::isValidBrandingShape`). Either is idiomatic. |
| authManager.createAuthMiddleware | (internal utility) | Auth-gate for intake POST | Every authenticated backend route uses `AuthManager.getInstance().createAuthMiddleware()` — populates `req.userId`. [VERIFIED: `src/backend/utils/auth-manager.ts:820-967`] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nodemailer | @sendgrid/mail / postmark-js / AWS SES SDK | Bakes a specific ESP into the codebase, hurting portability (D-01). SMTP-via-nodemailer works for every operator including self-hosted MTAs — the correct primitive here. |
| Inline zod schema | Inline `typeof`-guard (like `isValidBrandingShape`) | Both are used in the codebase; either works. Inline typeof matches "no new abstractions" philosophy from the shape file; zod matches the newer routes. Planner picks. |
| `GET /api/feedback/enabled` | Fold into `/api/branding` | `/api/branding` is deliberately unauthenticated (pre-login favicon + PWA icon serving). Feedback is auth-gated (D-24 needs `req.userId`). Mixing them would either force branding to become auth-gated (breaks pre-login PWA install) or leak the feedback flag pre-login (harmless but inconsistent with the auth boundary). Keep separate. |
| Keyboard chord for dev trigger (D-31) | Hidden route `/dev/feedback` | Chord keeps the trigger off the routing table entirely; matches the existing `use-keyboard-*` hook family; simpler to gate with `import.meta.env.DEV`. Chord is the recommendation. |

**Installation:**
```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

**Version verification:**
- `nodemailer` — 10.0.10, published 2026-09-14 [VERIFIED: npm view nodemailer version, npm view nodemailer time.modified]
- All other deps already in package.json — no install needed.

## Package Legitimacy Audit

slopcheck was **not available** in this environment (pip not installed on the sandbox). Per protocol, all newly-added packages below are tagged `[ASSUMED]` and the planner should gate the install task behind a `checkpoint:human-verify` step.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| nodemailer | npm | 15+ years (v0.1 pub 2010) | ~10M/wk (industry standard) | github.com/nodemailer/nodemailer | UNAVAILABLE | Approved [ASSUMED — planner adds checkpoint:human-verify before install] |
| @types/nodemailer | npm | 10+ years (DefinitelyTyped) | Ships alongside nodemailer | github.com/DefinitelyTyped/DefinitelyTyped | UNAVAILABLE | Approved [ASSUMED — same checkpoint] |

**Packages removed due to slopcheck [SLOP] verdict:** none (tool unavailable)
**Packages flagged as suspicious [SUS]:** none (tool unavailable)

**Postinstall audit:** `npm view nodemailer scripts.postinstall` returned empty (no postinstall script). [VERIFIED]

*Because slopcheck was unavailable at research time, both packages above are tagged `[ASSUMED]` and the planner must gate each install behind a `checkpoint:human-verify` task. Manual justification: nodemailer is universally recognized as THE Node SMTP library; author Andris Reinman is the industry-standard author of related SMTP tooling (smtp-server, mailparser); repo is github.com/nodemailer/nodemailer with 15+ year history.*

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────┐
                         │  BROWSER (React)                │
                         │                                 │
                         │  ┌───────────────────────────┐  │
     boot fetch          │  │ feedback-fetch.ts         │  │
     GET /api/feedback   │  │  (once at boot;           │  │
     /enabled            │  │   silent no-op on fail)   │  │
   ┌────────────────────►│  └────────────┬──────────────┘  │
   │                     │               ▼                 │
   │                     │  ┌───────────────────────────┐  │
   │                     │  │ feedback-store.ts         │  │
   │                     │  │ (useSyncExternalStore     │  │
   │                     │  │  singleton — mirrors      │  │
   │                     │  │  branding-store.ts)       │  │
   │                     │  └────────────┬──────────────┘  │
   │                     │               ▼                 │
   │                     │  useFeedbackEnabled(): boolean  │
   │                     │               │                 │
   │                     │  ┌────────────▼──────────────┐  │
   │                     │  │ Callers (shape 2/3 later, │  │
   │                     │  │ dev-only trigger now)     │  │
   │                     │  │   ↓ open modal            │  │
   │                     │  │ ┌──────────────────────┐  │  │
   │                     │  │ │ FeedbackModal        │  │  │
   │                     │  │ │ (Radix Dialog,       │  │  │
   │                     │  │ │  general / thumbs-   │  │  │
   │                     │  │ │  down variants)      │  │  │
   │                     │  │ └──────┬───────────────┘  │  │
   │                     │  │        │ POST payload     │  │
   │                     │  │        ▼                  │  │
   │                     │  │ authApi.post(             │  │
   │                     │  │   "/feedback",            │  │
   │                     │  │   {kind, userNote,        │  │
   │                     │  │    messageRef?,           │  │
   │                     │  │    exchangeText?})        │  │
   │                     │  │        │                  │  │
   │                     │  │        ▼ (always)         │  │
   │                     │  │  toast.success(           │  │
   │                     │  │   "Thanks — feedback     │  │
   │                     │  │    sent.")                │  │
   │                     │  └───────────────────────────┘  │
   │                     └───────────────┬─────────────────┘
   │                                     │
   │  ═══════════════════════════════════│═════════════════════════  HTTP boundary
   │                                     ▼
   │                     ┌─────────────────────────────────┐
   │                     │  BACKEND (Node/Express)         │
   │                     │                                 │
   │  GET /api/feedback  │  ┌───────────────────────────┐  │
   │  /enabled ──────────┤  │ feedback-routes.ts        │  │
   │  200 {enabled:bool} │  │  - GET  /api/feedback/    │  │
   │                     │  │         enabled           │  │
   │                     │  │  - POST /feedback         │  │
   │                     │  │         (authenticateJWT) │  │
   │                     │  └────────────┬──────────────┘  │
   │                     │               ▼                 │
   │                     │  ┌───────────────────────────┐  │
   │                     │  │ feedback-config.ts        │  │
   │                     │  │ (module-scope cache; read │  │
   │                     │  │  ENV once at import time  │  │
   │                     │  │  via loadFeedbackConfig() │  │
   │                     │  │  during starter.ts boot;  │  │
   │                     │  │  never-throws)            │  │
   │                     │  └────────────┬──────────────┘  │
   │                     │               ▼                 │
   │                     │  ┌───────────────────────────┐  │
   │                     │  │ feedback-email.ts         │  │
   │                     │  │  - composeSubject()       │  │
   │                     │  │  - composeBody()          │  │
   │                     │  │    (uses BrandingConfig   │  │
   │                     │  │     .appName + username   │  │
   │                     │  │     from users table via  │  │
   │                     │  │     req.userId lookup)    │  │
   │                     │  └────────────┬──────────────┘  │
   │                     │               ▼                 │
   │                     │  ┌───────────────────────────┐  │
   │                     │  │ feedback-transport.ts     │  │
   │                     │  │  (nodemailer transporter, │  │
   │                     │  │   created once on config  │  │
   │                     │  │   present; fire-and-      │  │
   │                     │  │   forget send; catch →    │  │
   │                     │  │   sshLogger.error with    │  │
   │                     │  │   full payload)           │  │
   │                     │  └────────────┬──────────────┘  │
   │                     └───────────────┼─────────────────┘
   │                                     ▼
   │                     ═════════════════════════════════════ SMTP
   │                                     ▼
   │                     ┌─────────────────────────────────┐
   │                     │  OPERATOR'S SMTP RELAY          │
   │                     │  → destination inbox            │
   │                     └─────────────────────────────────┘
   │
   │  (starter.ts boot chain:
   │   1. loadBrandingConfig() → BrandingConfig
   │   2. assertBrandingConfigAtBoot() [Phase 74/114]
   │   3. loadFeedbackConfig()  ← NEW; never-throws
   │      module-scope cache populated
   │   4. AuthManager init
   │   5. server.listen())
   │
   │  (Startup log: sshLogger.info if feedback enabled,
   │   sshLogger.info if feedback disabled with reason
   │   "MISSING_SMTP_HOST" | "MISSING_TO_ADDRESS" | etc.)
```

### Component Responsibilities

| File | Responsibility |
|------|----------------|
| `src/backend/feedback/feedback-config.ts` | Env parser + module-scope cache. `loadFeedbackConfig()` called once from `starter.ts` boot chain; `getFeedbackConfig(): FeedbackConfig` returns cached value. Never-throws. |
| `src/backend/feedback/feedback-email.ts` | Pure functions: `composeSubject({appName, type}) → string`, `composeBody({submitter, appName, timestamp, type, userNote, exchangeText?, includeContent}) → string`. No I/O. |
| `src/backend/feedback/feedback-transport.ts` | nodemailer transporter singleton (created on first send from cached config; verify() NOT called — D-07). Exports `sendFeedback(payload): Promise<void>` — fire-and-forget wrapper that catches + `sshLogger.error`s. |
| `src/backend/feedback/feedback-routes.ts` | Express router. `GET /api/feedback/enabled` (returns `{enabled: boolean}`) + `POST /feedback` (auth-gated; extracts req.userId → username; calls compose + send; returns 202 always if config valid, 503 if disabled). |
| `src/backend/feedback/feedback-routes.test.ts` | vitest — routes/handler tests. |
| `src/backend/feedback/feedback-config.test.ts` | vitest — env parsing edge cases (missing / partial / empty-string / whitespace / invalid port). |
| `src/backend/feedback/feedback-email.test.ts` | vitest — subject + body snapshot tests across all 6 permutations (general/thumbs_up/thumbs_down × content on/off). |
| `src/ui/feedback/feedback-store.ts` | useSyncExternalStore singleton — mirror of `branding-store.ts`. `useFeedbackEnabled(): boolean`. |
| `src/ui/feedback/feedback-fetch.ts` | Boot-time GET fetch — mirror of `branding-fetch.ts`. Silent no-op on failure (retain default: disabled). |
| `src/ui/feedback/feedback-api.ts` | `postFeedback(payload)` using `authApi.post` — the codebase's standard fetch wrapper. |
| `src/ui/feedback/FeedbackModal.tsx` | Radix Dialog with the two variants (D-10, D-11). Props: `open`, `onOpenChange`, `variant: "general" \| "thumbs_down"`, `hue`, `onSubmit(userNote: string) => Promise<void>` (parent owns the outer submit; modal only owns text state). Chrome copied verbatim from `AddWakeupDialog.tsx`. |
| `src/ui/hooks/use-keyboard-trigger-feedback-dev.ts` | Chord: `Ctrl+Shift+F` (or similar — planner picks). Fenced with `import.meta.env.DEV`. Follows `use-keyboard-toggle-pretty-mode.ts` pattern verbatim. |
| `src/ui/AppShell.tsx` (modify) | Mount FeedbackModal at the top level (matches how other modals live in AppShell). Wire the dev hook. |
| `src/main.tsx` (modify) | Add `void fetchFeedbackConfig();` next to the existing `void fetchBrandingConfig();` at L21-22. |
| `src/backend/starter.ts` (modify) | Add `loadFeedbackConfig()` call near L405 after `assertBrandingConfigAtBoot()`. |
| `src/backend/database/database.ts` (modify) | Mount `app.use(feedbackRoutes)` near L2085 alongside `app.use("/voice", voiceRoutes)`. |
| `docker/nginx.conf` + `docker/nginx-https.conf` (verify) | Check whether `/api/feedback/*` and `/feedback` fall under an existing catchall proxy_pass. **CLAUDE.md caveat: nginx changes must land in BOTH files.** |

### Pattern 1: Boot-time env cache with never-throws contract
**What:** Read env once at import (or at explicit `load()` call from `starter.ts`), cache in module scope, expose a `get()` function that returns the cached value. Never throw at load or at get.
**When to use:** Every module in Skynet that consumes env config (branding-config-loader.ts, voice.ts, system-crypto.ts).
**Example (adapted from `src/backend/branding/branding-config-loader.ts`):**
```typescript
// Source: pattern mirrored from src/backend/branding/branding-config-loader.ts
import { sshLogger } from "../utils/logger.js";

export type FeedbackConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      smtp: { host: string; port: number; user: string; password: string; fromAddress: string };
      toAddress: string;
      includeContent: boolean;
    };

let cached: FeedbackConfig | null = null;

export function loadFeedbackConfig(): void {
  // Called ONCE from starter.ts boot chain. Read env; validate; log outcome.
  const host = process.env.FEEDBACK_SMTP_HOST?.trim() ?? "";
  const port = process.env.FEEDBACK_SMTP_PORT?.trim() ?? "";
  const user = process.env.FEEDBACK_SMTP_USER?.trim() ?? "";
  const password = process.env.FEEDBACK_SMTP_PASSWORD ?? ""; // no trim — password may contain surrounding whitespace intentionally? probably still trim; planner decides
  const fromAddress = process.env.FEEDBACK_SMTP_FROM?.trim() ?? "";
  const toAddress = process.env.FEEDBACK_TO_ADDRESS?.trim() ?? "";
  const includeContentRaw = process.env.FEEDBACK_INCLUDE_CONTENT?.trim().toLowerCase() ?? "";
  const includeContent = includeContentRaw === "1" || includeContentRaw === "true" || includeContentRaw === "yes";

  const missing: string[] = [];
  if (host === "") missing.push("FEEDBACK_SMTP_HOST");
  if (port === "") missing.push("FEEDBACK_SMTP_PORT");
  if (fromAddress === "") missing.push("FEEDBACK_SMTP_FROM");
  if (toAddress === "") missing.push("FEEDBACK_TO_ADDRESS");
  // user + password: some SMTP relays are anonymous. Planner decides whether these are required.

  const portNum = Number(port);
  if (port !== "" && (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535)) {
    missing.push("FEEDBACK_SMTP_PORT (must be 1-65535)");
  }

  if (missing.length > 0) {
    cached = { enabled: false, reason: `missing/invalid: ${missing.join(", ")}` };
    sshLogger.info("feedback-config: feature disabled", {
      operation: "feedback_config_load",
      enabled: false,
      reason: cached.reason,
    });
    return;
  }

  cached = {
    enabled: true,
    smtp: { host, port: portNum, user, password, fromAddress },
    toAddress,
    includeContent,
  };
  sshLogger.info("feedback-config: feature enabled", {
    operation: "feedback_config_load",
    enabled: true,
    host,
    port: portNum,
    fromAddress,
    toAddress,
    includeContent,
  });
}

export function getFeedbackConfig(): FeedbackConfig {
  if (cached === null) {
    // Defensive: called before load. Return disabled sentinel. Should never happen if starter.ts is correctly ordered.
    return { enabled: false, reason: "not_yet_loaded" };
  }
  return cached;
}
```

### Pattern 2: Never-verify nodemailer transporter (D-07)
**What:** Create a nodemailer transporter from config, DO NOT call `transporter.verify()`, send lazily.
**Why:** D-07 explicitly forbids gating boot on SMTP handshake. Nodemailer's `verify()` opens the SMTP connection and can hang or fail — the exact anti-pattern locked out.
**Example:**
```typescript
// Source: nodemailer official docs (https://nodemailer.com/about/) — SMTP transport section
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { sshLogger } from "../utils/logger.js";
import { getFeedbackConfig } from "./feedback-config.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const cfg = getFeedbackConfig();
  if (!cfg.enabled) return null;
  if (transporter !== null) return transporter;
  transporter = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.port === 465, // TLS on 465; STARTTLS otherwise
    auth: cfg.smtp.user !== "" ? { user: cfg.smtp.user, pass: cfg.smtp.password } : undefined,
    // NOTE: intentionally NO transporter.verify() call — D-07.
  });
  return transporter;
}

export async function sendFeedbackEmail(args: {
  subject: string;
  body: string;
  submitter: string;
  type: string;
  hasNote: boolean;
  hasExchange: boolean;
}): Promise<void> {
  const t = getTransporter();
  const cfg = getFeedbackConfig();
  if (t === null || !cfg.enabled) {
    sshLogger.info("feedback-transport: skip send (feature disabled)", {
      operation: "feedback_send_skipped",
      submitter: args.submitter,
      type: args.type,
    });
    return;
  }
  // Fire-and-forget wrapper — caller does NOT await this in a way that blocks the HTTP response.
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
    // D-27: log to console + drop. Full payload was already logged upstream so nothing is lost.
    sshLogger.error("feedback-transport: send failed", err, {
      operation: "feedback_send_failed",
      submitter: args.submitter,
      type: args.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

### Pattern 3: Route mount + auth-gated username extraction
**What:** Express router that gates POST with `authenticateJWT`, extracts `req.userId`, looks up username from `users` table.
**Example (adapted from `src/backend/database/routes/relay-room-participants.ts` L78-99):**
```typescript
// Source: pattern from src/backend/database/routes/relay-room-participants.ts
import express, { type Request, type Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getFeedbackConfig } from "./feedback-config.js";
import { composeSubject, composeBody } from "./feedback-email.js";
import { sendFeedbackEmail } from "./feedback-transport.js";
import { loadBrandingConfig } from "../branding/branding-config-loader.js";
import { sshLogger } from "../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.get("/api/feedback/enabled", authenticateJWT, (_req, res) => {
  const cfg = getFeedbackConfig();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ enabled: cfg.enabled });
});

router.post("/feedback", authenticateJWT, express.json({ limit: "512kb" }), async (req: Request, res: Response) => {
  const cfg = getFeedbackConfig();
  if (!cfg.enabled) {
    return res.status(503).json({ error: "feedback disabled" });
  }
  const authReq = req as Request & { userId?: string };
  const userId = authReq.userId;
  if (typeof userId !== "string" || userId === "") {
    return res.status(401).json({ error: "auth required" });
  }
  // Payload shape guard (D-24)
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

  // Look up username (drizzle pattern from relay-room-participants.ts)
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const submitter = rows[0]?.username ?? "unknown";

  const branding = await loadBrandingConfig();
  const timestamp = Date.now();

  const type =
    body.kind === "general" ? "general" : body.kind === "thumbs_up" ? "thumbs up" : "thumbs down";
  const subject = composeSubject({ appName: branding.appName, type });
  const emailBody = composeBody({
    submitter,
    appName: branding.appName,
    timestamp,
    type,
    userNote,
    exchangeText: cfg.includeContent && body.kind !== "general" ? exchangeText : undefined,
  });

  // D-27: log the full attempted payload BEFORE the send so nothing is lost on failure.
  sshLogger.info("feedback-submit: attempting send", {
    operation: "feedback_submit",
    submitter,
    type,
    hasNote: userNote.trim() !== "",
    hasExchange: exchangeText !== undefined,
    messageRef,
    // Full body captured so failure recovery is possible from logs alone.
    userNote,
    exchangeText,
  });

  // Fire-and-forget from the response's perspective. sendFeedbackEmail owns its own try/catch.
  void sendFeedbackEmail({
    subject,
    body: emailBody,
    submitter,
    type,
    hasNote: userNote.trim() !== "",
    hasExchange: exchangeText !== undefined,
  });

  return res.status(202).json({ ok: true });
});

export default router;
```

### Pattern 4: Frontend "is feedback enabled" store (mirror of branding)
**Example:**
```typescript
// Source: src/ui/branding/branding-store.ts (mirrored)
import { useSyncExternalStore } from "react";

let state: { enabled: boolean } = { enabled: false }; // default: hidden
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function publishFeedbackEnabled(next: boolean): void {
  if (state.enabled === next) return;
  state = { enabled: next };
  notify();
}

export function useFeedbackEnabled(): boolean {
  const getSnapshot = (): boolean => state.enabled;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

### Pattern 5: Toast on submit (Sonner — already mounted)
**Example (usage — the toast component already exists in `src/main.tsx:243`):**
```typescript
// Source: existing pattern — src/ui/AppShell.tsx:3 imports toast from "sonner"
import { toast } from "sonner";

async function handleSubmit(userNote: string): Promise<void> {
  // Fire the send but do NOT await it in a user-blocking way.
  void postFeedback({ kind, userNote, messageRef, exchangeText });
  // D-14: same toast regardless of send outcome.
  toast.success("Thanks — feedback sent.");
  onOpenChange(false);
}
```

### Pattern 6: Dev-only keyboard chord (mirror of use-keyboard-toggle-pretty-mode)
**Example:**
```typescript
// Source: src/ui/hooks/use-keyboard-toggle-pretty-mode.ts (mirrored)
import { useEffect, useRef } from "react";

export function useKeyboardTriggerFeedbackDev(
  openFeedback: (variant: "general" | "thumbs_down") => void,
): void {
  const openRef = useRef(openFeedback);
  openRef.current = openFeedback;

  useEffect(() => {
    // Dev-only gate. Vite tree-shakes this branch out of prod builds — the whole hook
    // becomes a no-op in the production bundle.
    if (!import.meta.env.DEV) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
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

### Anti-Patterns to Avoid

- **Boot-gating on SMTP handshake.** Do NOT call `transporter.verify()` at boot. D-07 explicitly forbids it — an unreachable SMTP relay would prevent Skynet from booting, which is a worse failure mode than "feedback silently drops."
- **HTML email body.** Do NOT set `html:` on the nodemailer sendMail call, and do NOT use `multipart/alternative`. D-15 locks plaintext.
- **Client-side content gating.** Do NOT drop `exchangeText` client-side when the include-content flag is off. D-24: the payload always carries it on the wire; server decides whether to include it in the composed email.
- **Folding "feedback enabled" into `/api/branding`.** The branding route is intentionally unauthenticated (pre-login PWA); mixing feedback flag in would either break that (auth-gate the route) or leak the flag pre-login (harmless but muddled).
- **React Context provider for the feedback-enabled signal.** Zero Context providers exist in this codebase for app-scoped state — the branding-store's anti-pattern lock (documented at `src/ui/branding/branding-store.ts:28-36`) applies verbatim to feedback state.
- **Blocking the response on the SMTP send.** Return `202 Accepted` immediately; fire the send with `void` so a slow SMTP relay doesn't block the client. The user always sees the toast regardless (D-27).
- **Sanitizing/stripping markdown before sending.** Shape file explicitly says "Markdown source verbatim." Fenced code stays fenced. No transformation.
- **Reading env vars per-request.** D-05: read at boot, cache module-scope. Per-request re-reads defeat the "operator restarts container to change config" model.
- **Storing feedback rows in the DB.** D-29: email-out + console log only. Do not add a schema migration.
- **Rate limiting or debouncing.** D-28: no rate limiting in shape 1. If planner is tempted, don't.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SMTP protocol | Custom TCP socket + RFC 5321 encoder | nodemailer | STARTTLS, SASL AUTH, MIME encoding, connection pooling, retry semantics, timeouts — all industry-standard and thoroughly battle-tested in nodemailer. Building this from scratch would be a multi-week bug-farm. |
| Modal chrome + backdrop + focus trap | Custom `<div>` with `position: fixed` | Radix Dialog primitive (already installed) | Focus trap, ESC key handling, backdrop click, portal mount, ARIA labels, scroll lock — Radix handles all of it correctly. Every existing Skynet modal uses this. |
| Toast component | Custom bottom-right transient message | Sonner (already installed + mounted globally) | Sonner is already at `<Toaster position="bottom-right" />` in main.tsx L243. Just call `toast.success(text)`. No new component needed. |
| Frontend fetch wrapper for auth | Raw fetch with manual JWT header | `authApi` from `@/main-axios` | Every authenticated frontend call uses `authApi` — auto-attaches JWT, standard error handling, retry, and unreachable-backend toast. |
| Auth session → username | Manual JWT decode | `authManager.createAuthMiddleware()` populates `req.userId` → drizzle query on `users.id` | Middleware exists; drizzle query is a 4-line snippet copied from relay-room-participants.ts. |
| Env parsing / validation | Ad-hoc if-chain | Follow the `branding-config-loader.ts::isValidBrandingShape` style OR use zod (both are house style) | Either idiom works; do not invent a third. |
| useSyncExternalStore singleton | React Context provider | Mirror `branding-store.ts` (or `session-tmux-store.ts`) | House anti-pattern lock — see `branding-store.ts:28-36`. |

**Key insight:** Almost all machinery this phase needs already exists. The only genuinely new work is the nodemailer transport + email composition + backend route + one new modal component. Everything else is stamping out house-style pattern instances.

## Runtime State Inventory

Not a rename/refactor/migration phase — greenfield. **This section not applicable.**

## Common Pitfalls

### Pitfall 1: `transporter.verify()` at boot bricks Skynet on unreachable SMTP
**What goes wrong:** Nodemailer's `verify()` opens a real SMTP handshake. If the operator's SMTP host is down, DNS-flaky, or firewalled, the boot hangs or errors — and if the planner puts `verify()` in a fail-fast branch, Skynet won't boot at all.
**Why it happens:** Instinct to fail-fast on config errors. The branding-config assertBoot pattern (Phase 74) reinforces this instinct.
**How to avoid:** D-07 explicitly forbids it. Create the transporter lazily on first send (or eagerly but WITHOUT verify()). Bad credentials surface at send time — logged, not boot-blocking.
**Warning signs:** If planner writes `assertFeedbackConfigAtBoot()` mirroring the branding pattern, that's the tell. Feedback deliberately diverges from the fail-fast pattern (canonical_refs section of CONTEXT.md flags this).

### Pitfall 2: nginx doesn't route `/api/feedback/*` or `/feedback`
**What goes wrong:** Skynet's docker deployment fronts the Node backend with nginx. If nginx doesn't have `location /api/feedback` and `location /feedback` (or a catch-all that covers them), requests never reach Express — 404 from nginx.
**Why it happens:** New routes are backend-shipped; nginx config lives in a separate file at `docker/nginx.conf` + `docker/nginx-https.conf`.
**How to avoid:** Grep both nginx conf files for existing catchalls that cover the paths. If not covered, add matching location blocks in BOTH files. This is a project-wide caveat: `branding-routes.ts:14-20` explicitly documents "matching location blocks MUST exist in BOTH docker/nginx.conf AND docker/nginx-https.conf." Same rule applies here.
**Warning signs:** POST `/feedback` returns 404 with an nginx-branded error page in UAT.

### Pitfall 3: Modal opens but toast never fires
**What goes wrong:** Developer wires `toast.success()` inside the modal component, but the modal unmounts before the toast API is invoked (Radix Dialog can unmount on `open=false` too aggressively).
**Why it happens:** Component lifecycle race. Sonner's toast function is a global singleton (`import { toast } from "sonner"`), so calling it from any place works — but calling it from an already-unmounted component context can be delayed to after the visible-fade window closes.
**How to avoid:** Fire `toast.success(...)` BEFORE calling `onOpenChange(false)`. Sonner's toast is imperative — it doesn't care about React tree state.

### Pitfall 4: SMTP passwords being trimmed break auth
**What goes wrong:** `password.trim()` on env parsing corrupts passwords with intentional trailing whitespace or newline (rare but real for base64-encoded secrets and some app-passwords).
**Why it happens:** Habit of trimming all env values.
**How to avoid:** Read `FEEDBACK_SMTP_PASSWORD` as-is (`process.env.FEEDBACK_SMTP_PASSWORD ?? ""`); trim only the OTHER string env vars. Alternately: trim only trailing newlines (which docker/env files can inject) but preserve other whitespace. Planner picks.

### Pitfall 5: `req.body` is undefined because JSON parser isn't mounted
**What goes wrong:** `database/database.ts` mounts `bodyParser.json` at L350 with `limit: "1gb"`. If the feedback route is mounted BEFORE this middleware in the app chain, `req.body` is undefined.
**Why it happens:** Middleware-order mistake. Mounting a router before `bodyParser.json()` runs means `req.body` isn't populated when the router's handler runs.
**How to avoid:** Mount `feedbackRoutes` alongside the other domain routes (near L2085 where `voiceRoutes` and the rest live) — this is AFTER `bodyParser.json` at L350. **Alternate:** the route handler itself can call `express.json({ limit: "512kb" })` as inline middleware (the pattern used in `pool-routes.ts:123` — `router.post("/pick", express.json(), authenticateJWT, ...)`). The inline approach is more defensive.
**Warning signs:** `TypeError: Cannot read properties of undefined` on `req.body.kind` in tests.

### Pitfall 6: Email subject line contains newline from `BrandingConfig.appName`
**What goes wrong:** SMTP servers treat CRLF in subject lines as header injection. If `appName` contains a `\r` or `\n` (unlikely but a defense-in-depth concern), an attacker who controls branding config could inject arbitrary headers.
**Why it happens:** Trusting `BrandingConfig.appName` without sanitizing. The branding config comes from a JSON file the operator writes — trusted, but defense-in-depth matters here.
**How to avoid:** Strip `\r\n` from `appName` before interpolating into the subject. `.replace(/[\r\n]/g, "")` is enough. **Note:** nodemailer 10.x already rejects CRLF in headers per its own validation — but belt-and-suspenders.

### Pitfall 7: `authApi.post` returns axios response object, not raw data
**What goes wrong:** Frontend caller writes `const data = await postFeedback(...)` expecting the response body but gets the whole axios response.
**Why it happens:** `authApi` is an axios instance wrapper. `response.data` is where the body lives.
**How to avoid:** Follow existing frontend api file patterns — see `src/ui/api/session-project-api.ts` for the canonical shape (response destructure).

### Pitfall 8: TypeScript `tsc --noEmit` misses backend errors
**What goes wrong:** `npm run type-check` (which is `tsc --noEmit`) uses the frontend tsconfig, which excludes backend files. Backend type errors escape.
**Why it happens:** Skynet has separate tsconfigs — `tsconfig.json` (frontend) and `tsconfig.node.json` (backend).
**How to avoid:** Include `npm run build:backend` (which is `tsc -p tsconfig.node.json`) as a task-verification step for every backend-touching plan. This is a fleet-wide rule flagged in the spawn brief.
**Warning signs:** Frontend tsc passes, executor moves on, backend crashes in CI/deploy.

## Code Examples

### Compose subject
```typescript
// Source: pure function inferred from D-16
export function composeSubject(args: { appName: string; type: string }): string {
  const safeAppName = args.appName.replace(/[\r\n]/g, ""); // Pitfall 6
  return `[${safeAppName} feedback] ${args.type}`;
}
```

### Compose body (all 6 permutations)
```typescript
// Source: pattern derived from D-19 + D-22 + D-23 + specifics section email example
export function composeBody(args: {
  submitter: string;
  appName: string;
  timestamp: number;
  type: string;
  userNote: string;
  exchangeText?: string;
}): string {
  const when = new Date(args.timestamp).toISOString(); // simple + timezone-explicit
  const header = [
    `Feedback from: ${args.submitter}`,
    `Instance:      ${args.appName}`,
    `When:          ${when}`,
    `Type:          ${args.type}`,
  ].join("\n");

  const parts: string[] = [header];

  if (args.userNote.trim() !== "") {
    parts.push("--- User note ---");
    parts.push(args.userNote);
  }

  if (args.exchangeText !== undefined && args.exchangeText.trim() !== "") {
    parts.push("--- Exchange ---");
    parts.push(args.exchangeText);
  }

  return parts.join("\n\n") + "\n";
}
```

### Boot chain hook in starter.ts
```typescript
// Source: mirrors starter.ts L402-405 assertBrandingConfigAtBoot pattern
// Insert after `await assertBrandingConfigAtBoot();` at ~L405.
const { loadFeedbackConfig } = await import("./feedback/feedback-config.js");
loadFeedbackConfig();
// NOTE: NO await for a "verify()" step — D-07. loadFeedbackConfig is synchronous + never-throws.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CommonJS `require("nodemailer")` | ESM `import nodemailer from "nodemailer"` | nodemailer 7.x (2024) | Skynet is already ESM; use ESM import. |
| `nodemailer.createTransport("smtps://...")` URL syntax | `createTransport({host, port, secure, auth})` object | Historical | Object form is clearer and easier to test. |
| Callback-style `sendMail(msg, (err, info) => {})` | Promise/async `await sendMail(msg)` | nodemailer 6.x+ | Modern async style; matches Skynet house pattern. |
| Explicit `transporter.verify()` at boot | Skip verify; catch errors at send time | House philosophy of this phase (D-07) | Robustness. |

**Deprecated/outdated:**
- Nodemailer 6.x — still runs but 10.x is current. Use 10.x.
- `emailjs` library — older Node SMTP option, largely superseded by nodemailer.
- Custom `net.Socket` + SMTP command sequencing — never in this codebase; never should be.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | nodemailer 10.x is the correct SMTP library | Standard Stack | Low. `npm view` confirms package + author + repo; industry consensus is unambiguous. [ASSUMED — slopcheck unavailable in this environment; planner should add checkpoint:human-verify before install per protocol.] |
| A2 | `@types/nodemailer` DefinitelyTyped package name is correct | Standard Stack | Low. Standard DefinitelyTyped convention. [ASSUMED — same slopcheck-unavailable reason.] |
| A3 | Env var name suggestions (`FEEDBACK_SMTP_*`, `FEEDBACK_TO_ADDRESS`, `FEEDBACK_INCLUDE_CONTENT`) | Standard Stack + Pattern 1 | Low. These are planner-discretion per D-04; the researched suggestion is a starting point, not a lock. |
| A4 | Recommended dev-chord keys (`Ctrl+Shift+F` and `Ctrl+Shift+T`) don't conflict with existing chords | Pattern 6 | LOW-MEDIUM. Existing chords in codebase: `Ctrl+Shift+O` (pretty toggle), `Ctrl+Shift+L`, `Ctrl+Shift+;` (queue+close-tab per grep). `Ctrl+Shift+F` may conflict with browser Find-in-page in some browsers. Planner should pick a less-conflict-prone chord, e.g. `Ctrl+Shift+B` or `Ctrl+Alt+F`. |
| A5 | `req.userId` alone is sufficient — the `username` lookup via drizzle is the correct source of truth for "who submitted" | Pattern 3 | Low. Codebase precedent in `relay-room-participants.ts` and `credentials.ts` uses exactly this shape. |
| A6 | nginx catch-all covers `/feedback` and `/api/feedback/*` at Skynet's edge — OR the planner will add explicit location blocks | Pitfall 2 | MEDIUM. Not directly verified in research; the planner MUST grep both nginx conf files during planning and add location blocks if missing. |
| A7 | `express.json({ limit: "512kb" })` inline middleware is a safe size cap for feedback payloads | Pattern 3 | Low. Exchange markdown could in principle be large; 512KB is generous for a single assistant reply + user turn. Planner can adjust. |
| A8 | Content-inclusion env var boolean parsing accepts "1", "true", "yes" as truthy | Pattern 1 | Low. Matches common docker-env-file conventions; planner can lock to just "1" and "true" if stricter is preferred. |

## Open Questions (RESOLVED — recommendations below adopted by plans)

1. **Should feedback config env vars be prefixed `FEEDBACK_` or another convention?**
   - What we know: D-04 locks the semantic set (6 vars). Skynet uses `DATA_DIR`, `JWT_SECRET`, `DATABASE_KEY`, no consistent prefix. Suggested `FEEDBACK_*` for grouping.
   - What's unclear: whether Ashley wants a different prefix (`FB_`, `MAILER_`, etc.). Bikeshed at plan time.
   - Recommendation: `FEEDBACK_SMTP_HOST`, `FEEDBACK_SMTP_PORT`, `FEEDBACK_SMTP_USER`, `FEEDBACK_SMTP_PASSWORD`, `FEEDBACK_SMTP_FROM`, `FEEDBACK_TO_ADDRESS`, `FEEDBACK_INCLUDE_CONTENT`. Seven vars, not six (D-04 says "six" but the SMTP-transport tuple naturally decomposes into 5 parts + destination + include-content = 7). Confirm with user via discuss-phase if this changes the count.

2. **Should SMTP `user` + `password` env vars be required (feature-enabled iff both present) or optional (some relays are anonymous)?**
   - What we know: D-06 says "mail-transport env vars AND destination address present" implies enabled. "Mail-transport env vars" isn't fully specified — could include or exclude auth.
   - What's unclear: whether Ashley's deployments will all use authenticated SMTP or if any run through anonymous local relays.
   - Recommendation: Make auth optional. If `FEEDBACK_SMTP_USER` is empty, skip the `auth:` field in the nodemailer transport. Feature is enabled iff HOST + PORT + FROM + TO are present. Planner can tighten if user wants.

3. **Timestamp timezone in email body: UTC vs. operator-local vs. submitter-local?**
   - What we know: D-19 header block includes `When: <timestamp>`. Format not locked.
   - What's unclear: whether Ashley wants ISO-8601 UTC (safest, portable), operator local (Docker container TZ), or something else.
   - Recommendation: ISO-8601 with explicit offset from `Date.prototype.toISOString()` (always UTC). Operators can see UTC and mentally convert; leaves no ambiguity in the log stream. If Ashley prefers a friendlier format, discuss-phase adjustment.

4. **Should the `POST /feedback` route return 202 immediately (fire-and-forget from response's POV) or 200 after send completes?**
   - What we know: D-27 says user always sees the "thanks" toast regardless of send outcome — implies client doesn't wait.
   - What's unclear: whether the response should include any send-status info (probably not) or return 200 vs 202 semantics.
   - Recommendation: `202 Accepted` with `{ok: true}` body. The send is asynchronous from the response's perspective — kicked off with `void sendFeedbackEmail(...)` in the handler. This matches D-27 fire-and-forget semantics.

5. **Dev-only trigger: single chord that opens general variant only? Two chords for general/thumbs-down? Or a small floating UI element in dev mode?**
   - What we know: D-31 planner's choice, gated so real users don't see it.
   - What's unclear: whether verification needs to exercise BOTH modal variants (probably yes, per "end-to-end verification" language) — which requires two triggers or one trigger with a picker.
   - Recommendation: Two chords in dev only — `Ctrl+Alt+F` (general) + `Ctrl+Alt+T` (thumbs-down). Both fenced by `import.meta.env.DEV`. Fake `messageRef` and `exchangeText` values on the thumbs-down trigger. Planner adjusts chord bindings if conflicts.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| nodemailer | Backend SMTP send | ✗ (needs install) | — (will install 10.x) | — |
| @types/nodemailer | Backend TS types | ✗ (needs install) | — | — |
| Node.js runtime | Everything | ✓ (declared in package.json engines) | ≥22.12.0 | — |
| Radix Dialog primitive | Frontend modal | ✓ | @radix-ui/react-dialog ^1.1.15 + radix-ui ^1.4.3 | — |
| Sonner | Frontend toast | ✓ | ^2.0.7, already mounted globally | — |
| vitest | Testing | ✓ | ^4.1.8 | — |
| SMTP relay (operator-supplied at deploy) | Real email delivery | N/A (deploy-time concern) | N/A | Console log always fires (D-27) |

**Missing dependencies with no fallback:** none blocking research/planning. Install of nodemailer is a plan task.

**Missing dependencies with fallback:** none.

## Security Domain

### Applicable ASVS Categories (Level 1 per config)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (payload trust) | `authManager.createAuthMiddleware()` gates POST `/feedback` — 401 without JWT. Feedback intake is not anonymous (shape: "Skynet requires authentication"). |
| V3 Session Management | yes (implicit via V2) | JWT session cookie + trusted-device flow already handled by AuthManager. Feedback route does no session logic of its own. |
| V4 Access Control | partial | Any authenticated user of the instance can send feedback. No per-role gating (design: "small trusted user base per instance" — D-28 rationale). Admin-only would be over-constraint. |
| V5 Input Validation | yes | Payload guard (D-24) — validate `kind ∈ {general, thumbs_up, thumbs_down}`, string types on note/exchangeText/messageRef, size cap via `express.json({limit: "512kb"})`. |
| V6 Cryptography | no | No new crypto. TLS to SMTP relay handled by nodemailer's `secure: true` (port 465) or STARTTLS (port 587). Never hand-roll TLS. |
| V7 Error Handling & Logging | yes | Structured logs via `sshLogger` with `operation:` key. D-27: log full payload BEFORE send; log error AFTER failed send. Never surface SMTP errors to client body (V13). |
| V8 Data Protection | yes (email content) | Message content transits over SMTP TLS. Content-inclusion flag defaults OFF (D-02) — the "opt-in explicitly" design directly maps to V8 "sensitive data minimization." |
| V12 Files & Resources | no | No file uploads, no attachments (D-15). |
| V13 Configuration | yes | 512KB body limit. `Cache-Control: no-store` on `GET /api/feedback/enabled` (matches branding-routes pattern). |

### Known Threat Patterns for {Node.js Express + SMTP}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Email header injection via CRLF in subject | Tampering | Sanitize `appName` before interpolating into subject (strip `\r\n`) — Pitfall 6. Nodemailer 10.x also rejects CRLF in headers by default. |
| Open-relay abuse (unauthenticated caller floods SMTP) | Denial-of-Service | Auth-gate the POST — done via `authenticateJWT`. Combined with D-28 accepted-risk-no-rate-limit, this bounds abuse to logged-in users of a single-tenant deployment. |
| SMTP credential leak in error responses | Information Disclosure | Never surface nodemailer error messages in response body. `res.status(202).json({ok:true})` always on config-present path; `res.status(503).json({error:"feedback disabled"})` when disabled. Error details go only to `sshLogger.error`. |
| CSRF via cross-origin POST | Tampering | Skynet uses `authenticateJWT` from JWT cookie; existing `multipartOriginGuard` at `src/backend/utils/multipart-origin-guard.ts` guards CORS-simple content types. `application/json` payloads DO preflight, so the CORS layer handles it. **Verify:** since feedback POST body is JSON, browser sends preflight — the existing CORS config in `src/backend/utils/cors-config.ts` covers this. No new CSRF middleware needed. |
| Payload size DoS | Denial-of-Service | `express.json({limit: "512kb"})` inline on the POST route. Global bodyParser at L350 is `1gb` — DO NOT rely on that; add inline limit. |
| Bad-but-valid SMTP creds locking out feedback | Availability | D-27 makes this a non-issue for the user (toast fires regardless); D-07 keeps it from bricking boot. Send failure lands in structured log for operator visibility. |
| Content-inclusion flag misconfigured "on" leaks conversation content | Information Disclosure | D-02 explicit-opt-in-with-default-off. `getFeedbackConfig().includeContent` starts `false` unless env explicitly sets truthy value. **Test coverage MUST verify default-off**. |
| PII in submitter username exposed to third-party mail relay | Information Disclosure | Accepted risk — username IS the identifier for feedback attribution (D-24). Operators choose their own SMTP relay, so trust is scoped to relay choice. Document env var reference material recommending self-hosted or trusted SMTP relays. |

**Additional note:** since feedback disabling is signaled to the frontend and the frontend hides the UI (per shape file), a user CAN'T submit feedback if the feature is disabled — but the backend MUST still return 503 on POST when disabled, defense-in-depth against a stale client with the old signal cached.

## Sources

### Primary (HIGH confidence)
- `.planning/phases/123-user-feedback-campaign-shape-1-feedback-pipeline-backend-int/123-CONTEXT.md` — locked D-01 through D-31 decisions
- `.planning/shapes/shape-feedback-pipeline.md` — shape agreement (tiebreaker)
- `.planning/campaign-user-feedback.md` — parent campaign artifact
- `src/backend/branding/branding-config-loader.ts` — never-throws loader pattern
- `src/backend/branding/branding-routes.ts` — Express router mount + Cache-Control patterns
- `src/backend/branding/assert-boot.ts` — REFERENCE for what NOT to do (feedback diverges)
- `src/backend/starter.ts:398-405` — boot chain hook location
- `src/backend/database/database.ts:180-2100` — auth middleware setup + route mount conventions
- `src/backend/utils/auth-manager.ts:820-967` — `createAuthMiddleware()` populates `req.userId`
- `src/backend/utils/logger.ts:326` — `sshLogger` interface
- `src/backend/database/routes/relay-room-participants.ts:78-99` — drizzle `userId → username` lookup pattern
- `src/backend/database/routes/voice.ts:1-100` — authenticated POST route reference with multer + validation
- `src/backend/database/routes/c2s-tunnel-presets.ts` — clean auth-gated router example
- `src/ui/branding/branding-store.ts` — useSyncExternalStore singleton canonical example
- `src/ui/branding/branding-fetch.ts` — boot-time GET fetch canonical example
- `src/ui/features/pretty-view/AddWakeupDialog.tsx` — full input-heavy modal reference
- `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` — smaller two-button modal reference
- `src/ui/components/dialog.tsx` — shared DialogTitle primitive
- `src/ui/components/sonner.tsx` + `src/main.tsx:243` — Sonner Toaster mounted bottom-right already
- `src/ui/hooks/use-keyboard-toggle-pretty-mode.ts` — keyboard chord hook canonical example
- `src/ui/main-axios.ts` — `authApi` fetch wrapper
- `package.json` — dependency inventory
- npm registry: `npm view nodemailer version` → 10.0.10; `time.modified` → 2026-09-14; `repository.url` → github.com/nodemailer/nodemailer

### Secondary (MEDIUM confidence)
- nodemailer official docs at https://nodemailer.com/about/ — general SMTP pattern (transporter creation, sendMail signature). Well-established since 2010.

### Tertiary (LOW confidence)
- None — all recommendations trace back to existing codebase patterns or verified npm metadata.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every non-mailer piece is already in the codebase; nodemailer is unambiguously the correct Node SMTP library.
- Architecture: HIGH — mirrors branding-store/branding-fetch verbatim; matches existing route mount + auth patterns.
- Pitfalls: HIGH — pitfalls 1, 2, 5 are grounded in specific existing-code caveats (branding fail-fast divergence, nginx dual-file rule, bodyParser mount order). Pitfalls 3, 4, 6, 7, 8 are broadly applicable and well-known.
- Package legitimacy: MEDIUM — slopcheck unavailable, but nodemailer's industry standing is unambiguous. Planner adds a `checkpoint:human-verify` per protocol.

**Research date:** 2026-09-19
**Valid until:** 2026-10-19 (30 days — stable domain, mature libraries)
