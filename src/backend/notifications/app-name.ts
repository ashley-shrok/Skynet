/**
 * The instance's own name (branding appName), for user-facing notification
 * text — never the product name. Read per call; loadBrandingConfig never throws.
 */
import { loadBrandingConfig } from "../branding/branding-config-loader.js";

export async function getAppName(): Promise<string> {
  return (await loadBrandingConfig()).appName;
}
