#!/usr/bin/env node
// Leerjournaal – lokale server. Geen externe packages nodig (Node 18+).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { loadKeyring, loadExtraKeys, parseKey, keyId } = require('./lib/crypto');
const { Store } = require('./lib/store');
const { Git } = require('./lib/git');
const ai = require('./lib/ai');
const { Updater } = require('./lib/updater');
const { markdownToDocx, markdownToText } = require('./lib/docx');

const cfg = loadConfig();
// Sleutels en opslag worden pas geladen als de poort vrij is (zie start onderaan),
// zodat een tweede kopie van de app nooit aan je data of sleutels komt.
let ring, keyCreated, keyDir, store;
let markReady;
const ready = new Promise(r => (markReady = r));
const git = new Git(cfg.dataDir);
const updater = new Updater(cfg.appDir);

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

// Bestandsnaam voor downloads: titel + datum, zonder vreemde tekens.
function fileName(doc) {
  const t = String(doc.title || 'document').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'document';
  return `${t}_${(doc.createdAt || '').slice(0, 10)}${doc.kind === 'eind' ? '_eind' : doc.kind === 'ruw' ? '_ruw' : ''}`;
}
const file = (name, type, body) => ({ __file: true, name, type, body });

function send(res, status, body) {
  if (body && body.__file) {
    res.writeHead(status, {
      'content-type': body.type, 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${body.name.replace(/"/g, '')}"`
    });
    return res.end(body.body);
  }
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

// ---------- sleutels ----------
route('GET', '/api/keys', async () => {
  loadExtraKeys(ring, cfg, true); // pakt sleutels op die net met "npm run sleutels" zijn toegevoegd
  const stats = store.keyStats();
  return {
    keyDir, primaryId: ring.primaryId,
    keys: ring.list().map(k => ({ ...k, files: stats.perKey[k.id] || 0 })),
    total: stats.total, unreadable: stats.unreadable,
    missing: Object.entries(stats.missing).map(([id, files]) => ({ id, files }))
  };
});

route('POST', '/api/keys', async (p, body) => {
  const key = parseKey(body.key);
  const id = keyId(key);
  if (ring.keys.some(k => k.id === id)) return { id, added: false, message: 'Deze sleutel stond er al in.' };
  const file = path.join(keyDir, `oud-${id}.key`);
  fs.writeFileSync(file, key.toString('base64') + '\n', { mode: 0o600 });
  ring.add(key, path.basename(file));
  return { id, added: true, file };
});

route('POST', '/api/keys/rekey', async () => {
  const r = store.rekey();
  if (r.changed) await git.commit('Bestanden opnieuw versleuteld met de huidige sleutel');
  return r;
});

// ---------- updates van de app zelf ----------
route('GET', '/api/update', async () => updater.check());
route('POST', '/api/update', async () => {
  const r = await updater.apply();
  // Na het antwoord stoppen met code 42: de launcher start dan de nieuwe versie.
  if (r.updated) setTimeout(() => process.exit(42), 300);
  return r;
});

route('GET', '/api/search', async (p, b, url) => ({ query: url.searchParams.get('q') || '', results: store.search(url.searchParams.get('q') || '') }));
route('GET', '/api/documents', async () => store.allDocs());

route('GET', '/api/spaces', async () => { loadExtraKeys(ring, cfg, true); return store.listSpaces(); });

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
  const what = typeof body.archived === 'boolean' ? (body.archived ? 'gearchiveerd' : 'uit archief gehaald') : 'bijgewerkt';
  await git.commit(`Ruimte ${what}: ${type}/${slug}`);
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

// Verwijderen van één of meer gedachten/vragen: { ids: [...] }
route('POST', '/api/spaces/:type/:slug/entries/delete', async ({ type, slug }, body) => {
  const r = store.deleteEntries(type, slug, body.ids);
  if (r.deleted) await git.commit(`${r.deleted === 1 ? 'Gedachte' : r.deleted + ' gedachten'} verwijderd: ${type}/${slug}`);
  return r;
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

// Een document als bestand: md (Markdown), txt (platte tekst) of docx (Word).
route('GET', '/api/spaces/:type/:slug/documents/:id/export/:format', async ({ type, slug, id, format }) => {
  const doc = store.getDoc(type, slug, id);
  const name = fileName(doc);
  if (format === 'md') return file(`${name}.md`, 'text/markdown; charset=utf-8', doc.content);
  if (format === 'txt') return file(`${name}.txt`, 'text/plain; charset=utf-8', markdownToText(doc.content));
  if (format === 'docx') return file(`${name}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', markdownToDocx(doc.content, doc.title));
  throw Object.assign(new Error('Onbekend formaat'), { status: 400 });
});

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

// Een nieuwere versie van de app kan een oude, nog draaiende versie netjes laten stoppen.
route('POST', '/api/shutdown', async () => {
  console.log('\n  Een nieuwere Leerjournaal neemt het over. Deze stopt nu.\n');
  setTimeout(() => process.exit(0), 200);
  return { ok: true };
});

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  // Beveiliging: alleen de eigen pagina mag de API gebruiken. Andere websites kunnen deze header
  // niet meesturen zonder toestemming, en de Host-check blokkeert DNS-rebinding.
  const host = String(req.headers.host || '');
  if (![`localhost:${cfg.port}`, `127.0.0.1:${cfg.port}`].includes(host) || req.headers['x-leerjournaal'] !== '1') {
    return send(res, 403, { error: 'Niet toegestaan' });
  }
  await ready;
  for (const r of routes) {
    const m = r.method === req.method && url.pathname.match(r.re);
    if (!m) continue;
    try {
      const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      return send(res, 200, await r.handler(params, body, url));
    } catch (e) {
      if (!e.status) console.error(e);
      return send(res, e.status || 500, { error: e.message });
    }
  }
  send(res, 404, { error: 'Onbekende route' });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

function claimPort() {
  return new Promise((resolve, reject) => {
    const onError = e => { server.off('listening', onListen); reject(e); };
    const onListen = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen(cfg.port, '127.0.0.1');
  });
}

// De poort is bezet. Is het een (oudere) Leerjournaal? Dan vragen we die om te stoppen.
async function handleBusyPort() {
  const base = `http://127.0.0.1:${cfg.port}`;
  const headers = { 'x-leerjournaal': '1' };
  let status = null;
  try {
    const r = await fetch(`${base}/api/status`, { headers, signal: AbortSignal.timeout(2000) });
    if (r.ok) status = await r.json();
  } catch {}
  if (!status) {
    console.error(`\n  Poort ${cfg.port} is bezet door een ander programma.`);
    console.error(`  Zet in config.json bijvoorbeeld  "port": ${cfg.port + 1}  en start opnieuw.\n`);
    process.exit(1);
  }
  const which = status.version ? `versie ${status.version}` : 'een oudere versie';
  try {
    const r = await fetch(`${base}/api/shutdown`, { method: 'POST', headers, signal: AbortSignal.timeout(2000) });
    if (r.ok) { console.log(`  Er draaide al een Leerjournaal (${which}); die is gestopt.`); return; }
  } catch {}
  console.error(`\n  Er draait al een Leerjournaal (${which}) op poort ${cfg.port}, en die kan niet zelf stoppen.`);
  console.error('  Sluit het terminalvenster van die versie, of stop hem met:');
  console.error(`\n      lsof -ti tcp:${cfg.port} | xargs kill\n`);
  console.error('  Start daarna deze versie opnieuw.\n');
  process.exit(1);
}

(async () => {
  try {
    await claimPort();
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    await handleBusyPort();
    for (let i = 0; ; i++) {
      await sleep(500);
      try { await claimPort(); break; } catch (err) { if (err.code !== 'EADDRINUSE' || i >= 10) throw err; }
    }
  }

  ({ ring, created: keyCreated, keyDir } = loadKeyring(cfg));
  store = new Store(cfg.dataDir, ring);
  await git.ensureRepo();
  const renamed = store.migrateFolderNames();
  if (renamed) {
    await git.commit('Mapnamen vervangen door willekeurige codes');
    console.log(`  ${renamed} map(pen) hernoemd naar een willekeurige code, zodat namen niet meer leesbaar zijn.`);
  }
  if (cfg.autoSync) {
    git.enableAutoSync();
    git.scheduleSync(1500); // wijzigingen die nog niet op GitHub staan meteen uploaden
  }
  if (cfg.autoSyncMinutes > 0) {
    setInterval(() => git.backgroundSync(), cfg.autoSyncMinutes * 60e3);
  }
  markReady();
  console.log(`\n  Leerjournaal draait op http://localhost:${cfg.port}\n`);
  console.log(`  Data:    ${cfg.dataDir}`);
  console.log(`  Sleutel: ${cfg.keyFile}`);
  if (ring.keys.length > 1) console.log(`  + ${ring.keys.length - 1} oude sleutel(s) om oudere bestanden te lezen`);
  if (keyCreated) console.log('\n  ⚠  Er is een NIEUWE sleutel gemaakt. Maak er nu een back-up van (iCloud of wachtwoordmanager)!');
  if (!cfg.anthropicApiKey) console.log('\n  ℹ  Geen API-sleutel ingesteld: AI-knoppen werken via "Kopieer prompt".');
  console.log('');
})().catch(e => { console.error('Starten mislukt:', e.message); process.exit(1); });
