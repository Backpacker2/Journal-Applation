// AES-256-GCM met een sleutelbos (keyring): één hoofdsleutel om mee te schrijven,
// plus oude sleutels waarmee oudere bestanden nog gelezen kunnen worden.
//
// Bestandsformaten:
//   LJ2:<sleutel-id>:<base64( iv[12] | authTag[16] | ciphertext )>   (nieuw, zegt welke sleutel nodig is)
//   LJ1:<base64( ... )>                                               (versie 0.1 t/m 0.3, sleutel onbekend)
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

  // Geeft { text, keyId } terug, of gooit een fout als geen enkele sleutel past.
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
      // Eerst de hoofdsleutel, daarna de oude sleutels.
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

// Laadt de hoofdsleutel plus alle extra sleutels:
//  - elk *.key-bestand in dezelfde map als de hoofdsleutel (bijv. iCloud/Leerjournaal/oud-1.key)
//  - de paden in "extraKeyFiles" in config.json
function loadKeyring(cfg) {
  const { key, created } = loadOrCreateKey(cfg.keyFile);
  const ring = new Keyring(key, path.basename(cfg.keyFile));
  const dir = path.dirname(cfg.keyFile);
  const files = fs.readdirSync(dir).filter(f => KEY_FILE_RE.test(f)).map(f => path.join(dir, f));
  for (const extra of cfg.extraKeyFiles || []) files.push(extra);
  for (const file of files) {
    if (path.resolve(file) === path.resolve(cfg.keyFile) || !fs.existsSync(file)) continue;
    try { ring.add(parseKey(fs.readFileSync(file, 'utf8')), path.basename(file)); }
    catch (e) { console.warn(`  Sleutelbestand ${file} overgeslagen: ${e.message}`); }
  }
  return { ring, created, keyDir: dir };
}

module.exports = { loadKeyring, parseKey, keyId, Keyring };
