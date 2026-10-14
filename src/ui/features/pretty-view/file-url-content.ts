import { useEffect, useState } from "react";
import { fetchHostFileUrl, fetchTailnetUrl } from "@/api/editable-file-api";
import type { TabState } from "./IdentityFileTab";
import type { FileViewData } from "./file-viewers/FileView";
import { base64ToBytes, decodeUtf8, looksLikeText } from "./file-viewers/text-sniff";
import { isSkynetFileUrl } from "./file-url";

/**
 * Reading a chat-shared file URL for display — shared by the file modal and
 * the file pane: the content fetch, the existence probe for URL-sourced
 * views, and the human copy for each backend error class.
 */

/**
 * Fresh non-global regex deciding which fetch helper a URL takes. MUST be
 * non-global — .test() on a /g regex mutates .lastIndex and returns
 * alternating true/false.
 */
export const FILE_URL_DISPATCH_RE = /^https:\/\/[^/]+\/file\//;

/** True for a Skynet file URL (any https Skynet, or this origin's). */
function isHostFileUrl(url: string): boolean {
  return FILE_URL_DISPATCH_RE.test(url) || isSkynetFileUrl(url);
}

/** Host segment of a Skynet file URL, for the permission-denied copy. */
const FILE_URL_HOSTNAME_RE = /^https?:\/\/[^/]+\/file\/([a-zA-Z0-9._-]+)\//;

/**
 * Monotonic mtime sentinel. Two sub-millisecond reads would collide on
 * Date.now(); FileView's mtime-keyed draft reseed would then keep the first
 * read's draft. A counter guarantees a distinct sentinel per read.
 */
let mtimeCounter = 0;

export type FileErrorCopy = { heading: string; body: string };

/**
 * Backend error class → human copy. Keys are the classes emitted by the
 * fetch-host-file routes. NEVER include HTTP status codes or stack traces.
 * `permission_denied` is special-cased in describeFileUrlError because its
 * body weaves in the host name from the URL. Unmapped classes fall back to
 * "generic".
 */
export const FILE_URL_ERROR_COPY: Record<string, FileErrorCopy> = {
  host_unreachable: {
    heading: "Host unreachable",
    body: "The box may be offline or the SSH channel is down. Try again in a moment.",
  },
  not_found: {
    heading: "File not found",
    body: "No such file at that path. Check the URL or ask the agent to re-send.",
  },
  too_large: {
    heading: "File too large",
    body: "The 2 MB cap keeps the editor responsive. Ask for a smaller slice of the file.",
  },
  not_a_file: {
    heading: "Not a regular file",
    body: "Directories, sockets, and device files aren't viewable via file URLs.",
  },
  path_forbidden: {
    heading: "Path forbidden",
    body: "/proc, /sys, and /dev are not accessible via file URLs.",
  },
  path_traversal: {
    heading: "Invalid path",
    body: ". and .. segments aren't allowed in file URLs.",
  },
  path_must_be_absolute: {
    heading: "Invalid path",
    body: "The path in a file URL must be absolute (start with /).",
  },
  unknown_host: {
    heading: "Unknown host",
    body: "That host is not registered on this server, or you don't have access to it.",
  },
  ssh_timeout: {
    heading: "SSH timeout",
    body: "The host is slow or unreachable. Try again in a moment.",
  },
  invalid_hostname: {
    heading: "Invalid hostname",
    body: "The hostname in the URL contains unsupported characters.",
  },
  invalid_body: {
    heading: "Invalid request",
    body: "Something went wrong preparing the request. Refresh and try again.",
  },
  generic: {
    heading: "Can't fetch the file",
    body: "Something went wrong fetching the file. Try again, or check the URL.",
  },
};

/** Human copy for a failed read of `url` (`errorClass` = backend class). */
export function describeFileUrlError(errorClass: string, url: string): FileErrorCopy {
  if (!isHostFileUrl(url)) {
    return {
      heading: "Can't fetch the current file.",
      body: "The agent's temporary server may have shut down (they auto-kill after 30 minutes) or the network is unreachable. Ask the agent to re-share the file if you still want to edit it.",
    };
  }
  if (errorClass === "permission_denied") {
    const hostMatch = url.match(FILE_URL_HOSTNAME_RE);
    const host = hostMatch ? hostMatch[1] : "the host";
    return {
      heading: "Permission denied",
      body: `The server's SSH user can't read this file on ${host}. Ask the box owner to widen access.`,
    };
  }
  return FILE_URL_ERROR_COPY[errorClass] ?? FILE_URL_ERROR_COPY.generic;
}

/**
 * Read the file behind `url` while `enabled`. Re-reads whenever `url`,
 * `enabled` or `reloadToken` change; reports "loading" while disabled.
 * The error state carries the backend's error class.
 */
export function useFileUrlContent({
  url,
  enabled,
  reloadToken = 0,
}: {
  url: string;
  enabled: boolean;
  reloadToken?: number;
}): TabState<FileViewData> {
  const [state, setState] = useState<TabState<FileViewData>>({ status: "loading" });

  useEffect(() => {
    if (!enabled) {
      setState({ status: "loading" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const read = isHostFileUrl(url) ? fetchHostFileUrl(url) : fetchTailnetUrl(url);
    read
      .then((result) => {
        if (cancelled) return;
        // Text-ness: the extension, else the server's byte sniff (only sent
        // when the extension missed), else the same sniff client-side.
        const bytes = base64ToBytes(result.contentBase64);
        const isText = result.isTextByExt || (result.isTextByBytes ?? looksLikeText(bytes));
        setState({
          status: "ready",
          data: {
            content: isText ? decodeUtf8(bytes) : "",
            mtime: ++mtimeCounter,
            isText,
            bytes,
          },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : "unknown fetch error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled, reloadToken]);

  return state;
}

/**
 * Check that a Skynet file URL still serves, without downloading it (one
 * byte). Resolves null when it does, else the backend's error class
 * ("generic" when the failure carries none). For views that load straight
 * from the URL (images, PDFs, …) and so never see the read's error.
 */
export async function probeFileUrl(url: string, signal?: AbortSignal): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "same-origin",
      headers: { Range: "bytes=0-0" },
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    return "host_unreachable";
  }
  if (res.ok) {
    void res.body?.cancel().catch(() => {});
    return null;
  }
  // An empty file can't satisfy a byte range — it still exists.
  if (res.status === 416) return null;
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* fall through to status-only classing */
  }
  const cls = /^([a-z_]+):/.exec(text)?.[1];
  if (cls) return cls;
  if (res.status === 404) return "not_found";
  if (res.status === 403) return "permission_denied";
  if (res.status === 413) return "too_large";
  if (res.status === 504) return "ssh_timeout";
  return "generic";
}
