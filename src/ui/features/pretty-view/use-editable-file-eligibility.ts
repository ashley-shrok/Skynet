/**
 * Phase 40 Plan 40-02 — useEditableFileEligibility
 *
 * D-01 (frontend URL detection, no agent-side change): scans the rendered
 * message body for tailnet HTTP URLs matching the id-skill's `python3 -m
 * http.server + tailnet-IP-bind` pattern.
 *
 * D-02 (extension whitelist first, byte-sniff fallback):
 *   1. Sync path: if the URL's filename hits classifyByExtension → add without
 *      fetching. This is the fast case; message-arrival-time UI stays snappy.
 *   2. Async path: for extension-miss URLs, POST /pretty-view/fetch-tailnet-url
 *      via fetchTailnetUrl and consult `isTextByBytes` on the response.
 *
 * D-04 (visible failure over silent maybe-stale; DISCARD-BYTES rule):
 *   - This hook's ONLY purpose is to answer "yes/no editable" per URL.
 *   - The returned Set<string> is the ONLY thing this hook exposes.
 *   - The byte payload returned by fetchTailnetUrl is consumed for the
 *     isTextByBytes read and then DISCARDED when the async closure resolves.
 *     No ref, no Map, no cache — bytes are unreachable to any caller.
 *   - The editor open path (EditableFileModal, Plan 40-03) fires its OWN fresh
 *     fetch and surfaces errors explicitly. It never sees these cached bytes.
 *
 * If future observation shows the naive per-message loop is too chatty (e.g.
 * repeated polls of the same URL during message-streaming re-renders), the
 * follow-up is a module-scope `Map<url, Promise<result>>` de-dupe cache — but
 * per Research §Open Q 5 that is MEDIUM confidence and deferred until measured.
 */

import { useEffect, useState } from "react";
import {
  fetchTailnetUrl,
  fetchHostFileUrl,
} from "@/api/editable-file-api";
import {
  classifyByExtension,
  stripTrailingPunct,
  TAILNET_URL_RE_CLIENT,
  SKYNET_FILE_URL_RE_CLIENT,
  INTERACTIVE_MSG_URL_RE_CLIENT,
} from "./editable-file-whitelist";

/**
 * Phase 75 D-01 dispatch guard: fresh non-global regex. MUST be
 * non-global (no /g flag) so `.test()` does not mutate `.lastIndex` —
 * see RESEARCH § Common Pitfalls Pitfall 6 (`/g + .test() = intermittent
 * stale results`) and the docblock warning on SKYNET_FILE_URL_RE_CLIENT.
 * Using this here instead of SKYNET_FILE_URL_RE_CLIENT.test(url).
 */
const FILE_URL_DISPATCH_RE = /^https:\/\/[^/]+\/file\//;

/**
 * Phase 137 D-137 dispatch guard: fresh non-global regex for widget-URL
 * detection. Same rationale as FILE_URL_DISPATCH_RE — MUST be non-global
 * (no /g flag) so `.test()` does not mutate `.lastIndex`. Using this here
 * instead of INTERACTIVE_MSG_URL_RE_CLIENT.test(url) (which would silently
 * return alternating true/false due to the /g flag).
 *
 * This guard fires BEFORE the async fetch loop (RESEARCH Pitfall 2): widget
 * URLs are same-origin HTTPS paths classified purely by shape — no backend
 * fetch needed. The `continue` skips the entire async path for widget URLs.
 */
const INTERACTIVE_MSG_DISPATCH_RE = /^https:\/\/[^/]+\/interactive\//;

export function useEditableFileEligibility(
  messageEventId: string | null,
  messageBody: string,
): Map<string, "file" | "interactive-message"> {
  const [eligibleUrls, setEligibleUrls] = useState<Map<string, "file" | "interactive-message">>(new Map());

  useEffect(() => {
    // Closure-local cancellation (rev-3 2026-08-14 code-review H3). The
    // previous `useRef(false)` pattern reset the ref at the top of every
    // effect run, which created a stale-write race under rapid re-render
    // (React 18 strict mode, messageBody churn): a cleanup would set
    // cancelledRef=true, then the next effect immediately reset it to false,
    // and an in-flight fetch from the FIRST effect could then resolve and
    // still see cancelled=false, letting stale data overwrite fresh data.
    // Closure-scoped `let cancelled = false` is per-effect-run and cannot be
    // touched by a later effect — matches the pattern EditableFileModal
    // already uses.
    let cancelled = false;

    if (messageEventId === null) {
      return () => {
        cancelled = true;
      };
    }

    // TAILNET_URL_RE_CLIENT is /g — .match() is stateless (unlike .exec loops
    // which require .lastIndex reset). Empty-match short-circuits below.
    // Phase 75 D-01: scan for BOTH tailnet URLs and Skynet file URLs, then
    // merge + dedupe via Set so the byte-sniff loop sees each URL once
    // regardless of which regex extracted it. Both regexes are /g and both
    // use .match() (stateless).
    // Normalize each match via stripTrailingPunct (rev-3 H2) so prose-end
    // URLs like `see http://.../notes.md.` land as `notes.md` in the Set,
    // matching what GFM autolink strips into the anchor href for comparison.
    // Dedupe with a Set (rev-3 M8) so a message quoting the same URL twice
    // doesn't fire two duplicate proxy fetches.
    const rawTailnet = messageBody.match(TAILNET_URL_RE_CLIENT) ?? [];
    const rawFileUrl = messageBody.match(SKYNET_FILE_URL_RE_CLIENT) ?? [];
    // Phase 137 D-137: also scan for interactive-message widget URLs.
    // INTERACTIVE_MSG_URL_RE_CLIENT is /g — .match() is stateless.
    const rawInteractive = messageBody.match(INTERACTIVE_MSG_URL_RE_CLIENT) ?? [];
    const matches = Array.from(
      new Set(
        [...rawTailnet, ...rawFileUrl, ...rawInteractive].map((u) => stripTrailingPunct(u)),
      ),
    );
    if (matches.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      const eligible = new Map<string, "file" | "interactive-message">();

      for (const url of matches) {
        try {
          // Phase 137 sync short-circuit (RESEARCH Pitfall 2): widget URLs
          // classify by shape alone — same-origin HTTPS, no backend fetch needed.
          // MUST fire before the extension check and BEFORE the async fetch path.
          if (INTERACTIVE_MSG_DISPATCH_RE.test(url)) {
            eligible.set(url, "interactive-message");
            continue;
          }

          const parsed = new URL(url);
          // Pitfall 8: use URL.pathname (drops ?query) then decode %-escapes.
          const filename = decodeURIComponent(
            parsed.pathname.split("/").pop() ?? "",
          );
          const extension = filename.includes(".")
            ? filename.split(".").pop()!.toLowerCase()
            : null;

          // Sync path: extension/basename hit — no fetch fires.
          if (classifyByExtension(extension, filename)) {
            eligible.set(url, "file");
            continue;
          }

          // Async path: byte-sniff via backend proxy. Phase 75 D-01
          // dispatch by URL shape — file URLs go to the SFTP-backed
          // /pretty-view/fetch-host-file endpoint, tailnet URLs to the
          // existing /pretty-view/fetch-tailnet-url. Both helpers return
          // TailnetFetchResult so the isTextByBytes check below is
          // uniform. Dispatch uses a fresh non-global regex per RESEARCH
          // Pitfall 6 (never .test() on a /g regex — mutates lastIndex).
          const isFileUrl = FILE_URL_DISPATCH_RE.test(url);
          const result = isFileUrl
            ? await fetchHostFileUrl(url)
            : await fetchTailnetUrl(url);
          if (cancelled) return;
          // Belt-and-suspenders (rev-3 M9): accept isTextByExt too, in case
          // the frontend and backend whitelists have drifted. Both flags being
          // true is the normal case; either one alone is enough to grant.
          if (result.isTextByBytes === true || result.isTextByExt === true) {
            eligible.set(url, "file");
          }
          // NOTE: the response's byte payload is intentionally UNREAD here.
          // Per D-04 "bytes fetched for eligibility MUST NEVER be served to
          // the editor path" — the editor open path (Plan 40-03) fires its
          // own fresh fetch and surfaces the error explicitly per D-04's
          // "visible failure over silent maybe-stale". When this closure
          // returns, `result` (and its base64 payload) become GC-eligible.
        } catch {
          // Silent skip: eligibility failure does not surface to the user.
          // The editor open path (EditableFileModal, Plan 40-03) fires its own
          // fresh fetch and surfaces the error explicitly per D-04 "visible
          // failure over silent maybe-stale". Other URLs in the same message
          // continue to be classified independently.
        }
      }

      if (!cancelled) {
        // Single setState — do not commit per-URL, to avoid render thrash.
        // Identity-stable when contents unchanged (BUG C2 fix) — stops
        // downstream remount storm in ChatMessage's memoized `a` override.
        // Phase 137: Map contents-equality — both size and per-key value equality.
        // Map order is not part of contents equality; size-check + per-entry value
        // check is a complete equality check for Map<string, "file" | "interactive-message">.
        setEligibleUrls((prev) => {
          if (
            prev.size === eligible.size &&
            [...prev.entries()].every(([k, v]) => eligible.get(k) === v)
          ) {
            return prev;  // identity-stable; React skips re-render
          }
          return eligible;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [messageEventId, messageBody]);

  return eligibleUrls;
}
