/**
 * Tailscale environment adapter
 * Required: TAILSCALE_API_KEY
 * Optional: TAILSCALE_TAILNET (default: "-" = authenticated user's tailnet)
 */
const TS_API = 'https://api.tailscale.com/api/v2';
export function createAdapterFromEnv() {
    const key = process.env.TAILSCALE_API_KEY;
    if (!key)
        throw new Error('TAILSCALE_API_KEY is required');
    const tailnet = process.env.TAILSCALE_TAILNET ?? '-';
    function headers() { return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }; }
    async function tsf(method, path, body) {
        const url = path.startsWith('http') ? path : `${TS_API}${path}`;
        const res = await fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
        if (!res.ok)
            throw new Error(`Tailscale ${method} ${path}: ${res.status} ${await res.text()}`);
        if (res.status === 204 || res.headers.get('content-length') === '0')
            return null;
        return res.json();
    }
    return {
        tailnet,
        get: (path) => tsf('GET', path),
        post: (path, body) => tsf('POST', path, body),
        patch: (path, body) => tsf('PATCH', path, body),
        delete: async (path) => { await tsf('DELETE', path); },
    };
}
//# sourceMappingURL=env.js.map