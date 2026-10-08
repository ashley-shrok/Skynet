import { useEffect, useState } from "react";
import { fetchVoiceCatalog, type VoiceCatalog } from "@/api/voice-api";

/**
 * The active TTS provider's voice list, shared by every voice picker.
 *
 * One module-level copy: pickers opened within CLIENT_TTL_MS of each other
 * reuse it, and concurrent mounts share one request. A failed load is not
 * kept, so the next picker open retries. The server keeps its own few-minute
 * cache of the provider's list, so refetching here is cheap.
 */
const CLIENT_TTL_MS = 60_000;

let cached: { catalog: VoiceCatalog; at: number } | null = null;
let inflight: Promise<VoiceCatalog> | null = null;

function loadCatalog(): Promise<VoiceCatalog> {
  if (cached && Date.now() - cached.at < CLIENT_TTL_MS) return Promise.resolve(cached.catalog);
  if (inflight) return inflight;
  inflight = fetchVoiceCatalog()
    .then((catalog) => {
      if (!catalog.listError) cached = { catalog, at: Date.now() };
      console.info(
        `[voice-picker] catalog-loaded count=${catalog.voices.length} listError=${catalog.listError} defaultVoice="${catalog.defaultVoice}"`,
      );
      return catalog;
    })
    .catch((err: unknown) => {
      console.error(
        `[voice-picker] catalog-failed errMessage="${err instanceof Error ? err.message : String(err)}"`,
      );
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Display name for one saved voice id (see voiceLabel). */
export function useVoiceLabel(id: string): string {
  return voiceLabel(useVoiceCatalog(), id);
}

/** Test hook: forget the shared copy. */
export function resetVoiceCatalogCache(): void {
  cached = null;
  inflight = null;
}

/** Shown for a saved voice the server can't name (e.g. saved under another provider's account). */
export const UNNAMED_VOICE_LABEL = "Saved voice";

/**
 * Display name for a saved voice id. Never the raw id unless the server
 * named it so: an ElevenLabs code is shown as its name, or as
 * UNNAMED_VOICE_LABEL when the server can't name it right now.
 */
export function voiceLabel(state: VoiceCatalogState, id: string): string {
  if (state.status === "ready" || state.status === "error") {
    const catalog = state.catalog;
    const listed = catalog?.voices.find((v) => v.id === id);
    if (listed) return listed.name;
    const labeled = catalog?.labels?.[id];
    if (labeled) return labeled;
    return UNNAMED_VOICE_LABEL;
  }
  return "…";
}

export type VoiceCatalogState =
  | { status: "loading" }
  | { status: "ready"; catalog: VoiceCatalog }
  | { status: "error"; catalog?: VoiceCatalog };

export function useVoiceCatalog(): VoiceCatalogState {
  const [state, setState] = useState<VoiceCatalogState>(() =>
    cached && Date.now() - cached.at < CLIENT_TTL_MS
      ? { status: "ready", catalog: cached.catalog }
      : { status: "loading" },
  );

  useEffect(() => {
    let alive = true;
    loadCatalog().then(
      (catalog) => {
        if (!alive) return;
        setState(catalog.listError ? { status: "error", catalog } : { status: "ready", catalog });
      },
      () => {
        if (alive) setState({ status: "error" });
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
