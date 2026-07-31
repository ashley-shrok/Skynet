import { authApi, handleApiError } from "@/main-axios";

export const SAMPLE_PHRASE = "Hi, this is your voice.";

export async function postSpeak(text: string, voice?: string): Promise<Blob> {
  try {
    const body: { text: string; voice?: string } = { text };
    if (voice) body.voice = voice;
    const response = await authApi.post("/voice/speak", body, {
      responseType: "blob",
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
