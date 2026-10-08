/**
 * image-gen types shared by the service and its OpenAI adapter.
 */

/** What the adapter sends to OpenAI. `ref` is the reference image's filename. */
export interface ImageGenRequestBody {
  prompt: string;
  size?: string;
  quality?: string;
  n?: number;
  ref?: string;
}

/**
 * Adapter failure reasons (D-27). The engine adds its own codes on top
 * (expired, queue_full, ...); see ../../engine/types.ts.
 */
export type FailureReason =
  | "content_blocked"
  | "rate_limited"
  | "provider_unavailable"
  | "not_configured"
  | "malformed"
  | "unknown";
