// AI providers: Claude, ChatGPT, Gemini, Mistral, Ollama (local) or another OpenAI-compatible service.
// Several can be configured (also several keys for the same provider) and one is active.
// Keys are only stored in instellingen.json on the server and are never sent to the browser.
const crypto = require('crypto');

const KINDS = {
  anthropic: { label: 'Claude (Anthropic)', base: 'https://api.anthropic.com/v1', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'ChatGPT (OpenAI)', base: 'https://api.openai.com/v1', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Gemini (Google)', base: 'https://generativelanguage.googleapis.com/v1beta', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
  mistral: { label: 'Mistral', base: 'https://api.mistral.ai/v1', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys' },
  ollama: { label: 'Ollama (lokaal, gratis)', base: 'http://localhost:11434/v1', needsKey: false, keyUrl: 'https://ollama.com/download' },
  custom: { label: 'Anders (OpenAI-compatibel)', base: '', needsKey: false, keyUrl: null }
};
const TIMEOUT = 180000;

// List of providers; a legacy standalone Anthropic key (anthropicApiKey) counts as "Claude".
function list(cfg) {
  const out = Array.isArray(cfg.aiProviders) ? cfg.aiProviders.filter(p => KINDS[p.provider]) : [];
  if (cfg.anthropicApiKey && !out.some(p => p.id === 'claude')) {
    out.unshift({ id: 'claude', provider: 'anthropic', label: 'Claude', apiKey: cfg.anthropicApiKey, model: cfg.model });
  }
  return out;
}
function pick(cfg, id) {
  const all = list(cfg);
  const p = all.find(x => x.id === id) || all.find(x => x.id === cfg.aiActive) || all[0];
  if (!p) throw Object.assign(new Error('Er is nog geen AI ingesteld (Instellingen → AI). Of gebruik "Kopieer prompt".'), { status: 400, code: 'NO_KEY' });
  return p;
}
const base = p => String(p.baseUrl || KINDS[p.provider].base).replace(/\/+$/, '');
const publicView = p => ({
  id: p.id, provider: p.provider, kindLabel: KINDS[p.provider].label, label: p.label, model: p.model,
  baseUrl: p.baseUrl || null, keyHint: p.apiKey ? (String(p.apiKey).length >= 12 ? '••••' + String(p.apiKey).slice(-4) : '••••') : null
});

function clean(input, old = {}) {
  const provider = KINDS[input.provider] ? input.provider : old.provider;
  if (!provider) throw Object.assign(new Error('Kies een AI-aanbieder.'), { status: 400 });
  const p = {
    id: old.id || crypto.randomBytes(4).toString('hex'), provider,
    label: String(input.label ?? old.label ?? '').trim().slice(0, 40) || KINDS[provider].label.replace(/ \(.*\)$/, ''),
    model: String(input.model ?? old.model ?? '').trim().slice(0, 100),
    apiKey: typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : old.apiKey || '',
    baseUrl: input.baseUrl !== undefined ? String(input.baseUrl || '').trim() : old.baseUrl || ''
  };
  if (p.baseUrl && !/^https?:\/\/[^\s]+$/.test(p.baseUrl)) throw Object.assign(new Error('Het adres moet beginnen met http:// of https://'), { status: 400 });
  if (provider === 'custom' && !p.baseUrl) throw Object.assign(new Error('Vul het adres van de dienst in (bijvoorbeeld https://…/v1).'), { status: 400 });
  if (KINDS[provider].needsKey && !p.apiKey) throw Object.assign(new Error('Vul een API-sleutel in.'), { status: 400 });
  if (!p.model) throw Object.assign(new Error('Kies een model (klik op "Modellen ophalen").'), { status: 400 });
  if (!p.baseUrl) delete p.baseUrl;
  return p;
}

async function http(p, url, { method = 'GET', headers = {}, body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT)
    });
  } catch {
    const hint = p.provider === 'ollama' ? ' Draait Ollama op deze computer?' : ' Controleer je internetverbinding.';
    throw Object.assign(new Error(`${p.label} is niet bereikbaar.${hint}`), { status: 502 });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.error?.message || json.error || json.message || res.status;
    const msg = res.status === 401 || res.status === 403 ? `${p.label} accepteert deze API-sleutel niet. (${detail})`
      : res.status === 429 ? `${p.label}: te veel verzoeken of tegoed op. (${detail})`
      : `AI-fout bij ${p.label}: ${detail}`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return json;
}
const bearer = p => (p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {});
const anthropicHeaders = p => ({ 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' });

// Sends a prompt and returns the text.
async function complete(p, { system, user }, maxTokens) {
  if (p.provider === 'anthropic') {
    const j = await http(p, `${base(p)}/messages`, { method: 'POST', headers: anthropicHeaders(p),
      body: { model: p.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] } });
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  }
  if (p.provider === 'gemini') {
    const model = p.model.replace(/^models\//, '');
    const j = await http(p, `${base(p)}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': p.apiKey },
      body: { system_instruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } } });
    return (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('').trim();
  }
  // OpenAI and everything using the same shape (Mistral, Ollama, other services).
  const limit = p.provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
  const j = await http(p, `${base(p)}/chat/completions`, { method: 'POST', headers: bearer(p),
    body: { model: p.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...limit } });
  const c = j.choices?.[0]?.message?.content;
  return (Array.isArray(c) ? c.map(x => x.text || '').join('') : String(c || '')).trim();
}

// Fetches the available models; doubles as a check that the key works.
async function models(p) {
  if (p.provider === 'anthropic') {
    const j = await http(p, `${base(p)}/models?limit=100`, { headers: anthropicHeaders(p) });
    return (j.data || []).map(m => m.id);
  }
  if (p.provider === 'gemini') {
    const j = await http(p, `${base(p)}/models?pageSize=200`, { headers: { 'x-goog-api-key': p.apiKey } });
    return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
  }
  const j = await http(p, `${base(p)}/models`, { headers: bearer(p) });
  const skip = /embed|whisper|tts|dall-e|image|audio|moderation|transcribe|realtime|search/i;
  return (j.data || j.models || []).map(m => m.id || m.name).filter(id => id && !skip.test(id)).sort();
}

module.exports = { KINDS, list, pick, clean, complete, models, publicView };
