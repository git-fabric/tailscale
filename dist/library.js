/**
 * Library — git-based knowledge retrieval for fabric-tailscale
 *
 * The librarian model: we know where the books are, we go fetch them
 * when asked, and we return them when done. No photocopies.
 *
 * Sources:
 *   - tailscale/tailscale — official Tailscale client and daemon
 *   - tailscale/tailscale.com — knowledge base and documentation
 */
import { execSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
const LIBRARY_DIR = process.env.LIBRARY_DIR || '/tmp/fabric-library';
const SOURCES = [
    {
        id: 'tailscale',
        repo: 'https://github.com/tailscale/tailscale.git',
        branch: 'main',
        description: 'Tailscale client — private WireGuard networks made easy',
        topics: [
            { keywords: ['install', 'setup', 'getting started', 'deploy', 'build'],
                files: ['README.md'],
                description: 'Installation and setup' },
            { keywords: ['client', 'daemon', 'tailscaled', 'cli'],
                files: ['README.md', 'cmd/tailscale/cli/up.go'],
                description: 'Tailscale client and daemon' },
            { keywords: ['wireguard', 'tunnel', 'wgengine'],
                files: ['README.md'],
                description: 'WireGuard tunneling' },
        ],
    },
    {
        id: 'tailscale-docs-devices',
        repo: 'https://github.com/tailscale/tailscale.git',
        branch: 'main',
        description: 'Tailscale device management — authorization, tagging, removal',
        useRawApi: true,
        topics: [
            { keywords: ['device', 'machine', 'node', 'authorize', 'authorized', 'remove', 'delete'],
                files: ['README.md'],
                description: 'Device management: devices join a tailnet via SSO or auth keys, each gets a unique 100.x.y.z IP. Devices can be authorized/deauthorized, tagged with ACL tags, and removed from the tailnet. Tags change device identity for ACL purposes.' },
            { keywords: ['tag', 'acl tag', 'device tag', 'label'],
                files: ['README.md'],
                description: 'Device tagging: ACL tags (tag:xxx) assigned to devices change their identity for access control. Tags are defined in tagOwners in the policy file.' },
        ],
    },
    {
        id: 'tailscale-docs-acl',
        repo: 'https://github.com/tailscale/tailscale.git',
        branch: 'main',
        description: 'Tailscale ACLs — access control lists for tailnet policy',
        useRawApi: true,
        topics: [
            { keywords: ['acl', 'access control', 'policy', 'rule', 'firewall', 'permit', 'deny'],
                files: ['README.md'],
                description: 'ACLs: deny-by-default, directional, locally enforced. Policy uses huJSON with sections: acls, groups, hosts, tests, tagOwners, autoApprovers, nodeAttrs, ipsets. Rules: {"action":"accept","src":[...],"dst":["...:port"]}. Sources/destinations: IPs, CIDRs, autogroups, tags, hosts, users, groups.' },
            { keywords: ['group', 'tagowner', 'autoapprover', 'autogroup'],
                files: ['README.md'],
                description: 'ACL groups and tag owners: groups define named sets of users, tagOwners define who can assign tags, autoApprovers auto-approve routes/exit nodes for tagged devices.' },
            { keywords: ['test', 'validate', 'acl test'],
                files: ['README.md'],
                description: 'ACL validation: tests section in policy file validates rules before applying. API endpoint POST /tailnet/{tailnet}/acl/validate checks policy without applying.' },
        ],
    },
    {
        id: 'tailscale-docs-dns',
        repo: 'https://github.com/tailscale/tailscale.git',
        branch: 'main',
        description: 'Tailscale DNS — MagicDNS, nameservers, split DNS, search domains',
        useRawApi: true,
        topics: [
            { keywords: ['dns', 'nameserver', 'resolver', 'resolve'],
                files: ['README.md'],
                description: 'DNS: global nameservers handle all queries, restricted nameservers (split DNS) handle specific domains. Public nameservers auto-encrypt via DoH. Override toggle forces tailnet DNS only.' },
            { keywords: ['magicdns', 'magic dns', 'magic-dns', 'hostname', 'machine name'],
                files: ['README.md'],
                description: 'MagicDNS: enabled by default, auto-assigns DNS names for devices. Devices reachable by hostname (e.g., myserver.tailnet-name.ts.net). Cannot add custom records.' },
            { keywords: ['split dns', 'search domain', 'search path', 'conditional'],
                files: ['README.md'],
                description: 'Split DNS: restricted nameservers for specific domains (e.g., 1.1.1.1 for example.com). Search domains allow shorthand (entering "server" resolves to server.example.com). MagicDNS is always first search domain.' },
        ],
    },
    {
        id: 'tailscale-docs-keys',
        repo: 'https://github.com/tailscale/tailscale.git',
        branch: 'main',
        description: 'Tailscale auth keys — device registration without browser login',
        useRawApi: true,
        topics: [
            { keywords: ['auth key', 'authentication key', 'key', 'register', 'provision'],
                files: ['README.md'],
                description: 'Auth keys: enable device registration without browser login. Types: one-off (single use), reusable (multiple devices — dangerous if stolen), ephemeral (auto-removes offline devices), pre-approved (bypasses approval), tagged (assigns ACL tags). Expire 1-90 days (default 90). Created by Owners/Admins via admin console or API.' },
            { keywords: ['ephemeral', 'container', 'iot', 'terraform', 'automation'],
                files: ['README.md'],
                description: 'Ephemeral keys: devices auto-removed when they go offline. Ideal for containers, CI runners, and short-lived infrastructure.' },
            { keywords: ['reusable', 'preauthorized', 'pre-authorized'],
                files: ['README.md'],
                description: 'Reusable keys: authenticate multiple devices. Pre-authorized keys bypass device approval. Both can be combined with tags for automated fleet provisioning.' },
        ],
    },
    {
        id: 'tailscale-docs-routes',
        repo: 'https://github.com/tailscale/tailscale.git',
        branch: 'main',
        description: 'Tailscale routes — subnet routers, exit nodes, route advertisement',
        useRawApi: true,
        topics: [
            { keywords: ['route', 'subnet', 'subnet router', 'advertise', 'cidr'],
                files: ['README.md'],
                description: 'Subnet routers: gateway devices that extend tailnet to physical subnets. Devices behind them do not count toward device limits. Setup: install Tailscale, enable IP forwarding, advertise routes (--advertise-routes=192.0.2.0/24), approve in admin console or via autoApprovers. High availability via overlapping routes with longest prefix matching.' },
            { keywords: ['exit node', 'exit-node', 'vpn', 'internet', 'outbound'],
                files: ['README.md'],
                description: 'Exit nodes: route ALL outbound internet traffic through a device (like a traditional VPN). Different from subnet routers which only route specific subnets. By default, exit nodes override DNS settings. Set up with --advertise-exit-node flag, approve in admin console.' },
            { keywords: ['ip forwarding', 'snat', 'nat', 'source nat'],
                files: ['README.md'],
                description: 'IP forwarding: required on Linux subnet routers (sysctl net.ipv4.ip_forward=1, net.ipv6.conf.all.forwarding=1). macOS handles automatically. SNAT can be disabled on Linux to preserve original device IPs.' },
        ],
    },
];
export class Library {
    cacheDir;
    constructor() {
        this.cacheDir = LIBRARY_DIR;
        if (!existsSync(this.cacheDir)) {
            mkdirSync(this.cacheDir, { recursive: true });
        }
    }
    findTopics(query) {
        const q = query.toLowerCase();
        const matches = [];
        for (const source of SOURCES) {
            for (const topic of source.topics) {
                let score = 0;
                for (const kw of topic.keywords) {
                    if (q.includes(kw)) {
                        score += kw.length;
                    }
                }
                if (score > 0) {
                    matches.push({ source, topic, score });
                }
            }
        }
        return matches.sort((a, b) => b.score - a.score);
    }
    checkout(source) {
        if (source.useRawApi)
            return '';
        const localPath = join(this.cacheDir, source.id);
        if (existsSync(join(localPath, '.git'))) {
            try {
                execSync(`git -C ${localPath} pull --depth 1 --rebase 2>/dev/null || true`, {
                    timeout: 15000,
                    stdio: 'pipe',
                });
            }
            catch {
                // Stale cache is better than no cache
            }
            return localPath;
        }
        execSync(`git clone --depth 1 --branch ${source.branch} ${source.repo} ${localPath}`, { timeout: 60000, stdio: 'pipe' });
        return localPath;
    }
    readFiles(source, files) {
        if (source.useRawApi) {
            return this.readFilesFromGitHub(source, files);
        }
        const localPath = this.checkout(source);
        const sections = [];
        for (const file of files) {
            const fullPath = join(localPath, file);
            if (existsSync(fullPath)) {
                try {
                    const content = readFileSync(fullPath, 'utf-8');
                    const trimmed = content.length > 8000
                        ? content.slice(0, 8000) + '\n\n...[truncated — full source at ' + file + ']'
                        : content;
                    sections.push(`--- ${file} ---\n${trimmed}`);
                }
                catch {
                    // Skip unreadable files
                }
            }
        }
        return sections.join('\n\n');
    }
    readFilesFromGitHub(source, files) {
        // For useRawApi sources, the topic description IS the content
        // (these are curated knowledge entries, not raw file fetches)
        const match = source.repo.match(/github\.com\/([^/]+\/[^/.]+)/);
        if (!match)
            return '';
        const ownerRepo = match[1];
        const sections = [];
        for (const file of files) {
            try {
                const url = `https://raw.githubusercontent.com/${ownerRepo}/${source.branch}/${file}`;
                const content = execSync(`curl -sf --max-time 10 "${url}"`, {
                    timeout: 12000,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    encoding: 'utf-8',
                });
                if (content) {
                    const trimmed = content.length > 8000
                        ? content.slice(0, 8000) + '\n\n...[truncated — full source at ' + file + ']'
                        : content;
                    sections.push(`--- ${file} ---\n${trimmed}`);
                }
            }
            catch {
                // Skip unavailable files
            }
        }
        return sections.join('\n\n');
    }
    async query(queryText) {
        const matches = this.findTopics(queryText);
        if (matches.length === 0)
            return null;
        const topMatches = matches.slice(0, 3);
        // For useRawApi sources, use topic descriptions as inline knowledge
        // For git-cloned sources, read the actual files
        const sections = [];
        const sources = [];
        const seenFiles = new Set();
        for (const m of topMatches) {
            if (m.source.useRawApi) {
                // Inline knowledge — the topic description is the content
                const key = `${m.source.id}:${m.topic.description}`;
                if (!seenFiles.has(key)) {
                    seenFiles.add(key);
                    sections.push(`--- ${m.source.description} ---\n${m.topic.description}`);
                    sources.push(`${m.source.id}/${m.topic.keywords[0]}`);
                }
            }
            else {
                for (const f of m.topic.files) {
                    const key = `${m.source.id}:${f}`;
                    if (!seenFiles.has(key)) {
                        seenFiles.add(key);
                        try {
                            const content = this.readFiles(m.source, [f]);
                            if (content) {
                                sections.push(content);
                                sources.push(`${m.source.id}/${f}`);
                            }
                        }
                        catch {
                            // Continue with other sources
                        }
                    }
                }
            }
        }
        if (sections.length === 0)
            return null;
        const context = sections.join('\n\n');
        const bestScore = topMatches[0].score;
        const confidence = Math.min(0.92, 0.6 + bestScore * 0.04);
        return { context, confidence, sources };
    }
    listSources() {
        return SOURCES.map(s => ({
            id: s.id,
            repo: s.repo,
            topics: s.topics.length,
            description: s.description,
        }));
    }
}
//# sourceMappingURL=library.js.map