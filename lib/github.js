// Signing in to GitHub to push the (encrypted) data.
// Two ways:
//  1. Paste a token (fine-grained personal access token, only for the data repository).
//  2. "Sign in with GitHub" via the device flow, when a githubClientId is set in config.json.
// The token is stored in github.json in the app folder (git-ignored) and only sent to github.com.
const fs = require('fs');
const path = require('path');

const UA = { 'user-agent': 'Leerjournaal', accept: 'application/vnd.github+json' };

class GitHubAuth {
  constructor(appDir, cfg) {
    this.file = path.join(appDir, 'github.json');
    this.cfg = cfg;
    this.data = null;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
  }

  get token() { return this.data?.token || null; }

  status() {
    return {
      loggedIn: !!this.token, login: this.data?.login || null, via: this.data?.via || null,
      savedAt: this.data?.savedAt || null, deviceFlow: !!this.cfg.githubClientId
    };
  }

  // Extra git options so push/pull use this token (the token never ends up in a git file).
  gitArgs() {
    if (!this.token) return [];
    const basic = Buffer.from(`x-access-token:${this.token}`).toString('base64');
    return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
  }

  async verify(token) {
    const r = await fetch('https://api.github.com/user', { headers: { ...UA, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (r.status === 401) throw Object.assign(new Error('GitHub kent dit token niet (verkeerd gekopieerd of verlopen).'), { status: 400 });
    if (!r.ok) throw Object.assign(new Error(`GitHub gaf een fout (${r.status}). Probeer het zo nog eens.`), { status: 502 });
    return (await r.json()).login;
  }

  // Checks whether the token may access the data repository (read and, if GitHub reports it, write).
  async checkRepo(token, remoteUrl) {
    const m = String(remoteUrl || '').match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (!m) return null;
    const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers: { ...UA, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return { ok: false, repo: `${m[1]}/${m[2]}`, message: `Dit token heeft geen toegang tot ${m[1]}/${m[2]}. Kies die repository bij “Repository access”.` };
    if (!r.ok) return null;
    const j = await r.json();
    if (j.permissions && j.permissions.push === false) return { ok: false, repo: j.full_name, message: `Dit token mag ${j.full_name} wel lezen maar niet schrijven. Zet “Contents” op “Read and write”.` };
    return { ok: true, repo: j.full_name };
  }

  save(token, login, via) {
    this.data = { token, login, via, savedAt: new Date().toISOString() };
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
  }

  logout() {
    this.data = null;
    try { fs.unlinkSync(this.file); } catch {}
  }

  // ---------- device flow ----------
  async deviceStart() {
    if (!this.cfg.githubClientId) throw Object.assign(new Error('Geen githubClientId ingesteld.'), { status: 400 });
    const r = await fetch('https://github.com/login/device/code', {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Leerjournaal' },
      body: JSON.stringify({ client_id: this.cfg.githubClientId, scope: 'repo' }), signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.device_code) throw Object.assign(new Error(j.error_description || 'GitHub gaf geen code terug. Staat “Device flow” aan bij je OAuth-app?'), { status: 502 });
    this.device = { code: j.device_code, interval: j.interval || 5, expires: Date.now() + (j.expires_in || 900) * 1000 };
    return { userCode: j.user_code, verificationUri: j.verification_uri, interval: this.device.interval, expiresIn: j.expires_in };
  }

  async devicePoll() {
    if (!this.device) throw Object.assign(new Error('Start eerst het inloggen.'), { status: 400 });
    if (Date.now() > this.device.expires) { this.device = null; return { state: 'verlopen' }; }
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Leerjournaal' },
      body: JSON.stringify({ client_id: this.cfg.githubClientId, device_code: this.device.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
      signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    if (j.access_token) {
      const login = await this.verify(j.access_token);
      this.save(j.access_token, login, 'device');
      this.device = null;
      return { state: 'klaar', login };
    }
    if (j.error === 'authorization_pending') return { state: 'wachten', interval: this.device.interval };
    if (j.error === 'slow_down') { this.device.interval += 5; return { state: 'wachten', interval: this.device.interval }; }
    if (j.error === 'expired_token') { this.device = null; return { state: 'verlopen' }; }
    if (j.error === 'access_denied') { this.device = null; return { state: 'geweigerd' }; }
    throw Object.assign(new Error(j.error_description || j.error || 'Onbekende fout bij inloggen'), { status: 502 });
  }
}

module.exports = { GitHubAuth };
