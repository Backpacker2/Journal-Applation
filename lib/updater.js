// Updates via git: de app-map is een clone van je GitHub-repository.
// Je data (data/), config.json en je sleutel staan in .gitignore, dus een update raakt ze nooit.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(dir, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: dir, timeout: 60e3 }, (err, stdout, stderr) => {
      if (err) { err.message = (stderr || err.message).trim(); return reject(err); }
      resolve(stdout.trim());
    });
  });
}

class Updater {
  constructor(appDir) { this.dir = appDir; }

  isRepo() { return fs.existsSync(path.join(this.dir, '.git')); }

  async version() {
    const pkg = JSON.parse(fs.readFileSync(path.join(this.dir, 'package.json'), 'utf8'));
    const commit = this.isRepo() ? await git(this.dir, ['rev-parse', '--short', 'HEAD']).catch(() => null) : null;
    return { version: pkg.version, commit };
  }

  async check() {
    const v = await this.version();
    if (!this.isRepo()) return { ...v, available: false, reason: 'De app-map is geen git-clone. Zie de README, stap "Installeren".' };
    const upstream = await git(this.dir, ['rev-parse', '--abbrev-ref', '@{u}']).catch(() => null);
    if (!upstream) return { ...v, available: false, reason: 'Geen GitHub-remote gekoppeld aan de app-map.' };
    await git(this.dir, ['fetch', '--quiet']);
    const behind = Number(await git(this.dir, ['rev-list', '--count', 'HEAD..@{u}']));
    const changes = behind
      ? (await git(this.dir, ['log', '--format=%s', '-n', '15', 'HEAD..@{u}'])).split('\n').filter(Boolean)
      : [];
    const dirty = (await git(this.dir, ['status', '--porcelain', '--untracked-files=no'])) !== '';
    return { ...v, available: behind > 0, behind, changes, dirty, checkedAt: new Date().toISOString() };
  }

  async apply() {
    const before = await this.version();
    if (!this.isRepo()) throw Object.assign(new Error('De app-map is geen git-clone.'), { status: 400 });
    const dirty = (await git(this.dir, ['status', '--porcelain', '--untracked-files=no'])) !== '';
    if (dirty) {
      throw Object.assign(new Error('Je hebt zelf bestanden van de app aangepast. Commit of herstel die eerst, dan kan de update veilig.'), { status: 409 });
    }
    await git(this.dir, ['pull', '--ff-only', '--quiet']);
    const after = await this.version();
    return { updated: before.commit !== after.commit, from: before.commit, to: after.commit, version: after.version };
  }
}

module.exports = { Updater };
