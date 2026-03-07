/**
 * @git-fabric/tailscale — shared types
 *
 * Covers: devices, DNS, ACL, auth keys, routes, exit nodes, MagicDNS.
 */

export interface TailscaleAdapter {
  tailnet: string;
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  patch(path: string, body?: unknown): Promise<unknown>;
  delete(path: string): Promise<void>;
}
