/**
 * Client-side surface to the /workspace/desktop router
 * (src/backend/database/routes/workspace-desktop-routes.ts): an identity's
 * virtual desktop — status, start, and a view-only Guacamole token.
 *
 * Errors follow workspace-git-api.ts: when the response carries a backend
 * error class ("not_running", "guacd_unreachable", …) the helper throws an
 * Error whose .message IS that class; anything else goes through
 * handleApiError.
 *
 * NO React, NO UI, NO stateful side effects in this file.
 */

import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

export type DesktopStatus =
  | { available: false }
  | {
      available: true;
      running: boolean;
      display: number | null;
      vncPort: number | null;
      /** e.g. "1280x800" */
      geometry: string | null;
      /** A human has taken control (v2); the agent's input is paused. */
      userHasControl: boolean;
    };

export type DesktopConnection = {
  /** Encrypted Guacamole token for a VNC connection through the desktop tunnel. */
  token: string;
  geometry: string | null;
  userHasControl: boolean;
};

async function postDesktop<T>(
  route: string,
  body: Record<string, unknown>,
  label: string,
): Promise<T> {
  try {
    const response = await authApi.post(`/workspace/desktop${route}`, body);
    return response.data as T;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, label);
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}

/** Is the identity's desktop installed / running, and where. */
export function getDesktopStatus(
  identityKey: string,
  hostId: number,
): Promise<DesktopStatus> {
  return postDesktop("/status", { identityKey, hostId }, "read desktop status");
}

/** Start the desktop in the background; poll getDesktopStatus for `running`. */
export function startDesktop(
  identityKey: string,
  hostId: number,
): Promise<{ starting: true }> {
  return postDesktop("/start", { identityKey, hostId }, "start desktop");
}

/** Open (or reuse) the tunnel and get a view-only Guacamole token for it. */
export function connectDesktop(
  identityKey: string,
  hostId: number,
): Promise<DesktopConnection> {
  return postDesktop("/connect", { identityKey, hostId }, "connect to desktop");
}

/**
 * Take control: pauses the agent's own desktop input and returns an
 * INTERACTIVE token. The lease lapses 90s after the last renew, so callers
 * renew every 30s while they hold it and release when done.
 */
export function takeDesktopControl(
  identityKey: string,
  hostId: number,
): Promise<DesktopConnection> {
  return postDesktop(
    "/control",
    { identityKey, hostId, action: "take" },
    "take desktop control",
  );
}

/** Keep the control lease alive. */
export function renewDesktopControl(
  identityKey: string,
  hostId: number,
): Promise<{ ok: true }> {
  return postDesktop(
    "/control",
    { identityKey, hostId, action: "renew" },
    "renew desktop control",
  );
}

/** Hand the desktop back to the agent. */
export function releaseDesktopControl(
  identityKey: string,
  hostId: number,
): Promise<{ ok: true }> {
  return postDesktop(
    "/control",
    { identityKey, hostId, action: "release" },
    "release desktop control",
  );
}
