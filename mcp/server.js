#!/usr/bin/env node
// Leerjournaal als MCP-server: zo kan Claude (de desktop-app of Claude Code) je gedachten lezen en
// documenten terugzetten in Leerjournaal, via je eigen Claude-abonnement en zonder API-sleutel.
//
// Dit programma is een brug: Claude start het (stdio), en het praat met de Leerjournaal-server via
// http, lokaal of op je Mac Mini via Tailscale. Je gedachten worden alleen op die server ontsleuteld;
// sleutels staan hier niet.
//
// Instellingen (omgevingsvariabelen):
//   LJ_URL              adres van Leerjournaal (standaard http://localhost:4173)
//   LJ_MCP_ALLEEN_LEZEN 1 = Claude mag alleen lezen, niets opslaan
//
// Ondersteunt zowel de oudere MCP-versies (met "initialize") als de nieuwe versie zonder sessie
// (2026-07-28, met _meta per verzoek). Geen extra pakketten nodig.
const readline = require('readline');
const { tools, prompts, INSTRUCTIONS } = require('./tools');
const { version } = require('../package.json');

const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'leerjournaal', title: 'Leerjournaal', version };
const META = 'io.modelcontextprotocol/';
const readOnly = /^(1|ja|true|yes)$/i.test(process.env.LJ_MCP_ALLEEN_LEZEN || '');

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
  if (readOnly && t.write) return { content: [{ type: 'text', text: 'Leerjournaal staat in alleen-lezen-stand (LJ_MCP_ALLEEN_LEZEN). Opslaan is uitgeschakeld.' }], isError: true };
  try {
    const out = await t.run(params.arguments || {});
    const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
    return { content: [{ type: 'text', text }], isError: false };
  } catch (e) {
    // Fouten die Claude zelf kan oplossen (verkeerde naam, server uit) als gewone tekst teruggeven.
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
  if (!isRequest) return; // meldingen (notifications) vragen geen antwoord
  const meta = params?._meta || {};
  const requested = meta[META + 'protocolVersion'];
  try {
    // Nieuwe protocolversie: versie en mogelijkheden staan bij elk verzoek.
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
    log('fout bij', method, e.message);
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
log(`gestart (versie ${version}) · Leerjournaal op ${process.env.LJ_URL || 'http://localhost:4173'}${readOnly ? ' · alleen lezen' : ''}`);
