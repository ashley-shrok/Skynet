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

import { useEffect, useRef, useState } from "react";
import { fetchTailnetUrl } from "@/api/editable-file-api";
import {
  classifyByExtension,
  TAILNET_URL_RE_CLIENT,
} from "./editable-file-whitelist";

export function useEditableFileEligibility(
  messageEventId: string | null,
  messageBody: string,
): Set<string> {
  const [eligibleUrls, setEligibleUrls] = useState<Set<string>>(new Set());
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    if (messageEventId === null) {
      return () => {
        cancelledRef.current = true;
      };
    }

    // TAILNET_URL_RE_CLIENT is /g — .match() is stateless (unlike .exec loops
    // which require .lastIndex reset). Empty-match short-circuits below.
    const matches = messageBody.match(TAILNET_URL_RE_CLIENT) ?? [];
    if (matches.length === 0) {
      return () => {
        cancelledRef.current = true;
      };
    }

    (async () => {
      const eligible = new Set<string>();

      for (const url of matches) {
        try {
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
            eligible.add(url);
            continue;
          }

          // Async path: byte-sniff via backend proxy.
          const result = await fetchTailnetUrl(url);
          if (cancelledRef.current) return;
          if (result.isTextByBytes === true) {
            eligible.add(url);
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

      if (!cancelledRef.current) {
        // Single setState — do not commit per-URL, to avoid render thrash.
        setEligibleUrls(eligible);
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [messageEventId, messageBody]);

  return eligibleUrls;
}
