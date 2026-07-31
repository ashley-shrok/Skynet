import { authApi, handleApiError } from "@/main-axios";

export const SAMPLE_PHRASE = "Hi, this is your voice.";

export async function postSpeak(text: string, voice?: string): Promise<Blob> {
  try {
    const body: { text: string; voice?: string } = { text };
    if (voice) body.voice = voice;
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

export async function getVoices(): Promise<{ display_name: string; filename: string }[]> {
  try {
    const response = await authApi.get("/voice/voices");
    return response.data as { display_name: string; filename: string }[];
  } catch (error) {
    handleApiError(error, "list voices");
  }
}
