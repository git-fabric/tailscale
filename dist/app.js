/**
 * @git-fabric/tailscale — FabricApp factory
 * 19 tools: devices, DNS, ACL, auth keys, health
 */
import { createAdapterFromEnv } from './adapters/env.js';
export function createApp(adapterOverride) {
    const ts = adapterOverride ?? createAdapterFromEnv();
    const tn = ts.tailnet;
    const tools = [
        // Devices
        { name: 'ts_list_devices', description: 'List all devices in the Tailscale network.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => { const r = await ts.get(`/tailnet/${tn}/devices`); const devs = r.devices ?? []; return { total: devs.length, devices: devs.map((d) => ({ id: d.id, name: d.name, hostname: d.hostname, addresses: d.addresses, os: d.os, user: d.user, authorized: d.authorized, lastSeen: d.lastSeen, tags: d.tags })) }; } },
        { name: 'ts_get_device', description: 'Get detailed info for a device.',
            inputSchema: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'] },
            execute: async (a) => ts.get(`/device/${a.device_id}`) },
        { name: 'ts_authorize_device', description: 'Authorize or de-authorize a device.',
            inputSchema: { type: 'object', properties: { device_id: { type: 'string' }, authorized: { type: 'boolean' } }, required: ['device_id', 'authorized'] },
            execute: async (a) => ts.post(`/device/${a.device_id}/authorized`, { authorized: a.authorized }) },
        { name: 'ts_set_device_tags', description: 'Set ACL tags on a device.',
            inputSchema: { type: 'object', properties: { device_id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['device_id', 'tags'] },
            execute: async (a) => ts.post(`/device/${a.device_id}/tags`, { tags: a.tags }) },
        { name: 'ts_get_device_routes', description: 'Get advertised and enabled routes for a device.',
            inputSchema: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'] },
            execute: async (a) => ts.get(`/device/${a.device_id}/routes`) },
        { name: 'ts_set_device_routes', description: 'Set advertised routes on a device (exit nodes, subnet routing).',
            inputSchema: { type: 'object', properties: { device_id: { type: 'string' }, routes: { type: 'array', items: { type: 'string' } } }, required: ['device_id', 'routes'] },
            execute: async (a) => ts.post(`/device/${a.device_id}/routes`, { routes: a.routes }) },
        { name: 'ts_delete_device', description: 'Remove a device from the tailnet.',
            inputSchema: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'] },
            execute: async (a) => { await ts.delete(`/device/${a.device_id}`); return { deleted: true, device_id: a.device_id }; } },
        // DNS
        { name: 'ts_get_dns', description: 'Get all DNS settings (nameservers, MagicDNS, search paths, split DNS).',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => {
                const [nameservers, preferences, searchPaths, splitDNS] = await Promise.all([
                    ts.get(`/tailnet/${tn}/dns/nameservers`),
                    ts.get(`/tailnet/${tn}/dns/preferences`),
                    ts.get(`/tailnet/${tn}/dns/searchpaths`),
                    ts.get(`/tailnet/${tn}/dns/split-dns`),
                ]);
                return { nameservers, preferences, searchPaths, splitDNS };
            } },
        { name: 'ts_set_dns_nameservers', description: 'Set custom DNS nameservers.',
            inputSchema: { type: 'object', properties: { nameservers: { type: 'array', items: { type: 'string' } } }, required: ['nameservers'] },
            execute: async (a) => ts.post(`/tailnet/${tn}/dns/nameservers`, { dns: a.nameservers }) },
        { name: 'ts_set_magic_dns', description: 'Enable or disable MagicDNS.',
            inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] },
            execute: async (a) => ts.post(`/tailnet/${tn}/dns/preferences`, { magicDNS: a.enabled }) },
        { name: 'ts_set_search_paths', description: 'Set DNS search paths.',
            inputSchema: { type: 'object', properties: { search_paths: { type: 'array', items: { type: 'string' } } }, required: ['search_paths'] },
            execute: async (a) => ts.post(`/tailnet/${tn}/dns/searchpaths`, { searchPaths: a.search_paths }) },
        { name: 'ts_set_split_dns', description: 'Configure split DNS routing.',
            inputSchema: { type: 'object', properties: { split_dns: { type: 'object', description: 'Map of domain → [nameservers]' } }, required: ['split_dns'] },
            execute: async (a) => ts.patch(`/tailnet/${tn}/dns/split-dns`, a.split_dns) },
        // ACL
        { name: 'ts_get_acl', description: 'Get the current ACL policy.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => ts.get(`/tailnet/${tn}/acl`) },
        { name: 'ts_validate_acl', description: 'Validate an ACL policy without applying it.',
            inputSchema: { type: 'object', properties: { acl: { type: 'object' } }, required: ['acl'] },
            execute: async (a) => ts.post(`/tailnet/${tn}/acl/validate`, a.acl) },
        { name: 'ts_set_acl', description: 'Set the ACL policy. WARNING: Changes network access rules.',
            inputSchema: { type: 'object', properties: { acl: { type: 'object' } }, required: ['acl'] },
            execute: async (a) => ts.post(`/tailnet/${tn}/acl`, a.acl) },
        // Auth keys
        { name: 'ts_list_keys', description: 'List all auth keys.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => ts.get(`/tailnet/${tn}/keys`) },
        { name: 'ts_create_key', description: 'Create a new auth key.',
            inputSchema: { type: 'object', properties: { reusable: { type: 'boolean', default: false }, ephemeral: { type: 'boolean', default: false }, preauthorized: { type: 'boolean', default: true }, tags: { type: 'array', items: { type: 'string' } }, expiry_seconds: { type: 'number', default: 86400 } } },
            execute: async (a) => ts.post(`/tailnet/${tn}/keys`, { capabilities: { devices: { create: { reusable: a.reusable ?? false, ephemeral: a.ephemeral ?? false, preauthorized: a.preauthorized ?? true, tags: a.tags ?? [] } } }, expirySeconds: a.expiry_seconds ?? 86400 }) },
        { name: 'ts_delete_key', description: 'Delete an auth key.',
            inputSchema: { type: 'object', properties: { key_id: { type: 'string' } }, required: ['key_id'] },
            execute: async (a) => { await ts.delete(`/tailnet/${tn}/keys/${a.key_id}`); return { deleted: true, key_id: a.key_id }; } },
        // Health
        { name: 'ts_health', description: 'Get Tailscale network health: device counts, authorized, exit nodes.',
            inputSchema: { type: 'object', properties: {} },
            execute: async () => {
                const r = await ts.get(`/tailnet/${tn}/devices`);
                const devs = r.devices ?? [];
                const authorized = devs.filter((d) => d.authorized);
                const exitNodes = devs.filter((d) => Array.isArray(d.enabledRoutes) && d.enabledRoutes.some((r) => r.includes('0.0.0.0/0')));
                const byOs = {};
                for (const d of devs) {
                    const os = String(d.os ?? 'unknown');
                    byOs[os] = (byOs[os] ?? 0) + 1;
                }
                return { healthy: true, summary: { total_devices: devs.length, authorized: authorized.length, exit_nodes: exitNodes.length }, devices_by_os: byOs, exit_nodes: exitNodes.map((d) => ({ name: d.name, addresses: d.addresses, lastSeen: d.lastSeen })) };
            } },
    ];
    return {
        name: '@git-fabric/tailscale', version: '0.1.0',
        description: 'Tailscale fabric app — devices, DNS, ACL, and auth keys',
        tools,
        async health() {
            const start = Date.now();
            try {
                await ts.get(`/tailnet/${tn}/devices`);
                return { app: '@git-fabric/tailscale', status: 'healthy', latencyMs: Date.now() - start };
            }
            catch (e) {
                return { app: '@git-fabric/tailscale', status: 'unavailable', latencyMs: Date.now() - start, details: { error: String(e) } };
            }
        },
    };
}
//# sourceMappingURL=app.js.map