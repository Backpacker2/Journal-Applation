#!/usr/bin/env node
// Leerjournaal – lokale server. Geen externe packages nodig (Node 18+).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { loadOrCreateKey } = require('./lib/crypto');
const { Store } = require('./lib/store');
const { Git } = require('./lib/git');
const ai = require('./lib/ai');
const { Updater } = require('./lib/updater');

const cfg = loadConfig();
const { key, created: keyCreated } = loadOrCreateKey(cfg.keyFile);
const store = new Store(cfg.dataDir, key);
const git = new Git(cfg.dataDir);
const updater = new Updater(cfg.appDir);

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) { reject(Object.assign(new Error('Te groot'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error('Ongeldige JSON'), { status: 400 })); } });
  });
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Niet gevonden');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/status', async () => ({
  ...(await git.status()),
  aiEnabled: !!cfg.anthropicApiKey,
  model: cfg.model,
  dataDir: cfg.dataDir,
  keyFile: cfg.keyFile,
  keyCreatedNow: keyCreated,
  ...(await updater.version())
}));

// ---------- updates van de app zelf ----------
route('GET', '/api/update', async () => updater.check());
route('POST', '/api/update', async () => {
  const r = await updater.apply();
  // Na het antwoord stoppen met code 42: de launcher start dan de nieuwe versie.
  if (r.updated) setTimeout(() => process.exit(42), 300);
  return r;
});

route('GET', '/api/spaces', async () => store.listSpaces());

route('POST', '/api/spaces', async (p, body) => {
  const s = store.createSpace(body.type, body.name);
  await git.commit(`Nieuwe ruimte: ${s.type}/${s.slug}`);
  return s;
});

route('GET', '/api/spaces/:type/:slug', async ({ type, slug }) => ({
  type, slug, meta: store.getMeta(type, slug), entries: store.listEntries(type, slug),
  defaultTemplate: store.defaultTemplate(type)
}));

route('PUT', '/api/spaces/:type/:slug', async ({ type, slug }, body) => {
  const meta = store.updateMeta(type, slug, body);
  await git.commit(`Ruimte bijgewerkt: ${type}/${slug}`);
  return meta;
});

route('POST', '/api/spaces/:type/:slug/entries', async ({ type, slug }, body) => {
  const e = store.addEntry(type, slug, body);
  await git.commit(`${e.kind === 'vraag' ? 'Vraag' : 'Gedachte'} toegevoegd: ${type}/${slug}`);
  return e;
});

route('PUT', '/api/spaces/:type/:slug/entries/:id', async ({ type, slug, id }, body) => {
  const e = store.updateEntry(type, slug, id, body);
  await git.commit(`Bijgewerkt: ${type}/${slug}/${id}`);
  return e;
});

route('POST', '/api/spaces/:type/:slug/ai/questions', async ({ type, slug }) => {
  const meta = store.getMeta(type, slug);
  const entries = store.listEntries(type, slug);
  const text = await ai.callClaude(cfg, ai.buildQuestionPrompt(meta, entries), 600);
  const questions = ai.parseQuestions(text);
  if (!questions.length) throw Object.assign(new Error('De AI gaf geen bruikbare vragen terug.'), { status: 502 });
  const created = questions.map(q => store.addEntry(type, slug, { kind: 'vraag', question: q, source: 'ai' }));
  await git.commit(`AI-vragen toegevoegd: ${type}/${slug}`);
  return created;
});

route('POST', '/api/spaces/:type/:slug/prompt', async ({ type, slug }, body) => {
  const p = ai.buildDocumentPrompt(store.getMeta(type, slug), store.listEntries(type, slug), body);
  return { prompt: `${p.system}\n\n---\n\n${p.user}`, count: p.count };
});

route('POST', '/api/spaces/:type/:slug/ai/document', async ({ type, slug }, body) => {
  const p = ai.buildDocumentPrompt(store.getMeta(type, slug), store.listEntries(type, slug), body);
  if (!p.count) throw Object.assign(new Error('Er zijn geen gedachten in deze periode.'), { status: 400 });
  const content = await ai.callClaude(cfg, p, 8000);
  const doc = store.saveDoc(type, slug, { kind: 'ruw', title: body.title, from: body.from, to: body.to, content, generatedBy: cfg.model });
  await git.commit(`Ruwe versie gegenereerd: ${type}/${slug}`);
  return doc;
});

route('GET', '/api/spaces/:type/:slug/documents', async ({ type, slug }) => store.listDocs(type, slug));
route('GET', '/api/spaces/:type/:slug/documents/:id', async ({ type, slug, id }) => store.getDoc(type, slug, id));

route('POST', '/api/spaces/:type/:slug/documents', async ({ type, slug }, body) => {
  const doc = store.saveDoc(type, slug, body);
  await git.commit(`Document opgeslagen (${doc.kind}): ${type}/${slug}`);
  return doc;
});

route('PUT', '/api/spaces/:type/:slug/documents/:id', async ({ type, slug, id }, body) => {
  const doc = store.updateDoc(type, slug, id, body);
  await git.commit(`Document bijgewerkt: ${type}/${slug}/${id}`);
  return doc;
});

route('POST', '/api/sync', async () => git.sync());

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  for (const r of routes) {
    const m = r.method === req.method && url.pathname.match(r.re);
    if (!m) continue;
    try {
      const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      return send(res, 200, await r.handler(params, body));
    } catch (e) {
      if (!e.status) console.error(e);
      return send(res, e.status || 500, { error: e.message });
    }
  }
  send(res, 404, { error: 'Onbekende route' });
});

(async () => {
  await git.ensureRepo();
  const renamed = store.migrateFolderNames();
  if (renamed) {
    await git.commit('Mapnamen vervangen door willekeurige codes');
    console.log(`  ${renamed} map(pen) hernoemd naar een willekeurige code, zodat namen niet meer leesbaar zijn.`);
  }
  if (cfg.autoSyncMinutes > 0) {
    setInterval(() => git.sync().catch(e => console.warn('Auto-sync mislukt:', e.message)), cfg.autoSyncMinutes * 60e3);
  }
  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`\n  Leerjournaal draait op http://localhost:${cfg.port}\n`);
    console.log(`  Data:    ${cfg.dataDir}`);
    console.log(`  Sleutel: ${cfg.keyFile}`);
    if (keyCreated) console.log('\n  ⚠  Er is een NIEUWE sleutel gemaakt. Maak er nu een back-up van (iCloud of wachtwoordmanager)!');
    if (!cfg.anthropicApiKey) console.log('\n  ℹ  Geen API-sleutel ingesteld: AI-knoppen werken via "Kopieer prompt".');
    console.log('');
  });
})().catch(e => { console.error('Starten mislukt:', e.message); process.exit(1); });
