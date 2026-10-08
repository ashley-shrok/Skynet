/**
 * agent-services/user-secrets/declared.ts — the per-user secrets the
 * registered services declare, flattened for the routes and UI.
 */

import type { ServiceDefinition } from "../engine/types.js";

export interface DeclaredUserSecret {
  service: string;
  serviceDescription: string;
  name: string;
  label: string;
  description?: string;
  managedBy: "user" | "admin";
  /** True when the backend has a fallback value for users without one. */
  hasFallback: boolean;
}

export function declaredUserSecrets(
  services: readonly ServiceDefinition[],
  env: Record<string, string | undefined> = process.env,
): DeclaredUserSecret[] {
  const out: DeclaredUserSecret[] = [];
  for (const svc of services) {
    for (const [name, spec] of Object.entries(svc.userSecrets ?? {})) {
      out.push({
        service: svc.name,
        serviceDescription: svc.description,
        name,
        label: spec.label,
        ...(spec.description !== undefined
          ? { description: spec.description }
          : {}),
        managedBy: spec.managedBy,
        hasFallback: Boolean(spec.fallbackEnv && env[spec.fallbackEnv]),
      });
    }
  }
  return out;
}
