import { authApi } from "@/main-axios";

export interface RemoteTmuxSession {
  hostId: number;
  hostName: string;
  sessionName: string;
  created: number;
}

export async function getSessionList(): Promise<RemoteTmuxSession[]> {
  const response = await authApi.get("/sessions/list");
  return response.data;
}
