import { authApi, handleApiError } from "@/main-axios";
import { stampedFetch } from "@/lib/stamped-fetch";

export const SAMPLE_PHRASE = "Hi, this is your voice.";

/**
 * `voices` are candidates in preference order (see voice-candidates.ts); the
 * server speaks in the first one the active TTS provider offers, else its
 * default. Omit or pass [] for the provider default.
 */
export async function postSpeak(text: string, voices?: readonly string[]): Promise<Blob> {
  try {
    const body: { text: string; voices?: readonly string[] } = { text };
    if (voices && voices.length > 0) body.voices = voices;
    // 300s timeout override — TTS synthesis of long text (up to SPEAK_TEXT_MAX =
    // 25000 chars) can exceed authApi's 30s default (main-axios.ts) and surface
    // as an ECONNABORTED that dbHealthMonitor.isBackendUnreachable mis-categorises
    // as "backend unreachable", firing database-connection-degraded → AppShell toast.
    const response = await authApi.post("/voice/speak", body, {
      responseType: "blob",
      timeout: 300_000,
    });
    return response.data as Blob;
  } catch (error) {
    handleApiError(error, "speak message");
  }
}

/**
 * Streaming variant of postSpeak (patch #237 / Phase 19).
 *
 * Returns the raw Response with an unread body — caller drives
 * response.body.getReader() for Web Audio API progressive decode.
 *
 * JWT is attached manually because fetch() is not routed through
 * main-axios.ts's request interceptor.
 *
 * Does NOT throw on non-2xx — caller inspects response.ok / response.status
 * and surfaces errors via toast.
 */
export async function postSpeakStream(
  text: string,
  voices?: readonly string[],
): Promise<Response> {
  const body: { text: string; voices?: readonly string[] } = { text };
  if (voices && voices.length > 0) body.voices = voices;

  const jwt = localStorage.getItem("jwt");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;

  // Phase 111 SKEW-04: stamped-fetch lane. stampedFetch preserves the
  // Authorization header we set above AND adds X-Skynet-Client-Build.
  // Streaming semantics preserved — response.body remains a ReadableStream.
  return stampedFetch("/voice/speak-stream", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}


/** One voice the active TTS provider offers. */
export interface VoiceOption {
  /** Saved in identity/role frontmatter and sent back when speaking. */
  id: string;
  name: string;
  description?: string;
}

export interface VoiceCatalog {
  voices: VoiceOption[];
  /** Voice used when nothing saved is available on the active provider. */
  defaultVoice: string;
  /**
   * Names for every voice id the server can label (all providers' fixed lists
   * + the active list) — lets a voice saved under another provider show by name.
   */
  labels?: Record<string, string>;
  /** True when the provider's list couldn't be fetched (voices is then empty). */
  listError: boolean;
}

/** GET /voice/voices — the active TTS provider's voice list. Throws on non-2xx. */
export async function fetchVoiceCatalog(): Promise<VoiceCatalog> {
  try {
    const response = await authApi.get("/voice/voices");
    return response.data as VoiceCatalog;
  } catch (error) {
    handleApiError(error, "load voices");
  }
}
