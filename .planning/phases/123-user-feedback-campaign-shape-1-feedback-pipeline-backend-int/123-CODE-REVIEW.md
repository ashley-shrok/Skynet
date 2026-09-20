# Phase 123 — Unbiased Code Review

**Reviewer:** Opus 4.7 (unbiased sub-agent, no prior session context)
**Scope:** All feedback-pipeline files shipped in Phase 123 (backend + frontend + infra)
**Branch:** feat/tab-title-from-tmux
**Method:** Read the shape agreement + all shipped files + one house-style analog per component. Findings cite file:line and each carries a concrete fix.

---

## Summary

| Severity | Count |
|---|---|
| HIGH  | 1 |
| MED   | 5 |
| LOW   | 5 |
| **Total** | **11** |

**Top 3 highest-severity items:**
1. HIGH — inline `express.json({limit:"512kb"})` on POST /feedback is a **no-op in production** because the global `bodyParser.json({limit:"1gb"})` at `src/backend/database/database.ts:355` parses the body first (T-122-11 body cap bypassed). — `src/backend/feedback/feedback-routes.ts:99`
2. MED — `feedback-routes.test.ts` Test 13 mounts the router on a fresh Express app with **no global bodyParser**, so the 700kb test passes but does NOT reproduce production wiring and therefore misses HIGH-1. — `src/backend/feedback/feedback-routes.test.ts:485`
3. MED — nodemailer transporter is created with **no connectionTimeout / socketTimeout / greetingTimeout**, so a hostile / hanging SMTP endpoint can hold sockets for up to nodemailer's built-in 10-minute socketTimeout default — no explicit fire-and-forget detach in the transport itself. — `src/backend/feedback/feedback-transport.ts:52-62`

---

## HIGH severity

### HIGH-1: Body-size cap is unenforced in production (T-122-11 mitigation broken)

**File:** `src/backend/feedback/feedback-routes.ts:99`
**Also affected:** `src/backend/feedback/feedback-routes.test.ts:485`

The POST /feedback route declares an inline `express.json({limit:"512kb"})` between `authenticateJWT` and the handler. However, in `src/backend/database/database.ts:355`, a **global** `bodyParser.json({limit:"1gb"})` is mounted for the entire app. This global parser runs before `feedbackRoutes` are mounted at line 2108. By the time the inline `express.json({limit:"512kb"})` fires, `req._body` is already set (body-parser marks the request as parsed to prevent re-parsing), so the inline call is a no-op and the effective request limit for POST /feedback is 1GB, not 512KB.

The route JSDoc at `feedback-routes.ts:21-25` explicitly names this as T-122-11 mitigation:
> `express.json({limit:"512kb"})` is applied inline on the POST route (T-122-11 — the global bodyParser at database.ts:350 allows 1gb which is too permissive for feedback).

The mitigation is broken because middleware order matters and the global runs first.

**Impact:** Any authenticated user can POST a 1GB body to /feedback. The full body is buffered into memory, then written verbatim into the pre-send sshLogger.info payload (feedback-routes.ts:210-212), potentially exhausting memory and log-forward bandwidth.

**Fix:** Either
(a) Move the size enforcement upstream — add a request-time check inside the handler:
```ts
const contentLength = Number(req.headers["content-length"] ?? "0");
if (Number.isFinite(contentLength) && contentLength > 512 * 1024) {
  return res.status(413).json({ error: "payload too large" });
}
```
(b) Reserve /feedback from the global bodyParser (mount the global parser on a router that excludes /feedback and apply the inline 512kb cap first).
(c) Add nginx-side `client_max_body_size 512k;` inside the `location = /feedback {` block in both `docker/nginx.conf:1206` and `docker/nginx-https.conf:1189` as defense-in-depth.

Recommended: (a) + (c). Fix Test 13 concurrently (see MED-1).

---

## MED severity

### MED-1: Test 13 doesn't exercise production wiring

**File:** `src/backend/feedback/feedback-routes.test.ts:485`

Test 13 asserts "700kb body → non-2xx". The test's `startServer` at line 208-216 mounts `feedbackRoutes` on a fresh Express app with **no global bodyParser**. So the inline 512kb parser is the ONLY parser, and 700kb correctly returns 413. In production, the global bodyParser.json({limit:"1gb"}) runs first and swallows the 700kb payload; the request would reach the handler with a fully-populated body and return 202 with the send fired.

**Fix:** Add a second variant of Test 13 that mounts `bodyParser.json({limit:"1gb"})` before `feedbackRoutes`:
```ts
app = express();
app.use(bodyParser.json({ limit: "1gb" })); // mirror database.ts:355
app.use(feedbackRoutes);
```
and asserts 413 (or the equivalent per the chosen HIGH-1 fix). This test would fail today and drive HIGH-1.

---

### MED-2: nodemailer transporter created with no explicit timeouts

**File:** `src/backend/feedback/feedback-transport.ts:52-62`

`nodemailer.createTransport({...})` omits `connectionTimeout`, `greetingTimeout`, `socketTimeout`. nodemailer's defaults are 2min / 30s / 10min respectively. Combined with the fire-and-forget contract in the route (`void sendFeedbackEmail(...)`), a hostile/hanging SMTP server holds file descriptors and pending promises for up to 10 minutes per submission. Under submission volume, this can exhaust socket handles or accumulate unresolved promises in Node's internal state.

The shape's "fire-and-forget must actually detach" callout in `what would make it wrong` implies the transport itself should not become a resource sink for the process.

**Fix:** Set explicit conservative timeouts on transporter creation:
```ts
transporter = nodemailer.createTransport({
  host: cfg.smtp.host,
  port: cfg.smtp.port,
  secure: cfg.smtp.port === 465,
  auth: cfg.smtp.user !== "" ? { user: cfg.smtp.user, pass: cfg.smtp.password } : undefined,
  connectionTimeout: 10_000,   // 10s — SMTP TCP handshake
  greetingTimeout: 10_000,     // 10s — SMTP banner
  socketTimeout: 30_000,       // 30s — total send window
});
```

---

### MED-3: `handleSend` comment describes behavior the code doesn't perform

**File:** `src/ui/feedback/FeedbackModal.tsx:187-209`

The comment reads:
> Send path: parent owns the actual POST. onSubmit runs FIRST, then we tell the parent to close. In the thumbs_down variant, Send should NOT fire onDismissWithoutSubmit — the Radix onOpenChange wrapper above would trigger it if we routed the close through Radix's Close primitive, so we call `onOpenChange(false)` directly here (bypassing the dismiss branch).

The actual button body only calls `void onSubmit(draft);` — it never calls `onOpenChange(false)`. Closing depends entirely on the parent's onSubmit handler calling `setFeedbackOpen(false)` (see `AppShell.tsx:4072`). The behavior works because of the `if (!open) return null` unmount at `FeedbackModal.tsx:103`, not because the button calls onOpenChange directly.

The mismatch will confuse future readers refactoring the modal — the comment implies a direct call site that doesn't exist.

**Fix:** Rewrite the comment to describe actual behavior:
```ts
// Send path: fires onSubmit(draft) only. The parent's onSubmit handler is
// responsible for calling setOpen(false) (or equivalent) to close the modal.
// Because the button does NOT route through Radix's onOpenChange, the
// dismiss-with-vote branch of our Root wrapper (which fires
// onDismissWithoutSubmit for thumbs_down) is never invoked on Send —
// exactly the disambiguation D-11 requires.
```

---

### MED-4: `textarea` has no accessible label

**File:** `src/ui/feedback/FeedbackModal.tsx:162-171`

The textarea has only a placeholder — no `aria-label`, no visible `<label>` element, and no `aria-labelledby` pointing to the DialogPrimitive.Title. Screen readers announce the placeholder in some browsers but this is inconsistent. Accessibility ambient standard for a Dialog input is either `aria-labelledby={titleId}` or a visible label.

**Fix:**
```tsx
<DialogPrimitive.Title id="feedback-modal-title" ...>
<textarea
  aria-labelledby="feedback-modal-title"
  aria-label={variant === "general" ? "Feedback message" : "What went wrong"}
  ...
/>
```

---

### MED-5: Pre-send log payload can carry hundreds of KB of user content

**File:** `src/backend/feedback/feedback-routes.ts:201-212`

The pre-send `sshLogger.info` payload includes `userNote` and `exchangeText` verbatim. These are user-controlled strings up to the request body cap (1GB today per HIGH-1, ideally 512KB). The logger's `TRUNCATE_FIELDS` at `src/backend/utils/logger.ts:66` only truncates fields named `data`, `content`, `body`, `response`, `request` — none match `userNote` or `exchangeText`. The full content is written to structured logs on every submission.

This is the intended audit trail per D-27 ("nothing a user typed is lost even in the failure path"), but the unbounded size can flood log-forwarders (fluentd / Loki / Elasticsearch) under abuse and drown other operational logs. Not an outright bug, but a maintenance risk.

**Fix (defense-in-depth):** Add explicit per-field truncation with an oversize flag, e.g. cap at 8 KB and include a `userNoteTruncated: true` marker when the full body exceeded the cap. The full body remains in the email; only the log truncates.
```ts
const CAP = 8 * 1024;
const truncatedNote = userNote.length > CAP ? userNote.slice(0, CAP) : userNote;
sshLogger.info("feedback-submit: attempting send", {
  operation: "feedback_submit",
  ...
  userNote: truncatedNote,
  userNoteTruncated: userNote.length > CAP,
  exchangeText: exchangeTextTruncated,
  exchangeTextTruncated: (exchangeText?.length ?? 0) > CAP,
});
```
Alternatively, add `userNote` and `exchangeText` to `TRUNCATE_FIELDS` in `logger.ts`. The house convention is a 100-char cap, which is probably too aggressive for an audit trail — 8-16 KB is a reasonable middle ground for feedback specifically.

---

## LOW severity

### LOW-1: No double-submit guard on Send button

**File:** `src/ui/feedback/FeedbackModal.tsx:184-219`

The Send button has no `disabled` state during send. Rapid double-click will fire two `void onSubmit(draft)` calls, and the parent's handler at `AppShell.tsx:4067` will issue two `void postFeedback(payload)` calls before the modal closes. Not a correctness bug for the fire-and-forget path, but produces duplicate emails.

**Fix:** Add a local `isSubmitting` state and disable the Send button while a submit is in flight:
```ts
const [isSubmitting, setIsSubmitting] = useState(false);
// on click:
if (isSubmitting) return;
setIsSubmitting(true);
try { await onSubmit(draft); } finally { /* modal will unmount */ }
```

---

### LOW-2: Toaster global duration deviates from shape's "~2 second fade"

**File:** `src/main.tsx:243`

The Toaster is mounted at bottom-right, but no `duration` prop is set — sonner's default is 4000ms. The shape (line 22) specifies "~2 second fade". A minor UX deviation but the shape called it out explicitly.

**Fix:** Either set `duration={2000}` at the global mount site (affects other toasts too, may be undesirable) or pass `{ duration: 2000 }` at the `toast.success` call sites in `AppShell.tsx:4071` and `4084`:
```ts
toast.success("Thanks — feedback sent.", { duration: 2000 });
```

---

### LOW-3: `messageRef` unbounded — potential log-injection surface

**File:** `src/backend/feedback/feedback-routes.ts:135-136,207`

`messageRef` is accepted as a client-supplied string with no length cap and no CRLF sanitization. It's then logged in the pre-send `sshLogger.info` payload. If a hostile authenticated user submits `messageRef: "x\nEMERGENCY: fake log entry"`, the console line can contain embedded newlines that confuse downstream log parsers. Structured JSON logging in most sinks escapes newlines, but the shipped logger's fallback text formatter (logger.ts:174-185) uses `String(v)` with no escaping.

**Fix:** Cap length + strip CRLF at the route boundary:
```ts
const messageRef = typeof body.messageRef === "string"
  ? body.messageRef.slice(0, 256).replace(/[\r\n]/g, "")
  : undefined;
```
Same defense applies to `userNote` and `exchangeText` if logged; those are already covered by the shape's "markdown source verbatim" lock in the email body, but log-side stripping is fine (the email carries the untouched text).

---

### LOW-4: `feedback-fetch` uses raw `fetch` with `credentials: "include"` instead of the app's `authApi`

**File:** `src/ui/feedback/feedback-fetch.ts:68-82`

The rest of the app uses `authApi` (from `main-axios.ts`) for authenticated requests, which handles cookie attachment and error classification uniformly. `feedback-fetch.ts` calls raw `fetch("/api/feedback/enabled", { credentials: "include" })` directly.

This matches `branding-fetch.ts`, which the docstring points to as the analog. But `branding-fetch` is DELIBERATELY unauthenticated (it's called pre-login from `main.tsx`), whereas `feedback-fetch` IS auth-gated and is called post-login from `AppShell`. Consistency argues for `authApi.get` instead.

**Fix (optional, style-only):** Migrate to `authApi.get("/api/feedback/enabled")`. Not a bug, just an inconsistency. If the code stays as-is, add a docstring note explaining why raw fetch is used here despite auth being required.

---

### LOW-5: Missing `id` for label association / testId on the Send/Cancel buttons

**File:** `src/ui/feedback/FeedbackModal.tsx:174-219`

The Send / Cancel buttons have no `data-testid`. Tests currently rely on `getByRole("button", { name: "Send" })`. If a future translation catalogue adds an i18n key for the button label, the tests break silently. Minor test-brittleness concern.

**Fix:** Add stable testids:
```tsx
<Button data-testid="feedback-send" ...>Send</Button>
<Button data-testid="feedback-cancel" ...>Cancel</Button>
```

---

## Categories where I found nothing

### Correctness bugs beyond the ones listed above
No off-by-one errors, no missing awaits, no obvious race conditions in the shipped code beyond MED-2's SMTP-hang case. The `applyFleetState` ordering discipline in AppShell (unrelated to this shape) is well-documented.

### Security beyond the ones listed above
- **SMTP header injection on subject line via appName** — mitigated at `feedback-email.ts:42` (CRLF strip). The subject `type` is server-composed from a fixed set of literals, safe.
- **XSS in email body** — email is text-only (D-15 lock enforced at `feedback-transport.ts:110`); no HTML consumer path exists.
- **Path traversal** — no filesystem operations in the feedback pipeline.
- **CSRF** — POST is JSON-only + JWT-authenticated; cookie-carrying same-origin POST from third parties requires the JSON body to be crafted, and the JWT check gates the mutation. The GET /api/feedback/enabled is idempotent + auth-gated, no CSRF surface.
- **Reply-To with user email** — deliberately NOT added; sendMail at `feedback-transport.ts:103-111` sets only from/to/subject/text. Shape lock honored.
- **DB persistence of feedback** — none. Shape lock honored.
- **Rate-limit middleware** — none (accepted risk per shape).
- **Password in logs** — omitted from `feedback-config.ts:174-183` log payload; logger.ts SENSITIVE_FIELDS masking would catch it as a belt if it slipped through.
- **T-123-04 hostile env** — `safeEnv` at `feedback-config.ts:79-86` + the outer try/catch at 108-196 provide two layers of never-throws protection. Test at `feedback-config.test.ts:308-345` proves it against a hostile Proxy.

### Edge cases beyond the ones listed above
- Unicode / trailing whitespace in env — HOST/PORT/FROM/TO are `.trim()`-ed; PASSWORD is preserved verbatim per Pitfall 4. Tests cover this.
- Anonymous relay (USER+PASSWORD both empty) — supported per D-04 pairing rule at `feedback-config.ts:146-153`. Tested at `feedback-config.test.ts:105-118`.
- userId doesn't resolve to a users row — falls back to `"unknown"` at `feedback-routes.ts:145-159`. Tested at Test 14.
- Backend disabled between browser cache and next request — 503 at `feedback-routes.ts:106-108`. Tested at Test 5.
- Missing `kind` / invalid `kind` — 400 at `feedback-routes.ts:126-132`. Tested at Tests 6 + 7.
- Empty vs whitespace vs 100KB userNote — `composeBody` treats whitespace-only as empty at `feedback-email.ts:89` (`.trim() !== ""`). Tested at `feedback-email.test.ts:121-124`.

### Fleet-rule compliance
- No transporter.verify() at boot (D-07 anti-pattern) — confirmed absent, comment lock at `feedback-transport.ts:60`.
- No HTML email fields (D-15) — confirmed; sendMail carries only `text`.
- No Reply-To header — confirmed absent.
- No DB persistence — confirmed no drizzle table added.
- No rate-limit middleware — confirmed absent (out of scope).
- Body-size cap present in code (T-122-11) — but broken in production per HIGH-1.
- Streaming affordances — none. No SSE, no chunked, no WebSocket for feedback surface.
- Executor-prohibited commands — none introduced.

### Test quality
- Config tests exercise the never-throws contract including hostile Proxy (T-123-04) — strong.
- Email tests include the full 6-permutation matrix + byte-exact snapshot — strong.
- Route tests cover all 15 behavior bullets and include a fire-and-forget timing assertion — strong overall, but Test 13 has the setup gap called out in MED-1.
- Frontend tests exercise both variants + the D-30 draft-reset-on-reopen invariant + D-11 no-message-quote — strong.
- Overall: 109 tests across 7 files, matching what the close-out claims. The invariants named by the shape are exercised, not just incidental implementation details.

---

## Overall verdict

Well-executed shape with tight discipline around the locks (D-15, D-22, D-23, D-27, D-30, D-31, T-123-01/03/04). The pipeline structure — pure composition + fire-and-forget transport + never-raises config + server-side content gate — is defensible.

**One HIGH must be addressed before deploy:** the T-122-11 body-cap is silently bypassed by the global bodyParser. The mitigation code is present but ineffective, and its accompanying test doesn't reproduce production wiring.

The five MED and five LOW findings can land as follow-ups; none block ship as long as the operator understands the effective request cap is 1GB, not 512KB, until HIGH-1 is fixed.

---

## Follow-Up Fix Pass — 2026-09-19

Applied 9 of 11 findings (LOW-4 deferred as stylistic-only).

| Finding | Fix commit | Verification |
|---|---|---|
| HIGH-1 + MED-1 | a50c08d2 | Test 13b production-wiring variant asserts 413 payload too large; nginx client_max_body_size 512k added to both configs |
| MED-2 | 98f4b5d5 | build:backend clean; explicit 10s/10s/30s socket timeouts on nodemailer transporter |
| MED-3 | 0203a872 | comment rewritten to match actual behavior (Send fires onSubmit only; parent owns close) |
| MED-4 | c264c250 | textarea aria-labelledby wired to feedback-modal-title Title id; test asserts wiring |
| MED-5 | 935f3821 | Test 16 asserts log truncation at 8KB and userNoteTruncated flag; email body carries full text |
| LOW-1 | 6cc107d3 | Test asserts onSubmit called exactly once on rapid double-click |
| LOW-2 | 107265a0 | toast.success duration:2000 set at both call sites (Send + dismiss-with-vote) |
| LOW-3 | 60fde775 | Test 17 asserts messageRef bounded at 256 chars and CRLF stripped; log-string CRLF normalized |
| LOW-5 | 134dace7 | data-testid=feedback-send/feedback-cancel/feedback-close on buttons; tests assert each testid |

LOW-4 (feedback-fetch → authApi migration) deferred as stylistic-only.

**Verification snapshot:**
- Full feedback-scope test surface: 134 tests across 8 files, all passing.
- `npm run build:backend` clean.
- `npm run build` clean.
