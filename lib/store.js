// Opslag op schijf. Alles wat de gebruiker schrijft wordt versleuteld opgeslagen.
//
// data/
//   projecten/<slug>/ruimte.txt              instellingen + template van het project
//   projecten/<slug>/gedachten/<datum_tijd>.txt
//   projecten/<slug>/documenten/<datum_tijd>_<ruw|eind>.txt
//   chats/<slug>/...                         zelfde opbouw
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = ['projecten', 'chats'];

const DEFAULT_TEMPLATES = {
  projecten: `# Learning process report – {titel}

Write this document in English. Translate my Dutch notes faithfully, without adding anything.

## 1. What I worked on
A short overview of what I did in this period, in chronological order.

## 2. My thinking and decisions
Which choices I made and why, in my own reasoning.

## 3. What I learned
Only what I explicitly said I learned.

## 4. Mistakes and how I dealt with them
Problems, mistakes and dead ends I mentioned, and what I did about them.

## 5. Questions and answers
The questions I answered and my answers, grouped by theme.

## 6. Feedback and what I did with it
Feedback I mentioned and how I used it.

## 7. Open questions and next steps
What I still want to figure out.
`,
  chats: `# {titel}

Schrijf in het Nederlands, in de ik-vorm, in een persoonlijke en rustige toon. Dit is geen schooldocument.

## Waar ik mee bezig was
Een korte schets van het onderwerp, in mijn eigen woorden.

## Mijn gedachten
Mijn gedachten op volgorde van tijd, zodat zichtbaar is hoe mijn denken veranderde.

## Wat me opviel
Alleen dingen die ik zelf als belangrijk of opvallend benoemde.

## Vragen en mijn antwoorden

## Waar ik nog over twijfel
`
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const ID_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?(_(ruw|eind))?$/;

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
// Mapnamen zijn willekeurige codes, zodat op GitHub niet te zien is hoe een project of chat heet.
// De echte naam staat alleen versleuteld in ruimte.txt.
const RANDOM_SLUG_RE = /^[0-9a-f]{12}$/;
function randomSlug() { return crypto.randomBytes(6).toString('hex'); }
function badRequest(msg) { return Object.assign(new Error(msg), { status: 400 }); }
function notFound(msg) { return Object.assign(new Error(msg), { status: 404 }); }

class Store {
  constructor(dataDir, keyring) {
    this.dir = dataDir;
    this.keyring = keyring;
  }

  // ---------- helpers ----------
  spaceDir(type, slug) {
    if (!TYPES.includes(type)) throw badRequest('Onbekend type');
    if (!SLUG_RE.test(slug)) throw badRequest('Ongeldige naam');
    return path.join(this.dir, type, slug);
  }
  readEnc(file) {
    try { return JSON.parse(this.keyring.decrypt(fs.readFileSync(file, 'utf8')).text); }
    catch (e) {
      const which = e.keyId ? ` (sleutel ${e.keyId} ontbreekt)` : '';
      throw Object.assign(new Error(`Kan dit bestand niet ontsleutelen${which}. Voeg de juiste sleutel toe via Sleutels.`), { status: 409, code: 'NO_KEY' });
    }
  }
  writeEnc(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, this.keyring.encrypt(JSON.stringify(obj, null, 2)));
    fs.renameSync(tmp, file); // atomisch: nooit een half geschreven bestand
  }
  uniqueId(dir, base, suffix = '') {
    let id = base + suffix, i = 2;
    while (fs.existsSync(path.join(dir, id + '.txt'))) id = `${base}-${i++}${suffix}`;
    return id;
  }

  // ---------- ruimtes (projecten en chats) ----------
  listSpaces() {
    const out = [];
    for (const type of TYPES) {
      const tdir = path.join(this.dir, type);
      if (!fs.existsSync(tdir)) continue;
      for (const slug of fs.readdirSync(tdir)) {
        const metaFile = path.join(tdir, slug, 'ruimte.txt');
        if (!fs.existsSync(metaFile)) continue;
        try {
          const meta = this.readEnc(metaFile);
          const gdir = path.join(tdir, slug, 'gedachten');
          const files = fs.existsSync(gdir) ? fs.readdirSync(gdir).filter(f => f.endsWith('.txt')).sort() : [];
          out.push({ type, slug, name: meta.name, createdAt: meta.createdAt, count: files.length, lastEntry: files.length ? files[files.length - 1].replace('.txt', '') : null });
        } catch (e) {
          out.push({ type, slug, name: null, locked: true });
        }
      }
    }
    return out;
  }

  // ---------- sleutels ----------
  allEncryptedFiles() {
    const out = [];
    const walk = dir => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.txt')) out.push(p);
      }
    };
    for (const type of TYPES) walk(path.join(this.dir, type));
    return out;
  }

  // Telt per sleutel hoeveel bestanden ermee versleuteld zijn, en hoeveel er onleesbaar zijn.
  keyStats() {
    const perKey = {}, missing = {};
    let unreadable = 0, total = 0;
    for (const file of this.allEncryptedFiles()) {
      total++;
      try { const { keyId } = this.keyring.decrypt(fs.readFileSync(file, 'utf8')); perKey[keyId] = (perKey[keyId] || 0) + 1; }
      catch (e) { unreadable++; if (e.keyId) missing[e.keyId] = (missing[e.keyId] || 0) + 1; }
    }
    return { total, unreadable, perKey, missing };
  }

  // Versleutelt alles wat met een oude sleutel (of zonder sleutel-ID) is opgeslagen opnieuw met de hoofdsleutel.
  rekey() {
    let changed = 0, skipped = 0;
    for (const file of this.allEncryptedFiles()) {
      const raw = fs.readFileSync(file, 'utf8');
      let res;
      try { res = this.keyring.decrypt(raw); } catch { skipped++; continue; }
      if (res.keyId === this.keyring.primaryId && raw.startsWith('LJ2:')) continue;
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, this.keyring.encrypt(res.text));
      fs.renameSync(tmp, file);
      changed++;
    }
    return { changed, skipped };
  }

  // Zet oude, leesbare mapnamen om naar willekeurige codes. Geeft het aantal omgezette mappen terug.
  migrateFolderNames() {
    let n = 0;
    for (const type of TYPES) {
      const tdir = path.join(this.dir, type);
      if (!fs.existsSync(tdir)) continue;
      for (const slug of fs.readdirSync(tdir)) {
        if (RANDOM_SLUG_RE.test(slug) || !fs.existsSync(path.join(tdir, slug, 'ruimte.txt'))) continue;
        let next = randomSlug();
        while (fs.existsSync(path.join(tdir, next))) next = randomSlug();
        fs.renameSync(path.join(tdir, slug), path.join(tdir, next));
        n++;
      }
    }
    return n;
  }

  createSpace(type, name) {
    name = String(name || '').trim();
    if (!name) throw badRequest('Geef een naam op');
    if (!TYPES.includes(type)) throw badRequest('Onbekend type');
    let slug = randomSlug();
    while (fs.existsSync(path.join(this.dir, type, slug))) slug = randomSlug();
    const meta = { name, type, template: DEFAULT_TEMPLATES[type], createdAt: new Date().toISOString() };
    this.writeEnc(path.join(this.dir, type, slug, 'ruimte.txt'), meta);
    return { type, slug, ...meta };
  }

  getMeta(type, slug) {
    const file = path.join(this.spaceDir(type, slug), 'ruimte.txt');
    if (!fs.existsSync(file)) throw notFound('Ruimte niet gevonden');
    return this.readEnc(file);
  }

  updateMeta(type, slug, patch) {
    const meta = this.getMeta(type, slug);
    if (typeof patch.name === 'string' && patch.name.trim()) meta.name = patch.name.trim();
    if (typeof patch.template === 'string') meta.template = patch.template;
    this.writeEnc(path.join(this.spaceDir(type, slug), 'ruimte.txt'), meta);
    return meta;
  }

  defaultTemplate(type) { return DEFAULT_TEMPLATES[type]; }

  // ---------- gedachten en vragen ----------
  listEntries(type, slug) {
    const dir = path.join(this.spaceDir(type, slug), 'gedachten');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => {
      try { return this.readEnc(path.join(dir, f)); }
      catch { return { id: f.replace('.txt', ''), kind: 'gedachte', text: '⚠ Kon dit bestand niet ontsleutelen (andere sleutel?).' }; }
    }).sort((a, b) => (a.createdAt || a.id).localeCompare(b.createdAt || b.id));
  }

  addEntry(type, slug, input) {
    this.getMeta(type, slug);
    const dir = path.join(this.spaceDir(type, slug), 'gedachten');
    const now = new Date();
    const id = this.uniqueId(dir, stamp(now));
    const entry = { id, kind: input.kind === 'vraag' ? 'vraag' : 'gedachte', createdAt: now.toISOString() };
    if (entry.kind === 'gedachte') {
      entry.text = String(input.text || '').trim();
      if (!entry.text) throw badRequest('Lege gedachte');
    } else {
      entry.question = String(input.question || '').trim();
      if (!entry.question) throw badRequest('Lege vraag');
      entry.answer = String(input.answer || '').trim();
      entry.source = input.source === 'ai' ? 'ai' : 'ik';
    }
    if (input.replyTo && ID_RE.test(input.replyTo) && fs.existsSync(path.join(dir, input.replyTo + '.txt'))) {
      entry.replyTo = input.replyTo;
    }
    this.writeEnc(path.join(dir, id + '.txt'), entry);
    return entry;
  }

  updateEntry(type, slug, id, patch) {
    if (!ID_RE.test(id)) throw badRequest('Ongeldig id');
    const file = path.join(this.spaceDir(type, slug), 'gedachten', id + '.txt');
    if (!fs.existsSync(file)) throw notFound('Gedachte niet gevonden');
    const entry = this.readEnc(file);
    if (entry.kind === 'gedachte' && typeof patch.text === 'string' && patch.text.trim()) entry.text = patch.text.trim();
    if (entry.kind === 'vraag' && typeof patch.answer === 'string') entry.answer = patch.answer.trim();
    entry.updatedAt = new Date().toISOString();
    this.writeEnc(file, entry);
    return entry;
  }

  // ---------- documenten ----------
  listDocs(type, slug) {
    const dir = path.join(this.spaceDir(type, slug), 'documenten');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort().reverse().map(f => {
      try { const d = this.readEnc(path.join(dir, f)); delete d.content; return d; }
      catch { return { id: f.replace('.txt', ''), title: 'Kon niet ontsleutelen', kind: 'fout' }; }
    });
  }

  getDoc(type, slug, id) {
    if (!ID_RE.test(id)) throw badRequest('Ongeldig id');
    const file = path.join(this.spaceDir(type, slug), 'documenten', id + '.txt');
    if (!fs.existsSync(file)) throw notFound('Document niet gevonden');
    return this.readEnc(file);
  }

  saveDoc(type, slug, input) {
    this.getMeta(type, slug);
    const dir = path.join(this.spaceDir(type, slug), 'documenten');
    const kind = input.kind === 'eind' ? 'eind' : 'ruw';
    const now = new Date();
    const id = this.uniqueId(dir, stamp(now), '_' + kind);
    const doc = {
      id, kind,
      title: String(input.title || 'Document').trim(),
      from: input.from || null, to: input.to || null,
      basedOn: input.basedOn || null,
      generatedBy: input.generatedBy || 'handmatig',
      createdAt: now.toISOString(),
      content: String(input.content || '')
    };
    this.writeEnc(path.join(dir, id + '.txt'), doc);
    return doc;
  }

  updateDoc(type, slug, id, patch) {
    const doc = this.getDoc(type, slug, id);
    if (typeof patch.content === 'string') doc.content = patch.content;
    if (typeof patch.title === 'string' && patch.title.trim()) doc.title = patch.title.trim();
    doc.updatedAt = new Date().toISOString();
    this.writeEnc(path.join(this.spaceDir(type, slug), 'documenten', id + '.txt'), doc);
    return doc;
  }
}

module.exports = { Store, TYPES };
