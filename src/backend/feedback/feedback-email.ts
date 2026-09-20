/**
 * Phase 121 (feedback-email): pure composition of plaintext feedback emails.
 * Zero I/O — no logger, no fetch, no db. Safe to import anywhere.
 *
 * Two exports:
 *   - composeSubject({appName, type}) → subject line per D-16
 *     `[<appName> feedback] <type>` with CRLF stripped from appName
 *     (T-121-02 — SMTP header injection defense).
 *   - composeBody(args) → plaintext body per D-19
 *     header block (Feedback from / Instance / When / Type)
 *     + optional --- User note --- section (D-19)
 *     + optional --- Exchange --- section (D-19 + D-21 markdown verbatim)
 *
 * IMPORTANT: composeBody does NOT enforce D-22 (drop exchange when
 * includeContent=false) or D-23 (general emails never carry exchange).
 * Those rules live at the call site — the future feedback-routes.ts
 * (Plan 03) decides whether to pass `exchangeText` at all. This keeps
 * the pure function trivial and testable.
 *
 * D-15 lock: plaintext only. Nodemailer's rich-body field is never emitted;
 * no escaping is needed. All string interpolation is verbatim.
 *
 * D-20 lock: no URL scheme, no view-in-application affordance is
 * synthesized. Skynet has no message-linking URL scheme; do not invent one.
 */

// ---------------------------------------------------------------------------
// composeSubject
// ---------------------------------------------------------------------------

/**
 * Returns the subject line per D-16: `[<appName> feedback] <type>`.
 * appName is stripped of CR and LF characters before interpolation to
 * prevent SMTP header injection (T-121-02 / Pitfall 6). type is trusted —
 * caller controls it and it's always one of the three fixed strings
 * (`general` / `thumbs up` / `thumbs down`).
 */
export function composeSubject(args: {
  appName: string;
  type: string;
}): string {
  const safeAppName = args.appName.replace(/[\r\n]/g, "");
  return `[${safeAppName} feedback] ${args.type}`;
}

// ---------------------------------------------------------------------------
// composeBody
// ---------------------------------------------------------------------------

/**
 * Returns the plaintext body per D-19. Layout:
 *
 *   Feedback from: <submitter>
 *   Instance:      <appName>
 *   When:          <ISO-8601 UTC>
 *   Type:          <type>
 *
 *   --- User note ---           (only if userNote non-empty after trim)
 *   <userNote>
 *
 *   --- Exchange ---            (only if exchangeText supplied AND non-empty after trim)
 *   <exchangeText>
 *
 * Each section is separated by a blank line (\n\n) and the whole body ends
 * with a trailing newline. Sections are appended in fixed order:
 * user-note precedes exchange.
 *
 * Both userNote and exchangeText are inserted VERBATIM — no HTML escaping,
 * no markdown stripping, no truncation (D-21).
 */
export function composeBody(args: {
  submitter: string;
  appName: string;
  timestamp: number;
  type: string;
  userNote: string;
  exchangeText?: string;
}): string {
  const when = new Date(args.timestamp).toISOString();
  const header = [
    `Feedback from: ${args.submitter}`,
    `Instance:      ${args.appName}`,
    `When:          ${when}`,
    `Type:          ${args.type}`,
  ].join("\n");

  const parts: string[] = [header];

  if (args.userNote.trim() !== "") {
    parts.push("--- User note ---\n" + args.userNote);
  }

  if (args.exchangeText !== undefined && args.exchangeText.trim() !== "") {
    parts.push("--- Exchange ---\n" + args.exchangeText);
  }

  return parts.join("\n\n") + "\n";
}
