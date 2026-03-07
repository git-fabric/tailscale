/**
 * Tailscale environment adapter
 * Required: TAILSCALE_API_KEY
 * Optional: TAILSCALE_TAILNET (default: "-" = authenticated user's tailnet)
 */
import type { TailscaleAdapter } from '../types.js';
export type { TailscaleAdapter } from '../types.js';
export declare function createAdapterFromEnv(): TailscaleAdapter;
//# sourceMappingURL=env.d.ts.map