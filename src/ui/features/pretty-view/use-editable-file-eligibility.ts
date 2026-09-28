/**
 * useEditableFileEligibility — widget-URL classification for message bodies.
 *
 * History: originally (Phase 40) classified file URLs too, using an
 * extension whitelist + async byte-sniff to decide which URLs earned a
 * pencil-edit affordance. Under the shape at
 * `.planning/campaigns/more-file-editors/shape-native-viewers-in-modal.md`
 * (2026-09-28), file URLs are handled synchronously inside ChatMessage's
 * a-override (chip renders based on URL shape alone — no eligibility
 * gate), so this hook now only classifies widget URLs. Widget URLs are
 * a pure regex match, so the async byte-sniff loop is gone entirely.
 *
 * Return type stays `Map<string, "file" | "interactive-message">` for
 * back-compat with existing callers (ChatMessage reads only the
 * "interactive-message" side of the map); the "file" value is never
 * emitted in the current shape.
 */

import { useEffect, useState } from "react";
import {
  stripTrailingPunct,
  INTERACTIVE_MSG_URL_RE_CLIENT,
} from "./editable-file-whitelist";

export function useEditableFileEligibility(
  messageEventId: string | null,
  messageBody: string,
): Map<string, "file" | "interactive-message"> {
  const [eligibleUrls, setEligibleUrls] = useState<Map<string, "file" | "interactive-message">>(new Map());

  useEffect(() => {
    if (messageEventId === null) return;

    // INTERACTIVE_MSG_URL_RE_CLIENT is /g — .match() is stateless.
    // stripTrailingPunct normalizes prose-end URLs so `see .../poll/.`
    // lands as `.../poll/` in the map, matching what GFM autolink strips
    // into the anchor href for comparison.
    const raw = messageBody.match(INTERACTIVE_MSG_URL_RE_CLIENT) ?? [];
    const urls = Array.from(new Set(raw.map((u) => stripTrailingPunct(u))));

    // Build a fresh map; commit only if contents differ from the current
    // state so the memoized `a` override in ChatMessage keeps a stable
    // reference and avoids remount thrash.
    const next = new Map<string, "file" | "interactive-message">();
    for (const url of urls) {
      next.set(url, "interactive-message");
    }
    setEligibleUrls((prev) => {
      if (
        prev.size === next.size &&
        [...prev.entries()].every(([k, v]) => next.get(k) === v)
      ) {
        return prev;
      }
      return next;
    });
  }, [messageEventId, messageBody]);

  return eligibleUrls;
}
