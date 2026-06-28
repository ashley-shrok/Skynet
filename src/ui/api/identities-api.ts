import { authApi, handleApiError } from "@/main-axios";

export interface Identity {
  id: string;
  identityKey: string;
  displayName: string;
  title: string | null;
  colorHue: number | null;
  avatarMime: string;
  avatarUrl: string;
  avatarEtag: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityInput {
  identityKey?: string;
  displayName?: string;
  title?: string | null;
  colorHue?: number | null;
}

function buildFormData(meta: IdentityInput, avatar: File | null): FormData {
  const fd = new FormData();
  fd.append("data", JSON.stringify(meta));
  if (avatar) fd.append("avatar", avatar);
  return fd;
}

export async function listIdentities(): Promise<Identity[]> {
  try {
    const response = await authApi.get("/identities");
    return response.data as Identity[];
  } catch (error) {
    handleApiError(error, "list identities");
  }
}

export async function createIdentity(
  meta: Required<Pick<IdentityInput, "identityKey" | "displayName">> &
    Pick<IdentityInput, "title" | "colorHue">,
  avatar: File,
): Promise<Identity> {
  try {
    const response = await authApi.post(
      "/identities",
      buildFormData(meta, avatar),
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return response.data as Identity;
  } catch (error) {
    handleApiError(error, "create identity");
  }
}

export async function updateIdentity(
  id: string,
  meta: IdentityInput,
  avatar: File | null,
): Promise<Identity> {
  try {
    const response = await authApi.put(
      `/identities/${id}`,
      buildFormData(meta, avatar),
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return response.data as Identity;
  } catch (error) {
    handleApiError(error, "update identity");
  }
}

export async function deleteIdentity(id: string): Promise<void> {
  try {
    await authApi.delete(`/identities/${id}`);
  } catch (error) {
    handleApiError(error, "delete identity");
  }
}
