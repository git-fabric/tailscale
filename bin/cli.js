#!/usr/bin/env node
import { createApp } from '../dist/app.js';
import { Library } from '../dist/library.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';

const app = createApp();
const library = new Library();

function buildServer() {
  const server = new Server({ name: app.name, version: app.version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: app.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = app.tools.find((t) => t.name === req.params.name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    try {
      const result = await tool.execute(req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: String(e) }], isError: true };
    }
  });

  return server;
}

// ── Gateway registration ─────────────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL;
const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : null;
const POD_IP = process.env.POD_IP || '0.0.0.0';

let sessionToken = null;

async function registerWithGateway() {
  if (!GATEWAY_URL) return;
  const mcpEndpoint = `http://${POD_IP}:${MCP_HTTP_PORT || 8200}/mcp`;
  const body = {
    fabric_id: 'fabric-tailscale',
    as_number: 65007,
    version: app.version,
    mcp_endpoint: mcpEndpoint,
    ollama_endpoint: process.env.OLLAMA_ENDPOINT || 'http://ollama.fabric-sdk:11434',
    ollama_model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b',
    supervisor: 'standalone',
    tailscale_node: 'fabric-tailscale',
    worker_pool: { total: 0, healthy: 0, workers: [] },
    routes: [
      { prefix: 'fabric.tailscale', local_pref: 100, description: 'Tailscale VPN — devices, DNS, ACL, auth keys, routes' },
      { prefix: 'fabric.tailscale.devices', local_pref: 100, description: 'Device management — list, authorize, tag, remove devices' },
      { prefix: 'fabric.tailscale.dns', local_pref: 100, description: 'DNS settings — MagicDNS, nameservers, split DNS, search paths' },
      { prefix: 'fabric.tailscale.acl', local_pref: 100, description: 'Access control — ACL policy, validation, groups, tags' },
      { prefix: 'fabric.tailscale.keys', local_pref: 100, description: 'Auth keys — create, list, delete authentication keys' },
      { prefix: 'fabric.tailscale.routes', local_pref: 100, description: 'Routes — subnet routers, exit nodes, route advertisement' },
    ],
  };

  try {
    const res = await fetch(`${GATEWAY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      sessionToken = data.session_token;
      console.log(`[fabric-tailscale] Registered with gateway: ${sessionToken} (${data.routes_accepted} routes)`);
    } else {
      console.warn(`[fabric-tailscale] Registration rejected: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.warn(`[fabric-tailscale] Gateway registration failed (standalone mode): ${err.message}`);
  }
}

async function sendKeepalive() {
  if (!GATEWAY_URL || !sessionToken) return;
  try {
    const res = await fetch(`${GATEWAY_URL}/keepalive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fabric_id: 'fabric-tailscale',
        session_token: sessionToken,
        worker_pool: { total: 0, healthy: 0, workers: [] },
        timestamp: Math.floor(Date.now() / 1000),
      }),
    });
    if (res.status === 401) {
      console.log('[fabric-tailscale] Session expired — re-registering');
      sessionToken = null;
      await registerWithGateway();
    }
  } catch {
    // Gateway unreachable — will retry next interval
  }
}

// ── Server startup ───────────────────────────────────────────────────────────

const httpPort = MCP_HTTP_PORT;

if (httpPort) {
  const httpServer = createServer(async (req, res) => {
    if (req.url === '/healthz' || req.url === '/health') {
      const h = await app.health();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(h));
      return;
    }
    if (req.url === '/tools') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(app.tools.map((t) => ({ name: t.name, description: t.description }))));
      return;
    }
    // MCP tool call endpoint for gateway DNS unicast resolution
    if ((req.url === '/mcp/tools/call' || req.url === '/tools/call') && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());

      // Handle aiana_query — gateway DNS resolver asks for context
      //
      // Two knowledge sources, checked in order:
      //   1. Live Tailscale API (deterministic) — real-time network state
      //   2. Library (reference) — Tailscale docs, fetched from git on demand
      //
      // Live API answers "what IS the network state" — library answers "how to" and "why"
      if (body.name === 'aiana_query') {
        const queryText = (body.arguments?.query_text || '').toLowerCase();
        try {
          let context = '';
          let confidence = 0;
          let source = 'tailscale-api';

          // ── Live Tailscale queries (real-time state) ──────────────
          if (/\b(list|show|get|what)\b.*\b(device|machine|node|host)s?\b/.test(queryText) && !queryText.includes('how')) {
            const devices = await app.tools.find(t => t.name === 'ts_list_devices')?.execute({});
            context = JSON.stringify(devices, null, 2);
            confidence = 0.95;
          } else if (/\b(dns|nameserver|resolver|magicdns|magic dns|search path|split dns)\b/.test(queryText) && !queryText.includes('how')) {
            const dns = await app.tools.find(t => t.name === 'ts_get_dns')?.execute({});
            context = JSON.stringify(dns, null, 2);
            confidence = 0.9;
          } else if (/\b(acl|access control|policy|rule|firewall)\b/.test(queryText) && !queryText.includes('how')) {
            const acl = await app.tools.find(t => t.name === 'ts_get_acl')?.execute({});
            context = JSON.stringify(acl, null, 2);
            confidence = 0.9;
          } else if (/\b(list|show|get)\b.*\b(key|auth key|authentication key)\b/.test(queryText)) {
            const keys = await app.tools.find(t => t.name === 'ts_list_keys')?.execute({});
            context = JSON.stringify(keys, null, 2);
            confidence = 0.9;
          } else if (/\b(route|subnet|exit node|exit-node|advertise)\b/.test(queryText) && !queryText.includes('how')) {
            // Routes are per-device, show device list with route hints
            const devices = await app.tools.find(t => t.name === 'ts_list_devices')?.execute({});
            context = JSON.stringify(devices, null, 2);
            confidence = 0.8;
          } else if (/\b(health|status|overview|summary)\b/.test(queryText)) {
            const health = await app.tools.find(t => t.name === 'ts_health')?.execute({});
            context = JSON.stringify(health, null, 2);
            confidence = 0.95;
          } else {
            // ── Library queries (reference docs) ──────────────────────
            const libraryResult = await library.query(queryText);
            if (libraryResult && libraryResult.context) {
              context = libraryResult.context;
              confidence = libraryResult.confidence;
              source = 'library';
              console.log(`[fabric-tailscale] Library hit: ${libraryResult.sources.join(', ')}`);
            } else {
              // Nothing in library either — return health as fallback
              const health = await app.tools.find(t => t.name === 'ts_health')?.execute({});
              context = JSON.stringify(health, null, 2);
              confidence = 0.5;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ context, confidence, source }));
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ context: `Error querying Tailscale: ${err.message}`, confidence: 0 }));
        }
        return;
      }

      const tool = app.tools.find((t) => t.name === body.name);
      if (!tool) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Tool not found: ${body.name}` }));
        return;
      }
      try {
        const result = await tool.execute(body.arguments ?? {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (req.url === '/mcp' || req.url === '/') {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = buildServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, undefined);
      return;
    }
    res.writeHead(404).end('not found');
  });

  httpServer.listen(httpPort, () => {
    console.log(`[fabric-tailscale] ${app.name} v${app.version} — ${app.tools.length} tools`);
    console.log(`[fabric-tailscale] MCP server listening on :${httpPort}`);
    console.log(`[fabric-tailscale] Endpoints: /health /tools /tools/call /mcp/tools/call /mcp`);
  });

  // Register with gateway after server is listening
  await registerWithGateway();

  // Keepalive every 30s
  if (GATEWAY_URL) {
    setInterval(sendKeepalive, 30_000);
  }
} else {
  const transport = new StdioServerTransport();
  const server = buildServer();
  await server.connect(transport);
}
