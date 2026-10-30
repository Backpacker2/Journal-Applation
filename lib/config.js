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
  autoSyncMinutes: 0            // 0 = alleen synchroniseren als je op "Sync" klikt
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
  const cfg = { ...DEFAULTS, ...user };
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

module.exports = { loadConfig, APP_DIR };
