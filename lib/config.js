// Laadt de instellingen uit config.json (staat in .gitignore) en vult aan met standaardwaarden.
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');

const DEFAULTS = {
  port: 4173,
  dataDir: './data',            // map met je (versleutelde) gedachten; wordt een eigen git-repo
  keyFile: './secret.key',      // je geheime sleutel; NOOIT in git zetten
  extraKeyFiles: [],            // oude sleutels om oudere bestanden te lezen (ook: elk .key-bestand naast keyFile)
  anthropicApiKey: '',          // optioneel; zonder sleutel werkt "Kopieer prompt" nog steeds
  model: 'claude-sonnet-5-5',
  allowedHosts: [],             // extra adressen waarop de app bereikbaar mag zijn (*.ts.net mag altijd)
  tailscaleUsers: [],           // leeg = iedereen in je Tailscale-netwerk; anders alleen deze accounts
  autoSync: true,               // na elke wijziging automatisch naar GitHub
  autoSyncMinutes: 10           // daarnaast elke 10 minuten ophalen en uploaden (0 = uit)
};

function expand(p) {
  if (!p) return p;
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(APP_DIR, p);
}

function loadConfig() {
  const file = path.join(APP_DIR, 'config.json');
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`config.json kon niet gelezen worden: ${e.message}`);
    }
  }
  // instellingen.json: wat je in de app onder Instellingen wijzigt (staat ook in .gitignore).
  let ui = {};
  const uiFile = path.join(APP_DIR, 'instellingen.json');
  if (fs.existsSync(uiFile)) { try { ui = JSON.parse(fs.readFileSync(uiFile, 'utf8')); } catch {} }
  const cfg = { ...DEFAULTS, ...user, ...ui };
  cfg.features = { kanban: true, feedback: true, aiButtons: true, ...(user.features || {}), ...(ui.features || {}) };
  cfg.theme = cfg.theme || 'dark';
  cfg.tailscaleUsers = (Array.isArray(cfg.tailscaleUsers) ? cfg.tailscaleUsers : []).map(x => String(x).toLowerCase());
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.LJ_DATA_DIR) cfg.dataDir = process.env.LJ_DATA_DIR;
  if (process.env.LJ_KEY_FILE) cfg.keyFile = process.env.LJ_KEY_FILE;
  if (process.env.ANTHROPIC_API_KEY) cfg.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  cfg.dataDir = expand(cfg.dataDir);
  cfg.keyFile = expand(cfg.keyFile);
  cfg.extraKeyFiles = (Array.isArray(cfg.extraKeyFiles) ? cfg.extraKeyFiles : []).map(expand);
  cfg.appDir = APP_DIR;
  return cfg;
}

// Bewaart instellingen uit de app in instellingen.json (alleen de velden die de app mag wijzigen).
const UI_KEYS = ['theme', 'features', 'autoSync', 'autoSyncMinutes', 'anthropicApiKey', 'model'];
function saveUiSettings(patch) {
  const file = path.join(APP_DIR, 'instellingen.json');
  let cur = {};
  if (fs.existsSync(file)) { try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  for (const k of UI_KEYS) if (k in patch) cur[k] = patch[k];
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
  return cur;
}

module.exports = { loadConfig, saveUiSettings, APP_DIR };
