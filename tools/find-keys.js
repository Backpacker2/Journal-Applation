#!/usr/bin/env node
// Searches the computer for old Leerjournaal keys (secret.key and other .key files),
// tests which ones fit the data and adds the useful ones to the key folder.
//
// Usage (Dutch flags are still accepted):
//   npm run find-keys                     search, then ask whether to add them
//   npm run find-keys -- --yes            add without asking            (--ja)
//   npm run find-keys -- --dir ~/Old      also search an extra folder   (--map)
//   npm run find-keys -- --all            also add keys that fit no file (yet) (--alles)
// Messages to the user are Dutch.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { loadConfig } = require('../lib/config');
const { parseKey, keyId, Keyring } = require('../lib/crypto');

const args = process.argv.slice(2);
const ALIASES = { '--yes': '--ja', '--all': '--alles', '--dir': '--map' }; // English flags map to the original Dutch ones
const flag = f => args.includes(f) || Object.entries(ALIASES).some(([en, nl]) => nl === f && args.includes(en));
const extraRoots = [];
for (let i = 0; i < args.length; i++) if ((args[i] === '--map' || args[i] === '--dir') && args[i + 1]) extraRoots.push(args[++i]);

const cfg = loadConfig();
const HOME = os.homedir();
const keyDir = path.dirname(cfg.keyFile);
const MAX_KEY_BYTES = 200; // a key is ~45 bytes; larger .key files (such as Keynote) are skipped
const SKIP_DIRS = new Set(['node_modules', '.git', '.Trash', 'Library', '.cache', '.npm', 'Applications', 'Pictures', 'Music', 'Movies']);

const expand = p => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : path.resolve(p));
const short = p => (p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);

// ---------- 1. collect candidates ----------
function viaSpotlight() {
  if (process.platform !== 'darwin') return [];
  try {
    const out = execFileSync('mdfind', ['kMDItemFSName == "*.key"c'], { encoding: 'utf8', timeout: 20000, maxBuffer: 20 * 1024 * 1024 });
    return out.split('\n').filter(Boolean);
  } catch { return []; }
}

function walk(root, depth, out) {
  if (depth < 0) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, depth - 1, out);
    } else if (e.isFile() && /\.key$/i.test(e.name)) out.push(p);
  }
}

// Finds other Leerjournaal data folders (e.g. from a previous version), to show where old thoughts are.
function otherDataDirs(roots) {
  const found = new Map();
  const look = (dir, depth) => {
    if (depth < 0) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const names = entries.filter(e => e.isDirectory()).map(e => e.name);
    if ((names.includes('projecten') || names.includes('chats')) && fs.existsSync(path.join(dir, 'README.md'))) {
      let real; try { real = fs.realpathSync(dir); } catch { return; }
      if (real !== fs.realpathSync(cfg.dataDir)) {
        let n = 0;
        const count = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) count(p); else if (e.name.endsWith('.txt')) n++; } } catch {} };
        count(path.join(real, 'projecten')); count(path.join(real, 'chats'));
        found.set(real, n);
      }
      return;
    }
    for (const n of names) if (!SKIP_DIRS.has(n)) look(path.join(dir, n), depth - 1);
  };
  roots.forEach(r => look(r, 5));
  return [...found.entries()];
}

function searchRoots() {
  return [
    keyDir, cfg.appDir, path.dirname(cfg.appDir),
    path.join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs'),
    ...['Desktop', 'Documents', 'Downloads', 'Developer', 'Projects', 'GitHub', 'code', 'dev'].map(d => path.join(HOME, d)),
    ...extraRoots.map(expand)
  ];
}

function candidates() {
  const found = new Set(viaSpotlight());
  const roots = searchRoots();
  for (const r of roots) { const out = []; walk(r, 6, out); out.forEach(f => found.add(f)); }
  for (const f of cfg.extraKeyFiles || []) found.add(f);
  const keys = new Map(); // id -> { key, paths }
  for (const file of found) {
    let real;
    try { real = fs.realpathSync(file); if (fs.statSync(real).size > MAX_KEY_BYTES) continue; } catch { continue; }
    try {
      const key = parseKey(fs.readFileSync(real, 'utf8'));
      const id = keyId(key);
      if (!keys.has(id)) keys.set(id, { id, key, paths: new Set() });
      keys.get(id).paths.add(real);
    } catch { /* geen Leerjournaal-sleutel */ }
  }
  return [...keys.values()];
}

// ---------- 2. keys that are already loaded ----------
function loadedIds() {
  const ids = new Set();
  const files = fs.existsSync(keyDir) ? fs.readdirSync(keyDir).filter(f => /\.key$/i.test(f)).map(f => path.join(keyDir, f)) : [];
  for (const f of [...files, ...(cfg.extraKeyFiles || [])]) {
    try { ids.add(keyId(parseKey(fs.readFileSync(f, 'utf8')))); } catch {}
  }
  return ids;
}

// ---------- 3. test the data ----------
function dataFiles() {
  const out = [];
  const go = dir => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) go(p); else if (e.name.endsWith('.txt')) out.push(fs.readFileSync(p, 'utf8'));
    }
  };
  go(path.join(cfg.dataDir, 'projecten'));
  go(path.join(cfg.dataDir, 'chats'));
  return out;
}

function fits(key, contents) {
  const ring = new Keyring(key, 'test');
  let n = 0;
  for (const c of contents) { try { ring.decrypt(c); n++; } catch {} }
  return n;
}

function ask(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(/^(j|ja|y|yes)$/i.test(a.trim())); }));
}

(async () => {
  console.log('\n  Leerjournaal · oude sleutels zoeken\n');
  console.log(`  Sleutelmap: ${short(keyDir)}`);
  console.log(`  Data:       ${short(cfg.dataDir)}\n`);

  const contents = dataFiles();
  const loaded = loadedIds();
  const found = candidates();

  // Which files are unreadable with the loaded keys?
  const loadedKeys = found.filter(k => loaded.has(k.id));
  const readableNow = new Set();
  for (const k of loadedKeys) {
    const ring = new Keyring(k.key, 'test');
    contents.forEach((c, i) => { try { ring.decrypt(c); readableNow.add(i); } catch {} });
  }
  const unreadable = contents.length - readableNow.size;

  if (!found.length) {
    console.log('  Geen sleutels gevonden. Weet je waar je oude app-map staat? Probeer:');
    console.log('    npm run sleutels -- --map ~/pad/naar/oude-map\n');
    return;
  }

  console.log(`  ${found.length} sleutel(s) gevonden:\n`);
  const toAdd = [];
  for (const k of found) {
    const n = contents.length ? fits(k.key, contents) : 0;
    const status = loaded.has(k.id) ? 'al geladen' : n ? 'NIEUW, past op je data' : 'nieuw, past op geen bestand';
    console.log(`  • ${k.id}  ${String(n).padStart(4)} bestanden  ${status}`);
    for (const p of k.paths) console.log(`      ${short(p)}`);
    if (!loaded.has(k.id) && (n > 0 || flag('--alles'))) toAdd.push({ ...k, n });
  }
  console.log(`\n  Bestanden in je data: ${contents.length}, nu onleesbaar: ${unreadable}\n`);

  const others = otherDataDirs(searchRoots());
  if (others.length) {
    console.log('  Andere Leerjournaal-data gevonden (bijvoorbeeld van een vorige versie):');
    for (const [dir, n] of others) console.log(`    ${short(dir)}  (${n} bestanden)`);
    console.log('  Wil je die gebruiken? Zet "dataDir" in config.json op die map, of kopieer hem naar je app-map.\n');
  }

  if (!toAdd.length) {
    console.log(unreadable
      ? '  Er is geen nieuwe sleutel gevonden die past. Zoek verder met --map, of controleer je oude back-ups.\n'
      : '  Alles is al leesbaar. Er hoeft niets te gebeuren.\n');
    return;
  }

  const ok = flag('--ja') || await ask(`  ${toAdd.length} sleutel(s) toevoegen aan ${short(keyDir)}? (j/n) `);
  if (!ok) { console.log('\n  Niets toegevoegd.\n'); return; }

  fs.mkdirSync(keyDir, { recursive: true });
  for (const k of toAdd) {
    const file = path.join(keyDir, `oud-${k.id}.key`);
    fs.writeFileSync(file, k.key.toString('base64') + '\n', { mode: 0o600 });
    console.log(`  ✓ ${k.id} opgeslagen als ${short(file)}`);
  }
  console.log('\n  Klaar. Open in de app Sleutels (of ververs de pagina) om alles weer te kunnen lezen.\n');
})().catch(e => { console.error('  Fout:', e.message); process.exit(1); });
