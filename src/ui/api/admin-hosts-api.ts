import { authApi, handleApiError } from "@/main-axios";

// ============================================================================
// ADMIN HOSTS OVERVIEW
// ============================================================================
// Mirrors AdminHostsResponse in src/backend/admin-hosts/hosts-overview.ts.

export interface AdminHostResources {
  os: string | null;
  arch: string | null;
  uptimeSec: number | null;
  cores: number | null;
  load1: number | null;
  memTotalKb: number | null;
  memAvailKb: number | null;
  diskTotalKb: number | null;
  diskUsedKb: number | null;
  diskAvailKb: number | null;
}

export interface AdminHostOverview {
  key: string;
  name: string;
  address: string;
  protocols: Array<"ssh" | "rdp" | "vnc">;
  agentHost: boolean;
  online: boolean;
  latencyMs: number | null;
  lastSeenAt: number | null;
  resources: AdminHostResources | null;
  resourcesNote: "no_ssh" | "no_access" | "probe_failed" | null;
  fleet: {
    agents: number;
    running: number;
    apps: number;
    supervisorRunning: boolean;
  } | null;
  substrate: {
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
    lastError: string | null;
    consecutiveFailures: number;
    inFlight: boolean;
  } | null;
}

export interface AdminHostsResponse {
  hosts: AdminHostOverview[];
  generatedAt: number;
}

// Backing route: GET /users/admin/hosts (admin only).
export async function getAdminHosts(): Promise<AdminHostsResponse> {
  try {
    const response = await authApi.get("/users/admin/hosts");
    return response.data;
  } catch (error) {
    handleApiError(error, "load hosts overview");
  }
}
