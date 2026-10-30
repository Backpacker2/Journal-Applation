// AES-256-GCM: elke gedachte wordt apart versleuteld met een willekeurige IV.
// Bestandsformaat:  LJ1:<base64( iv[12] | authTag[16] | ciphertext )>
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREFIX = 'LJ1:';

function loadOrCreateKey(file) {
  if (fs.existsSync(file)) {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`Sleutelbestand ${file} is ongeldig (verwacht 32 bytes).`);
    return { key, created: false };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('base64') + '\n', { mode: 0o600 });
  return { key, created: true };
}

function encrypt(key, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64') + '\n';
}

function decrypt(key, data) {
  data = data.trim();
  if (!data.startsWith(PREFIX)) throw new Error('Onbekend bestandsformaat');
  const buf = Buffer.from(data.slice(PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = { loadOrCreateKey, encrypt, decrypt };
