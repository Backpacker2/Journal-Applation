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
    this.logFile = path.join(dir, '.git', 'leerjournaal-sync.log'); // staat in .git, gaat dus nooit naar GitHub
    try { this.lastSync = fs.readFileSync(this.syncFile, 'utf8').trim() || null; } catch {}
  }

  raw(args) {
    return new Promise((resolve, reject) => {
      // GIT_TERMINAL_PROMPT=0: nooit blijven hangen op een inlogvraag die niemand ziet.
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
      execFile('git', args, { cwd: this.dir, env, timeout: 120e3, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
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

  log(line) {
    try { fs.appendFileSync(this.logFile, `${new Date().toISOString()} ${line}\n`); } catch {}
  }

  sync() {
    return this.run(async () => {
      const remotes = await this.raw(['remote']);
      if (!remotes.split('\n').includes('origin')) {
        throw new Error('Nog geen GitHub-remote ingesteld. Zie de README (stap "Je gedachten koppelen aan GitHub").');
      }
      const branch = await this.raw(['rev-parse', '--abbrev-ref', 'HEAD']);
      let step = 'verbinden';
      try {
        const remoteHead = await this.raw(['ls-remote', '--heads', 'origin', branch]);
        if (remoteHead) {
          step = 'ophalen';
          try {
            await this.raw(['pull', '--rebase', '--autostash', 'origin', branch]);
          } catch (e) {
            await this.raw(['rebase', '--abort']).catch(() => {}); // laat nooit een halve rebase achter
            throw e;
          }
        }
        step = 'uploaden';
        await this.raw(['push', '-u', 'origin', branch]);
        this.lastSync = new Date().toISOString();
        this.lastSyncError = null;
        try { fs.writeFileSync(this.syncFile, this.lastSync); } catch {}
        this.log(`OK ${branch}`);
      } catch (e) {
        const friendly = explain(e.message, this.dir);
        this.log(`FOUT bij ${step}: ${e.message.replace(/\s+/g, ' ')}`);
        this.lastSyncError = { step, message: friendly, detail: e.message, at: new Date().toISOString() };
        throw Object.assign(new Error(`Sync mislukt bij ${step}: ${friendly}`), { status: 502, detail: e.message });
      }
      return { lastSync: this.lastSync };
    });
  }
}

// Vertaalt veelvoorkomende git-fouten naar iets begrijpelijks.
function explain(msg, dir) {
  const m = msg.toLowerCase();
  const term = `Open de terminal en voer uit:  cd "${dir}" && git push  — dan zie je de vraag of de volledige fout.`;
  if (/could not read username|terminal prompts disabled|authentication failed|invalid username or password|returned error: 40[13]/.test(m))
    return `GitHub vraagt om in te loggen of weigert je inloggegevens. ${term} Log daar één keer in (met een token); daarna werkt de knop weer.`;
  if (/gh007|private email/.test(m))
    return 'GitHub blokkeert de upload omdat je e-mailadres privé is. Zet in de data-map een ander adres: git config user.email "<jouw-id>+<gebruikersnaam>@users.noreply.github.com"';
  if (/gh013|push protection|secret/.test(m))
    return 'GitHub blokkeert de upload omdat het denkt dat er een geheim in staat (push protection). Bekijk de melding op GitHub of in de terminal.';
  if (/repository not found|not found/.test(m))
    return 'De repository bestaat niet (meer) op dit adres of je hebt geen toegang. Is hij hernoemd? Pas het adres aan met: git remote set-url origin <nieuw adres>';
  if (/could not resolve host|connect tunnel failed|timed out|failed to connect|connection (refused|reset|timed)|network is unreachable/.test(m))
    return 'GitHub is niet bereikbaar. Controleer je internet en probeer het opnieuw.';
  if (/conflict/.test(m))
    return 'Op GitHub en hier is hetzelfde bestand anders aangepast. Er is niets kwijt; laat het Claude weten.';
  if (/rejected|non-fast-forward|fetch first/.test(m))
    return 'GitHub heeft nieuwere wijzigingen die eerst opgehaald moeten worden. Probeer Sync nog een keer.';
  return msg.split('\n').slice(-3).join(' ');
}

module.exports = { Git };
