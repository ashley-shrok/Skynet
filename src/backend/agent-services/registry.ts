/**
 * agent-services/registry.ts — every agent service this backend offers.
 *
 * To add one, write `services/<name>/service.ts` exporting
 * `defineService({...})` as default, and add it here. See README.md.
 */

import type { ServiceDefinition } from "./engine/types.js";
import agentPhone from "./services/agent-phone/service.js";
import imageGen from "./services/image-gen/service.js";
import stt from "./services/stt/service.js";

export const AGENT_SERVICES: readonly ServiceDefinition[] = [
  agentPhone,
  imageGen,
  stt,
];
