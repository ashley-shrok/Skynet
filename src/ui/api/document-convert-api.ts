import { isAxiosError } from "axios";
import { authApi } from "@/main-axios";

/**
 * Document conversion through the LibreOffice sidecar (backend route
 * /document-convert). The file viewers use it to open legacy Office and
 * OpenDocument files in the Word editor, Excel viewer or PDF viewer.
 */

export type ConvertTarget = "docx" | "doc" | "odt" | "xlsx" | "pdf";

/** Why a conversion didn't happen, as the viewers explain it. */
export type ConvertFailure = "unavailable" | "busy" | "too_large" | "failed";

export class DocumentConvertError extends Error {
  constructor(readonly reason: ConvertFailure) {
    super(
      {
        unavailable: "The document converter isn't running on this Skynet server.",
        busy: "The document converter is busy. Try again in a moment.",
        too_large: "This file is too large to convert (over 50 MB).",
        failed: "This file couldn't be converted.",
      }[reason],
    );
    this.name = "DocumentConvertError";
  }
}

let availability: Promise<boolean> | null = null;

/**
 * Whether the server has a working converter. Asked once per page load
 * (a failed check is retried next time), so chips and viewers can skip
 * downloading a file they can't show.
 */
export function converterAvailable(): Promise<boolean> {
  availability ??= authApi
    .get<{ available?: boolean }>("/document-convert/status")
    .then((res) => res.data?.available === true)
    .catch(() => false)
    .then((ok) => {
      if (!ok) availability = null;
      return ok;
    });
  return availability;
}

/** Test hook: forget the cached availability answer. */
export function resetConverterAvailability(): void {
  availability = null;
}

export async function convertDocument(
  bytes: Uint8Array | ArrayBuffer,
  from: string,
  to: ConvertTarget,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  try {
    const res = await authApi.post<ArrayBuffer>("/document-convert", bytes, {
      params: { from, to },
      headers: { "Content-Type": "application/octet-stream" },
      responseType: "arraybuffer",
      timeout: 120_000,
      signal,
    });
    return new Uint8Array(res.data);
  } catch (err) {
    if (isAxiosError(err) && err.response) {
      const status = err.response.status;
      if (status === 503) {
        // "converter_busy" vs "converter_unavailable"; the body is an
        // ArrayBuffer because of responseType.
        const text = err.response.data instanceof ArrayBuffer ? new TextDecoder().decode(err.response.data) : "";
        throw new DocumentConvertError(text.includes("busy") ? "busy" : "unavailable");
      }
      if (status === 413) throw new DocumentConvertError("too_large");
      if (status === 422) throw new DocumentConvertError("failed");
    }
    if (isAxiosError(err) && err.code === "ERR_CANCELED") throw err;
    throw new DocumentConvertError(isAxiosError(err) && !err.response ? "unavailable" : "failed");
  }
}
