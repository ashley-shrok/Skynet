import { authApi, handleApiError } from "@/main-axios";

// Client for the /instance-file router (src/backend/database/routes/instance-file.ts).
// The instance file is the CLAUDE.md the distributor installs at
// /etc/claude-code/CLAUDE.md on every host. Admin-only.

export type InstanceFile = { content: string; updatedAt: number | null };

export async function getInstanceFile(): Promise<InstanceFile> {
  try {
    const res = await authApi.get("/instance-file");
    return res.data as InstanceFile;
  } catch (error) {
    handleApiError(error, "load the instance file");
  }
}

export async function saveInstanceFile(content: string): Promise<InstanceFile> {
  try {
    const res = await authApi.put("/instance-file", { content });
    return res.data as InstanceFile;
  } catch (error) {
    handleApiError(error, "save the instance file");
  }
}
