#!/usr/bin/env node
// Leerjournaal – lokale server. Geen externe packages nodig (Node 18+).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveUiSettings } = require('./lib/config');
const { loadKeyring, loadExtraKeys, parseKey, keyId } = require('./lib/crypto');
const { Store } = require('./lib/store');
const { Git } = require('./lib/git');
const ai = require('./lib/ai');
const { Updater } = require('./lib/updater');
const { markdownToDocx, markdownToText } = require('./lib/docx');
const { GitHubAuth } = require('./lib/github');
const { makeAdapter } = require('./lib/connectors');
const boardSync = require('./lib/sync');
const { extractText } = require('./lib/extract');
const providers = require('./lib/providers');

const cfg = loadConfig();
// Sleutels en opslag worden pas geladen als de poort vrij is (zie start onderaan),
// zodat een tweede kopie van de app nooit aan je data of sleutels komt.
let ring, keyCreated, keyDir, store;
let markReady;
const ready = new Promise(r => (markReady = r));
const git = new Git(cfg.dataDir);
const updater = new Updater(cfg.appDir);
const github = new GitHubAuth(cfg.appDir, cfg);
git.netArgs = () => github.gitArgs();

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

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
      // ASCII-naam voor oude programma's, plus de echte naam (met accenten) volgens RFC 5987.
      'content-disposition': `attachment; filename="${body.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(body.name)}`
    });
    return res.end(body.body);
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 30e6) { reject(Object.assign(new Error('Te groot'), { status: 413 })); req.destroy(); } });
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
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/status', async () => ({
  ...(await git.status()),
  aiEnabled: providers.list(cfg).length > 0,
  ais: providers.list(cfg).map(p => ({ id: p.id, label: p.label, model: p.model })),
  aiActive: (providers.list(cfg).find(p => p.id === cfg.aiActive) || providers.list(cfg)[0])?.id || null,
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

// Snel een gedachte toevoegen, bijvoorbeeld vanuit een iPhone-opdracht (Shortcut) of Siri.
// Body: { "text": "...", "chat": "naam van een chat of project (optioneel)" }
const QUICK_CHAT = 'Snelle gedachten';
route('POST', '/api/quick', async (p, body) => {
  const text = String(body.text || '').trim();
  if (!text) throw Object.assign(new Error('Lege gedachte'), { status: 400 });
  const want = String(body.chat || QUICK_CHAT).trim().toLowerCase();
  let sp = store.listSpaces().find(s => !s.locked && String(s.name).toLowerCase() === want);
  if (!sp) sp = store.createSpace('chats', body.chat ? String(body.chat).trim() : QUICK_CHAT);
  const e = store.addEntry(sp.type, sp.slug, { kind: 'gedachte', text });
  await git.commit(`Gedachte toegevoegd: ${sp.type}/${sp.slug}`);
  return { ok: true, chat: sp.name, id: e.id };
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

route('POST', '/api/spaces/:type/:slug/entries/move', async ({ type, slug }, body) => {
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 2000) : [];
  const moved = ids.map(id => store.updateEntry(type, slug, id, { thread: String(body.thread || '') }));
  await git.commit(`${moved.length} berichten verplaatst: ${type}/${slug}`);
  return { moved: moved.length };
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

route('POST', '/api/spaces/:type/:slug/ai/questions', async ({ type, slug }, body = {}) => {
  const meta = store.getMeta(type, slug);
  // In een project met chats: vragen over (en in) de gekozen chat.
  const known = new Set((meta.threads || []).map(t => t.id));
  const thread = known.has(body.thread) ? body.thread : '';
  const entries = store.listEntries(type, slug).filter(e => !known.size || (known.has(e.thread) ? e.thread : '') === thread);
  const text = await providers.complete(providers.pick(cfg, body.ai), ai.buildQuestionPrompt(meta, entries), 600);
  const questions = ai.parseQuestions(text);
  if (!questions.length) throw Object.assign(new Error('De AI gaf geen bruikbare vragen terug.'), { status: 502 });
  const created = questions.map(q => store.addEntry(type, slug, { kind: 'vraag', question: q, source: 'ai', thread }));
  await git.commit(`AI-vragen toegevoegd: ${type}/${slug}`);
  return created;
});

route('POST', '/api/spaces/:type/:slug/prompt', async ({ type, slug }, body) => {
  const p = ai.buildDocumentPrompt(store.getMeta(type, slug), store.listEntries(type, slug), body, type === 'projecten' ? store.listFeedback(type, slug) : [], cfg.docDates);
  return { prompt: `${p.system}\n\n---\n\n${p.user}`, count: p.count };
});

route('POST', '/api/spaces/:type/:slug/ai/document', async ({ type, slug }, body) => {
  const p = ai.buildDocumentPrompt(store.getMeta(type, slug), store.listEntries(type, slug), body, type === 'projecten' ? store.listFeedback(type, slug) : [], cfg.docDates);
  if (!p.count) throw Object.assign(new Error('Er zijn geen gedachten in deze periode.'), { status: 400 });
  const prov = providers.pick(cfg, body.ai);
  const content = await providers.complete(prov, p, 8000);
  const doc = store.saveDoc(type, slug, { kind: 'ruw', title: body.title, from: body.from, to: body.to, content, generatedBy: `${prov.label} · ${prov.model}` });
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

// Bestand uploaden (base64 in JSON). Origineel blijft bewaard; de tekst wordt leesbaar en doorzoekbaar.
route('POST', '/api/spaces/:type/:slug/documents/upload', async ({ type, slug }, body) => {
  const data = String(body.data || '');
  if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) throw Object.assign(new Error('Geen bestand ontvangen.'), { status: 400 });
  const buf = Buffer.from(data, 'base64');
  if (buf.length > 20 * 1024 * 1024) throw Object.assign(new Error('Dit bestand is groter dan 20 MB.'), { status: 413 });
  const { text, note } = extractText(body.name || '', buf);
  const doc = store.saveUpload(type, slug, { name: body.name, mime: body.mime, data: buf.toString('base64'), title: body.title, text, note });
  await git.commit(`Bestand geüpload: ${type}/${slug}`);
  return doc;
});
route('GET', '/api/spaces/:type/:slug/documents/:id/file', async ({ type, slug, id }) => {
  const f = store.getUploadFile(type, slug, id);
  return file(f.fileName, f.mime, f.body);
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

// ---------- kanban ----------
// Bordacties per project na elkaar uitvoeren, zodat verversen en bewerken elkaar niet overschrijven.
const boardLocks = new Map();
function withBoard(type, slug, fn) {
  const k = `${type}/${slug}`;
  const p = (boardLocks.get(k) || Promise.resolve()).then(fn, fn);
  boardLocks.set(k, p.catch(() => {}));
  return p;
}
function adapterFor(board) {
  const creds = store.getConnections()[board.link.kind];
  if (!creds) throw Object.assign(new Error(`Er is nog geen ${board.link.kind === 'jira' ? 'Jira' : 'Trello'}-account ingesteld (Instellingen → Koppelingen).`), { status: 400 });
  return makeAdapter(board.link.kind, creds);
}
// Na een lokale wijziging op een gekoppeld bord: die kaart meteen naar Trello/Jira sturen.
async function pushCard(type, slug, cardId) {
  const b = store.getBoard(type, slug);
  if (!b.link) return { board: b, summary: null };
  const summary = await boardSync.push(b, adapterFor(b), undefined, cardId);
  store.saveBoard(type, slug, b);
  return { board: b, summary };
}

route('GET', '/api/spaces/:type/:slug/board', async ({ type, slug }) => store.getBoard(type, slug));
route('POST', '/api/spaces/:type/:slug/board/cards', async ({ type, slug }, body) => withBoard(type, slug, async () => {
  const c = store.addCard(type, slug, body);
  const r = await pushCard(type, slug, c.id).catch(e => ({ error: e.message }));
  await git.commit(`Kaart toegevoegd: ${type}/${slug}`);
  return { card: c, ...r };
}));
route('PUT', '/api/spaces/:type/:slug/board/cards/:id', async ({ type, slug, id }, body) => withBoard(type, slug, async () => {
  const c = store.updateCard(type, slug, id, body);
  const r = await pushCard(type, slug, c.id).catch(e => ({ error: e.message }));
  await git.commit(`Kaart bijgewerkt: ${type}/${slug}`);
  return { card: c, ...r };
}));
route('DELETE', '/api/spaces/:type/:slug/board/cards/:id', async ({ type, slug, id }) => withBoard(type, slug, async () => {
  const b = store.getBoard(type, slug);
  const card = b.cards.find(c => c.id === id);
  if (b.link && card?.remote) await adapterFor(b).archiveCard(b.link.target, card.remote.id); // Trello: archiveren; Jira: weigert
  const r = store.deleteCard(type, slug, id); await git.commit(`Kaart verwijderd: ${type}/${slug}`); return r;
}));

// Kolom toevoegen: lokaal, of als lijst in Trello (Jira-kolommen pas je in Jira aan).
route('POST', '/api/spaces/:type/:slug/board/columns', async ({ type, slug }, body) => withBoard(type, slug, async () => {
  const name = String(body.name || '').trim().slice(0, 60);
  if (!name) throw Object.assign(new Error('Geef de kolom een naam.'), { status: 400 });
  const b = store.getBoard(type, slug);
  if (b.columns.some(c => c.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error(`Er is al een kolom “${name}”.`), { status: 409 });
  const col = b.link ? await adapterFor(b).addColumn(b.link.target, name) : { id: require('crypto').randomBytes(4).toString('hex'), name };
  b.columns.push(col);
  store.saveBoard(type, slug, b); await git.commit(`Kolom toegevoegd: ${type}/${slug}`);
  return { board: b };
}));

// Koppelen, verversen, conflicten
route('POST', '/api/spaces/:type/:slug/board/link', async ({ type, slug }, body) => withBoard(type, slug, async () => {
  const kind = body.kind === 'jira' ? 'jira' : 'trello';
  const creds = store.getConnections()[kind];
  if (!creds) throw Object.assign(new Error(`Stel eerst je ${kind === 'jira' ? 'Jira' : 'Trello'}-account in (Instellingen → Koppelingen).`), { status: 400 });
  const adapter = makeAdapter(kind, creds);
  const target = (await adapter.listTargets()).find(t => t.id === body.targetId);
  if (!target) throw Object.assign(new Error('Dat bord of project is niet gevonden.'), { status: 404 });
  const b = boardSync.link(store.getBoard(type, slug), kind, target, !!body.sendExisting);
  const summary = await boardSync.refresh(b, adapter);
  store.saveBoard(type, slug, b);
  await git.commit(`Kanban gekoppeld: ${type}/${slug}`);
  return { board: b, summary };
}));
route('DELETE', '/api/spaces/:type/:slug/board/link', async ({ type, slug }) => withBoard(type, slug, async () => {
  const b = boardSync.unlink(store.getBoard(type, slug));
  store.saveBoard(type, slug, b); await git.commit(`Kanban ontkoppeld: ${type}/${slug}`);
  return { board: b };
}));
route('POST', '/api/spaces/:type/:slug/board/refresh', async ({ type, slug }) => withBoard(type, slug, async () => {
  const b = store.getBoard(type, slug);
  if (!b.link) return { board: b, summary: null };
  try {
    const summary = await boardSync.refresh(b, adapterFor(b));
    store.saveBoard(type, slug, b); await git.commit(`Kanban ververst: ${type}/${slug}`);
    return { board: b, summary };
  } catch (e) {
    b.link.lastError = e.message; store.saveBoard(type, slug, b);
    throw e;
  }
}));
route('POST', '/api/spaces/:type/:slug/board/conflicts', async ({ type, slug }, body) => withBoard(type, slug, async () => {
  const b = store.getBoard(type, slug);
  const card = boardSync.resolve(b, body.cardId, body.field, body.choice === 'theirs' ? 'theirs' : 'mine');
  store.saveBoard(type, slug, b);
  const r = card ? await pushCard(type, slug, card.id).catch(e => ({ error: e.message })) : {};
  await git.commit(`Kanban-conflict opgelost: ${type}/${slug}`);
  return { board: store.getBoard(type, slug), ...r };
}));

// ---------- koppelingen (accounts) ----------
route('GET', '/api/connections', async () => {
  const c = store.getConnections();
  return {
    trello: c.trello ? { configured: true, name: c.trello.name } : { configured: false },
    jira: c.jira ? { configured: true, name: c.jira.name, site: c.jira.site, email: c.jira.email } : { configured: false }
  };
});
route('PUT', '/api/connections/:kind', async ({ kind }, body) => {
  const str = v => String(v || '').trim();
  let creds;
  if (kind === 'trello') {
    creds = { key: str(body.key), token: str(body.token) };
    if (!creds.key || !creds.token) throw Object.assign(new Error('Vul de API-sleutel en het token in.'), { status: 400 });
  } else if (kind === 'jira') {
    creds = { site: str(body.site).replace(/^https?:\/\//, '').replace(/\/.*$/, ''), email: str(body.email), token: str(body.token) };
    if (/^http:\/\/(127\.0\.0\.1|localhost)/.test(str(body.site))) creds.site = str(body.site); // alleen voor tests
    if (!creds.site || !creds.email || !creds.token) throw Object.assign(new Error('Vul de site, je e-mail en het API-token in.'), { status: 400 });
  } else throw Object.assign(new Error('Onbekende koppeling'), { status: 400 });
  creds.name = await makeAdapter(kind, creds).whoami(); // test meteen of het werkt
  const all = store.getConnections(); all[kind] = creds; store.saveConnections(all);
  await git.commit('Koppeling bijgewerkt');
  return { configured: true, name: creds.name };
});
route('DELETE', '/api/connections/:kind', async ({ kind }) => {
  const all = store.getConnections(); delete all[kind]; store.saveConnections(all);
  await git.commit('Koppeling verwijderd'); return { configured: false };
});
route('GET', '/api/connections/:kind/targets', async ({ kind }) => {
  const creds = store.getConnections()[kind];
  if (!creds) throw Object.assign(new Error('Nog geen account ingesteld.'), { status: 400 });
  return makeAdapter(kind, creds).listTargets();
});

// ---------- feedback ----------
route('GET', '/api/spaces/:type/:slug/feedback', async ({ type, slug }) => store.listFeedback(type, slug));
route('POST', '/api/spaces/:type/:slug/feedback', async ({ type, slug }, body) => {
  const f = store.saveFeedback(type, slug, body); await git.commit(`Feedback toegevoegd: ${type}/${slug}`); return f;
});
route('PUT', '/api/spaces/:type/:slug/feedback/:id', async ({ type, slug, id }, body) => {
  const f = store.saveFeedback(type, slug, body, id); await git.commit(`Feedback bijgewerkt: ${type}/${slug}`); return f;
});
route('DELETE', '/api/spaces/:type/:slug/feedback/:id', async ({ type, slug, id }) => {
  const r = store.deleteFeedback(type, slug, id); await git.commit(`Feedback verwijderd: ${type}/${slug}`); return r;
});

route('POST', '/api/sync', async () => git.sync());

// ---------- instellingen ----------
const THEMES = ['dark', 'light', 'night', 'sepia', 'forest', 'ocean'];
const publicSettings = () => ({
  theme: cfg.theme, features: cfg.features, autoSync: !!cfg.autoSync, autoSyncMinutes: cfg.autoSyncMinutes,
  model: cfg.model, hasApiKey: providers.list(cfg).length > 0, themes: THEMES, docDates: cfg.docDates || 'dag'
});
route('GET', '/api/settings', async () => publicSettings());
route('PUT', '/api/settings', async (p, body) => {
  const patch = {};
  if (THEMES.includes(body.theme)) patch.theme = body.theme;
  if (body.features && typeof body.features === 'object') {
    patch.features = { ...cfg.features };
    for (const k of ['kanban', 'feedback', 'aiButtons']) if (typeof body.features[k] === 'boolean') patch.features[k] = body.features[k];
  }
  if (typeof body.autoSync === 'boolean') patch.autoSync = body.autoSync;
  if (Number.isFinite(body.autoSyncMinutes)) patch.autoSyncMinutes = Math.max(0, Math.min(1440, Math.round(body.autoSyncMinutes)));
  if (typeof body.model === 'string' && /^[\w.:-]{3,80}$/.test(body.model.trim())) patch.model = body.model.trim();
  if (typeof body.anthropicApiKey === 'string') patch.anthropicApiKey = body.anthropicApiKey.trim();
  if (['geen', 'dag', 'dag-tijd'].includes(body.docDates)) patch.docDates = body.docDates;
  saveUiSettings(patch);
  Object.assign(cfg, patch);
  applySyncSettings();
  return publicSettings();
});

// ---------- AI-aanbieders ----------
const aiView = () => ({
  providers: providers.list(cfg).map(providers.publicView),
  active: (providers.list(cfg).find(p => p.id === cfg.aiActive) || providers.list(cfg)[0])?.id || null,
  kinds: Object.fromEntries(Object.entries(providers.KINDS).map(([k, v]) => [k, { label: v.label, needsKey: v.needsKey, keyUrl: v.keyUrl, base: v.base }]))
});
function saveProviders(list, extra = {}) {
  const patch = { aiProviders: list, ...extra };
  saveUiSettings(patch); Object.assign(cfg, patch);
}
route('GET', '/api/ai', async () => aiView());
// Modellen ophalen (ook als test van de sleutel). Met id: van een bestaande aanbieder.
route('POST', '/api/ai/models', async (p, body) => {
  const old = providers.list(cfg).find(x => x.id === body.id) || {};
  const prov = { ...old, provider: body.provider || old.provider, apiKey: (body.apiKey || '').trim() || old.apiKey, baseUrl: body.baseUrl ?? old.baseUrl, label: providers.KINDS[body.provider || old.provider]?.label || 'AI' };
  if (!providers.KINDS[prov.provider]) throw Object.assign(new Error('Kies een AI-aanbieder.'), { status: 400 });
  if (providers.KINDS[prov.provider].needsKey && !prov.apiKey) throw Object.assign(new Error('Vul eerst de API-sleutel in.'), { status: 400 });
  return { models: await providers.models(prov) };
});
route('POST', '/api/ai/providers', async (p, body) => {
  const prov = providers.clean(body);
  await providers.models(prov); // test: werkt de sleutel?
  const list = providers.list(cfg);
  saveProviders([...list, prov], list.length ? {} : { aiActive: prov.id });
  return aiView();
});
route('PUT', '/api/ai/providers/:id', async ({ id }, body) => {
  const list = providers.list(cfg);
  const i = list.findIndex(x => x.id === id);
  if (i < 0) throw Object.assign(new Error('Deze AI bestaat niet meer.'), { status: 404 });
  const prov = providers.clean(body, list[i]);
  if (body.apiKey || body.baseUrl !== undefined) await providers.models(prov);
  list[i] = prov; saveProviders(list);
  return aiView();
});
route('DELETE', '/api/ai/providers/:id', async ({ id }) => {
  const list = providers.list(cfg).filter(x => x.id !== id);
  // De oude losse sleutel ook leegmaken, anders komt "Claude" vanzelf terug.
  saveProviders(list, id === 'claude' ? { anthropicApiKey: '' } : {});
  return aiView();
});
route('PUT', '/api/ai/active', async (p, body) => {
  if (!providers.list(cfg).some(x => x.id === body.id)) throw Object.assign(new Error('Deze AI bestaat niet.'), { status: 404 });
  saveUiSettings({ aiActive: body.id }); cfg.aiActive = body.id;
  return aiView();
});

// ---------- inloggen bij GitHub ----------
route('GET', '/api/github', async () => ({ ...github.status(), remote: (await git.remoteUrl()) || null }));
route('POST', '/api/github/token', async (p, body) => {
  const token = String(body.token || '').trim();
  if (!/^(github_pat_|ghp_|gho_)[A-Za-z0-9_]{20,}$/.test(token)) throw Object.assign(new Error('Dit lijkt geen GitHub-token. Het begint meestal met github_pat_.'), { status: 400 });
  const login = await github.verify(token);
  const repo = await github.checkRepo(token, await git.remoteUrl());
  if (repo && !repo.ok) throw Object.assign(new Error(repo.message), { status: 400 });
  github.save(token, login, 'token');
  git.lastSyncError = null; git.scheduleSync(500);
  return { ...github.status(), repo: repo?.repo || null };
});
route('POST', '/api/github/device', async () => github.deviceStart());
route('POST', '/api/github/device/poll', async () => {
  const r = await github.devicePoll();
  if (r.state === 'klaar') { git.lastSyncError = null; git.scheduleSync(500); }
  return r;
});
route('DELETE', '/api/github', async () => { github.logout(); return github.status(); });

// ---------- templatebibliotheek ----------
route('GET', '/api/templates', async () => store.listTemplates());
route('POST', '/api/templates', async (p, body) => { const t = store.saveTemplate(body); await git.commit('Template opgeslagen'); return t; });
route('PUT', '/api/templates/:id', async ({ id }, body) => { const t = store.saveTemplate(body, id); await git.commit('Template bijgewerkt'); return t; });
route('DELETE', '/api/templates/:id', async ({ id }) => { const r = store.deleteTemplate(id); await git.commit('Template verwijderd'); return r; });

// Een nieuwere versie van de app kan een oude, nog draaiende versie netjes laten stoppen.
route('POST', '/api/shutdown', async () => {
  console.log('\n  Een nieuwere Leerjournaal neemt het over. Deze stopt nu.\n');
  setTimeout(() => process.exit(0), 200);
  return { ok: true };
});

// ---------- toegang ----------
// Toegestaan: localhost, je eigen Tailscale-adres (*.ts.net) en wat in allowedHosts staat.
// De server luistert alleen op 127.0.0.1; Tailscale Serve stuurt verkeer van je telefoon door.
const TS_HOST_RE = /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net(:\d+)?$/i;
const hostName = req => String(req.headers.host || '').toLowerCase();
function isRemoteHost(req) {
  const h = hostName(req);
  return h !== `localhost:${cfg.port}` && h !== `127.0.0.1:${cfg.port}`;
}
function hostAllowed(req) {
  const h = hostName(req);
  if (!isRemoteHost(req)) return true;
  if (TS_HOST_RE.test(h)) return true;
  return (cfg.allowedHosts || []).map(x => String(x).toLowerCase()).some(x => h === x || h.split(':')[0] === x);
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  // Beveiliging: alleen de eigen pagina mag de API gebruiken. Andere websites kunnen deze header
  // niet meesturen zonder toestemming, en de Host-check blokkeert DNS-rebinding.
  if (!hostAllowed(req) || req.headers['x-leerjournaal'] !== '1') {
    return send(res, 403, { error: 'Niet toegestaan' });
  }
  // Via Tailscale Serve: alleen de accounts uit tailscaleUsers (als die lijst is ingevuld).
  const tsUser = req.headers['tailscale-user-login'];
  if ((cfg.tailscaleUsers || []).length && isRemoteHost(req) && !cfg.tailscaleUsers.includes(String(tsUser || '').toLowerCase())) {
    return send(res, 403, { error: 'Dit Tailscale-account heeft geen toegang' });
  }
  await ready;
  for (const r of routes) {
    const m = r.method === req.method && url.pathname.match(r.re);
    if (!m) continue;
    try {
      const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      return send(res, 200, await r.handler(params, body, url));
    } catch (e) {
      if (!e.status) console.error(e);
      return send(res, e.status || 500, { error: e.message });
    }
  }
  send(res, 404, { error: 'Onbekende route' });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Automatisch uploaden aan/uit en het interval; ook aangeroepen als je Instellingen wijzigt.
let syncInterval = null;
function applySyncSettings() {
  if (cfg.autoSync) git.enableAutoSync(); else git.disableAutoSync();
  clearInterval(syncInterval); syncInterval = null;
  if (cfg.autoSyncMinutes > 0) syncInterval = setInterval(() => git.backgroundSync(), cfg.autoSyncMinutes * 60e3);
}

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
  applySyncSettings();
  if (cfg.autoSync) git.scheduleSync(1500); // wijzigingen die nog niet op GitHub staan meteen uploaden
  markReady();
  console.log(`\n  Leerjournaal draait op http://localhost:${cfg.port}\n`);
  console.log(`  Data:    ${cfg.dataDir}`);
  console.log(`  Sleutel: ${cfg.keyFile}`);
  if (ring.keys.length > 1) console.log(`  + ${ring.keys.length - 1} oude sleutel(s) om oudere bestanden te lezen`);
  if (keyCreated) console.log('\n  ⚠  Er is een NIEUWE sleutel gemaakt. Maak er nu een back-up van (iCloud of wachtwoordmanager)!');
  if (!providers.list(cfg).length) console.log('\n  ℹ  Geen AI ingesteld: AI-knoppen werken via "Kopieer prompt" (of stel een AI in onder Instellingen → AI).');
  console.log('');
})().catch(e => { console.error('Starten mislukt:', e.message); process.exit(1); });
