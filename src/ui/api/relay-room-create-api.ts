// Phase 91 Plan 04 — relay-room-create-api.ts
//
// Frontend api client for the relay-room create endpoint.
// Follows the authApi wrapper + handleApiError convention from
// user-management-api.ts.

import { authApi, handleApiError } from "@/main-axios";
import type {
  CreateRelayRoomRequest,
  CreateRelayRoomResponse,
} from "@/features/pretty-conversations/participant-types";

/**
 * Create a relay-mediated group conversation room.
 *
 * POSTs to the relay-room create backend route (Phase 91 Plan 03).
 * JWT cookie is attached via authApi (authenticated axios instance).
 *
 * @param req - The room name and picked participant mxids.
 * @returns Typed CreateRelayRoomResponse on success.
 * @throws On any error — handled via handleApiError("create relay room").
 */
export async function createRelayRoom(
  req: CreateRelayRoomRequest,
): Promise<CreateRelayRoomResponse> {
  try {
    const response = await authApi.post("/relay-room/create", req);
    return response.data as CreateRelayRoomResponse;
  } catch (error) {
    handleApiError(error, "create relay room");
  }
}
