// Kleine wrapper rond git. Alle git-acties lopen achter elkaar via een wachtrij.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

class Git {
  constructor(dir) {
    this.dir = dir;
    this.queue = Promise.resolve();
    this.lastSync = null;
    this.lastSyncError = null;
    this.syncFile = path.join(dir, '.git', 'leerjournaal-last-sync');
    try { this.lastSync = fs.readFileSync(this.syncFile, 'utf8').trim() || null; } catch {}
  }

  raw(args) {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd: this.dir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          err.message = (stderr || err.message).trim();
          return reject(err);
        }
        resolve(stdout.trim());
      });
    });
  }

  run(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  async ensureRepo() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(path.join(this.dir, '.git'))) {
      await this.raw(['init', '-b', 'main']);
    }
    // Zorg dat commits werken, ook als git nog geen naam/e-mail heeft.
    const email = await this.raw(['config', 'user.email']).catch(() => '');
    if (!email) {
      await this.raw(['config', 'user.email', 'leerjournaal@localhost']);
      await this.raw(['config', 'user.name', 'Leerjournaal']);
    }
    const readme = path.join(this.dir, 'README.md');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme,
        '# Leerjournaal-data\n\nDeze repository bevat versleutelde gedachten en documenten (AES-256-GCM).\n' +
        'Zonder de sleutel zijn de bestanden onleesbaar. Open ze met de Leerjournaal-app.\n');
      await this.commit('Leerjournaal-data aangemaakt');
    }
  }

  commit(message) {
    return this.run(async () => {
      await this.raw(['add', '-A']);
      const status = await this.raw(['status', '--porcelain']);
      if (!status) return false;
      await this.raw(['commit', '-m', message]);
      return true;
    });
  }

  async status() {
    return this.run(async () => {
      const remotes = await this.raw(['remote']).catch(() => '');
      const branch = await this.raw(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main');
      return {
        hasRemote: remotes.split('\n').includes('origin'),
        branch,
        lastSync: this.lastSync,
        lastSyncError: this.lastSyncError
      };
    });
  }

  sync() {
    return this.run(async () => {
      const remotes = await this.raw(['remote']);
      if (!remotes.split('\n').includes('origin')) {
        throw new Error('Nog geen GitHub-remote ingesteld. Zie de README (stap "Koppelen aan GitHub").');
      }
      const branch = await this.raw(['rev-parse', '--abbrev-ref', 'HEAD']);
      try {
        const remoteHead = await this.raw(['ls-remote', '--heads', 'origin', branch]);
        if (remoteHead) await this.raw(['pull', '--rebase', '--autostash', 'origin', branch]);
        await this.raw(['push', '-u', 'origin', branch]);
        this.lastSync = new Date().toISOString();
        this.lastSyncError = null;
        try { fs.writeFileSync(this.syncFile, this.lastSync); } catch {}
      } catch (e) {
        this.lastSyncError = e.message;
        throw e;
      }
      return { lastSync: this.lastSync };
    });
  }
}

module.exports = { Git };
