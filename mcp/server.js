#!/usr/bin/env node
// Leerjournaal as an MCP server: lets Claude (the desktop app or Claude Code) read the user's thoughts
// and save documents back into Leerjournaal, using the user's own Claude subscription (no API key).
//
// This program is a bridge: Claude starts it (stdio) and it talks to the Leerjournaal server over
// HTTP, locally or on the Mac Mini via Tailscale. Thoughts are only decrypted on that server; no keys
// are stored here.
//
// Settings (environment variables):
//   LJ_URL             address of Leerjournaal (default http://localhost:4173)
//   LJ_MCP_READ_ONLY   1 = Claude may only read, never save (LJ_MCP_ALLEEN_LEZEN is accepted too)
//
// Supports both older MCP revisions (with "initialize") and the stateless revision 2026-07-28
// (server/discover, _meta on every request). No external packages needed.
const readline = require('readline');
const { tools, prompts, INSTRUCTIONS } = require('./tools');
const { version } = require('../package.json');

const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'leerjournaal', title: 'Leerjournaal', version };
const META = 'io.modelcontextprotocol/';
const readOnly = /^(1|ja|true|yes)$/i.test(process.env.LJ_MCP_READ_ONLY || process.env.LJ_MCP_ALLEEN_LEZEN || '');

const log = (...a) => process.stderr.write(`[leerjournaal-mcp] ${a.join(' ')}\n`);
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result: { resultType: 'complete', ...result, _meta: { [META + 'serverInfo']: SERVER_INFO, ...(result._meta || {}) } } });
const err = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

const capabilities = () => ({ tools: { listChanged: false }, prompts: { listChanged: false } });
const visibleTools = () => tools.filter(t => !(readOnly && t.write));

function toolList() {
  return visibleTools().map(t => ({
    name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false }
  }));
}

async function callTool(params) {
  const t = tools.find(x => x.name === params?.name);
  if (!t) throw Object.assign(new Error(`Onbekend hulpmiddel: ${params?.name}`), { rpc: -32602 });
  if (readOnly && t.write) return { content: [{ type: 'text', text: 'Leerjournaal staat in alleen-lezen-stand (LJ_MCP_READ_ONLY). Opslaan is uitgeschakeld.' }], isError: true };
  try {
    const out = await t.run(params.arguments || {});
    const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
    return { content: [{ type: 'text', text }], isError: false };
  } catch (e) {
    // Errors Claude can fix itself (wrong name, server down) are returned as normal tool output.
    return { content: [{ type: 'text', text: e.message || String(e) }], isError: true };
  }
}

async function getPrompt(params) {
  const p = prompts.find(x => x.name === params?.name);
  if (!p) throw Object.assign(new Error(`Onbekende opdracht: ${params?.name}`), { rpc: -32602 });
  for (const a of p.arguments || []) if (a.required && !params.arguments?.[a.name]) throw Object.assign(new Error(`Vul “${a.name}” in.`), { rpc: -32602 });
  return { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.build(params.arguments || {}, { readOnly }) } }] };
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  if (!isRequest) return; // notifications get no response
  const meta = params?._meta || {};
  const requested = meta[META + 'protocolVersion'];
  try {
    // Modern protocol revision: version and capabilities come with every request.
    if (requested !== undefined && method !== 'initialize') {
      if (!MODERN.includes(requested)) return err(id, -32022, 'Unsupported protocol version', { supported: [...MODERN, ...LEGACY], requested });
      if (method !== 'server/discover' && meta[META + 'clientCapabilities'] === undefined) return err(id, -32602, 'Missing _meta io.modelcontextprotocol/clientCapabilities');
    }
    switch (method) {
      case 'initialize': {
        const v = params?.protocolVersion;
        return ok(id, { protocolVersion: LEGACY.includes(v) ? v : LEGACY[0], capabilities: capabilities(), serverInfo: SERVER_INFO, instructions: INSTRUCTIONS(readOnly) });
      }
      case 'server/discover':
        return ok(id, { supportedVersions: [...MODERN, ...LEGACY], capabilities: capabilities(), instructions: INSTRUCTIONS(readOnly), ttlMs: 60000, cacheScope: 'private' });
      case 'ping': return ok(id, {});
      case 'tools/list': return ok(id, { tools: toolList() });
      case 'tools/call': return ok(id, await callTool(params));
      case 'prompts/list': return ok(id, { prompts: prompts.map(p => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments || [] })) });
      case 'prompts/get': return ok(id, await getPrompt(params));
      case 'resources/list': return ok(id, { resources: [] });
      case 'resources/templates/list': return ok(id, { resourceTemplates: [] });
      default: return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    log('error in', method, e.message);
    return err(id, e.rpc || -32603, e.message || 'Interne fout');
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return err(null, -32700, 'Parse error'); }
  if (Array.isArray(msg)) return msg.forEach(m => handle(m));
  handle(msg);
});
rl.on('close', () => process.exit(0));
log(`started (version ${version}) · Leerjournaal at ${process.env.LJ_URL || 'http://localhost:4173'}${readOnly ? ' · read-only' : ''}`);
