#!/usr/bin/env node
// Tests the Leerjournaal MCP server: starts it the way Claude does and runs every tool.
// Usage: LJ_URL=http://localhost:4173 node tools/mcp-test.js [--write]
// Without --write only the read tools are tested (nothing changes).
const { spawn } = require('child_process');
const path = require('path');
const write = process.argv.includes('--write') || process.argv.includes('--schrijven');
const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', nextId = 1; const waiting = new Map();
child.stdout.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); }
});
const rpc = (method, params) => new Promise((ok, bad) => {
  const id = nextId++; const t = setTimeout(() => bad(new Error(`geen antwoord op ${method}`)), 60000);
  waiting.set(id, m => { clearTimeout(t); ok(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const modern = p => ({ ...p, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'mcp-test', version: '1' } } });
let failed = 0;
const check = (label, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); if (!cond) failed++; };
const text = r => r.result?.content?.map(c => c.text).join('\n') || r.error?.message || '';

(async () => {
  // Older clients: initialize
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-test', version: '1' } });
  check('initialize (oude versie)', init.result?.protocolVersion === '2025-06-18' && init.result?.serverInfo?.name === 'leerjournaal');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  // Modern clients: server/discover and _meta on every request
  const disc = await rpc('server/discover', modern({}));
  check('server/discover (nieuwe versie)', disc.result?.supportedVersions?.includes('2026-07-28'));
  const bad = await rpc('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01', 'io.modelcontextprotocol/clientCapabilities': {} } });
  check('onbekende versie geweigerd', bad.error?.code === -32022);
  const list = await rpc('tools/list', modern({}));
  const names = (list.result?.tools || []).map(t => t.name);
  check('tools/list', names.length > 0, names.join(', '));
  const prompts = await rpc('prompts/list', modern({}));
  check('prompts/list', Array.isArray(prompts.result?.prompts), (prompts.result?.prompts || []).map(p => p.name).join(', '));
  const st = await rpc('tools/call', modern({ name: 'leerjournaal_status', arguments: {} }));
  check('leerjournaal_status', !st.result?.isError, text(st).split('\n')[0]);
  const scenario = require('./mcp-test-scenario');
  await scenario({ rpc, modern, check, text, write });
  child.stdin.end();
  console.log(failed ? `\n${failed} test(s) mislukt` : '\nAlles geslaagd');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
