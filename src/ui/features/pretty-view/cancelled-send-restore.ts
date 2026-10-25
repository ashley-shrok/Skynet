// shape-interrupt-button — giving a cancelled send back to the user.
//
// A cancelled prompt's transcript text is exactly what the harness received:
// the user's words, plus (for an attachment send) the locked
// "--- attached files ---" block naming where each file landed on the agent's
// machine. Restoring splits the two: the words go back into a compose box, and
// each file is fetched back from the machine and re-staged as an ordinary
// attachment on that same box, so resending produces the same message.

import { parseInjectedUserTurn } from "@/api/pretty-view-upload-protocol";
import { stampedFetch } from "@/lib/stamped-fetch";
import { stripVoiceLabel } from "./voice-label";
import { parseAnswerMessage, stripTrayNotices } from "./ask/answer-format";

export interface RestoreFile {
  filename: string;
  mimetype: string;
  landingPath: string;
}

export interface CancelledSendRestore {
  text: string;
  files: RestoreFile[];
}

export function buildCancelledSendRestore(content: string): CancelledSendRestore {
  // A voice-mode send carries a trailing "[sent by voice …]" label; the words
  // come back without it (a resend adds it again only if it is spoken).
  // Tray notices go (a resend adds them again if the question is still open);
  // a cancelled tray answer gives back only its note — the question returns
  // to the tray for answering again.
  const words = (t: string): string => {
    const plain = stripTrayNotices(stripVoiceLabel(t));
    return parseAnswerMessage(plain)?.note ?? plain;
  };
  const injected = parseInjectedUserTurn(content);
  if (!injected) return { text: words(content), files: [] };
  return {
    text: words(injected.caption),
    files: injected.files.map((f) => ({
      filename: f.filename,
      mimetype: f.mimetype,
      landingPath: f.landingPath,
    })),
  };
}

/** The agent-cited file URL path for a file on `hostName` (same route file chips use). */
export function hostFileUrl(hostName: string, absolutePath: string): string {
  const segments = absolutePath.split("/").filter((s) => s !== "").map(encodeURIComponent);
  return `/file/${encodeURIComponent(hostName)}/${segments.join("/")}`;
}

/**
 * Fetch each file back from the agent's machine as a browser File. Files that
 * can't be fetched are reported by name; the rest are returned for staging.
 */
export async function fetchRestoreFiles(
  hostName: string,
  files: RestoreFile[],
  fetchImpl: typeof stampedFetch = stampedFetch,
): Promise<{ files: File[]; failed: string[] }> {
  const jwt = (() => {
    try {
      return localStorage.getItem("jwt");
    } catch {
      return null;
    }
  })();
  const headers: Record<string, string> = {};
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  const out: File[] = [];
  const failed: string[] = [];
  for (const f of files) {
    try {
      const res = await fetchImpl(hostFileUrl(hostName, f.landingPath), {
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        failed.push(f.filename);
        continue;
      }
      const blob = await res.blob();
      out.push(new File([blob], f.filename, { type: f.mimetype || blob.type }));
    } catch {
      failed.push(f.filename);
    }
  }
  return { files: out, failed };
}
