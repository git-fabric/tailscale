/**
 * Tailscale environment adapter
 * Required: TAILSCALE_API_KEY
 * Optional: TAILSCALE_TAILNET (default: "-" = authenticated user's tailnet)
 */
export interface TailscaleAdapter {
    tailnet: string;
    get(path: string): Promise<unknown>;
    post(path: string, body?: unknown): Promise<unknown>;
    patch(path: string, body?: unknown): Promise<unknown>;
    delete(path: string): Promise<void>;
}
export declare function createAdapterFromEnv(): TailscaleAdapter;
//# sourceMappingURL=env.d.ts.map