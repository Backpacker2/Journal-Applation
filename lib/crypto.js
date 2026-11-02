// AES-256-GCM with a keyring: one primary key to write with,
// plus old keys that can still read older files.
//
// File formats:
//   LJ2:<key-id>:<base64( iv[12] | authTag[16] | ciphertext )>   (current, names the key it needs)
//   LJ1:<base64( ... )>                                          (versions 0.1-0.3, key unknown)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FILE_RE = /\.key$/i;

function keyId(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function parseKey(text) {
  const key = Buffer.from(String(text).trim(), 'base64');
  if (key.length !== 32) throw Object.assign(new Error('Dit is geen geldige sleutel (verwacht 32 bytes in base64, zoals de inhoud van secret.key).'), { status: 400 });
  return key;
}

function loadOrCreateKey(file) {
  if (fs.existsSync(file)) return { key: parseKey(fs.readFileSync(file, 'utf8')), created: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('base64') + '\n', { mode: 0o600 });
  return { key, created: true };
}

function seal(key, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function open(key, b64) {
  const buf = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

class Keyring {
  constructor(primaryKey, primarySource) {
    this.keys = [];
    this.primaryId = this.add(primaryKey, primarySource, true).id;
  }

  add(key, source, primary = false) {
    const id = keyId(key);
    const existing = this.keys.find(k => k.id === id);
    if (existing) { if (primary) existing.primary = true; return existing; }
    const entry = { id, key, source, primary };
    this.keys.push(entry);
    return entry;
  }

  get primary() { return this.keys.find(k => k.id === this.primaryId); }

  encrypt(text) {
    return `LJ2:${this.primaryId}:${seal(this.primary.key, text)}\n`;
  }

  // Returns { text, keyId }, or throws when no key fits.
  decrypt(data) {
    data = data.trim();
    if (data.startsWith('LJ2:')) {
      const [, id, b64] = data.split(':');
      const k = this.keys.find(k => k.id === id);
      if (!k) throw Object.assign(new Error(`Sleutel ${id} ontbreekt`), { code: 'NO_KEY', keyId: id });
      return { text: open(k.key, b64), keyId: id };
    }
    if (data.startsWith('LJ1:')) {
      const b64 = data.slice(4);
      // Primary key first, then the old keys.
      for (const k of [this.primary, ...this.keys.filter(k => !k.primary)]) {
        try { return { text: open(k.key, b64), keyId: k.id }; } catch {}
      }
      throw Object.assign(new Error('Geen van je sleutels past op dit bestand'), { code: 'NO_KEY', keyId: null });
    }
    throw new Error('Onbekend bestandsformaat');
  }

  list() {
    return this.keys.map(({ id, source, primary }) => ({ id, source, primary }));
  }
}

// Loads extra keys from disk into the keyring. Returns the number of newly added keys.
//  - every *.key file in the same folder as the primary key (e.g. iCloud/Leerjournaal/oud-1.key)
//  - the paths in "extraKeyFiles" in config.json
function loadExtraKeys(ring, cfg, quiet = false) {
  const dir = path.dirname(cfg.keyFile);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => KEY_FILE_RE.test(f)).map(f => path.join(dir, f)) : [];
  for (const extra of cfg.extraKeyFiles || []) files.push(extra);
  let added = 0;
  for (const file of files) {
    if (path.resolve(file) === path.resolve(cfg.keyFile) || !fs.existsSync(file)) continue;
    try {
      const before = ring.keys.length;
      ring.add(parseKey(fs.readFileSync(file, 'utf8')), path.basename(file));
      if (ring.keys.length > before) added++;
    } catch (e) { if (!quiet) console.warn(`  Sleutelbestand ${file} overgeslagen: ${e.message}`); }
  }
  return added;
}

// Loads the primary key (or creates it) plus all extra keys.
function loadKeyring(cfg) {
  const { key, created } = loadOrCreateKey(cfg.keyFile);
  const ring = new Keyring(key, path.basename(cfg.keyFile));
  loadExtraKeys(ring, cfg);
  return { ring, created, keyDir: path.dirname(cfg.keyFile) };
}

module.exports = { loadKeyring, loadExtraKeys, parseKey, keyId, Keyring };
