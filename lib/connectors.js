// Koppelingen met Trello en Jira. Beide geven dezelfde vorm terug, zodat de synchronisatie ze gelijk behandelt:
//   kolom: { id, name, statusIds? }
//   kaart: { remoteId, key, title, description, column, url, updatedAt, pos }

const TIMEOUT = 20000;

async function http(url, { method = 'GET', headers = {}, body, service }) {
  let res;
  try {
    res = await fetch(url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      signal: AbortSignal.timeout(TIMEOUT)
    });
  } catch (e) {
    throw Object.assign(new Error(`${service} is niet bereikbaar. Controleer je internet en probeer het opnieuw.`), { status: 502, network: true });
  }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const detail = json?.errorMessages?.join(' ') || Object.values(json?.errors || {}).join(' ') || json?.message || text.slice(0, 200);
    const msg = res.status === 401 ? `${service} accepteert je inloggegevens niet. Controleer ze onder Instellingen → Koppelingen.`
      : res.status === 403 ? `${service} geeft je hier geen toestemming voor.${detail ? ' (' + detail + ')' : ''}`
      : res.status === 404 ? `${service} kan dit niet vinden.${detail ? ' (' + detail + ')' : ''}`
      : res.status === 429 ? `${service} vraagt om even te wachten (te veel verzoeken). Probeer het zo opnieuw.`
      : `${service} gaf een fout (${res.status}).${detail ? ' ' + detail : ''}`;
    throw Object.assign(new Error(msg), { status: res.status === 401 ? 400 : 502, remoteStatus: res.status });
  }
  return json;
}

// ---------- Trello ----------
class Trello {
  constructor({ key, token }) {
    this.kind = 'trello'; this.label = 'Trello';
    this.base = process.env.LJ_TRELLO_API || 'https://api.trello.com/1';
    this.auth = `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
  }
  url(p, q = '') { return `${this.base}${p}${p.includes('?') ? '&' : '?'}${this.auth}${q ? '&' + q : ''}`; }
  call(p, opts = {}) { return http(this.url(p, opts.q), { ...opts, service: 'Trello' }); }

  async whoami() { const m = await this.call('/members/me', { q: 'fields=fullName,username' }); return m.fullName || m.username; }
  async listTargets() {
    const boards = await this.call('/members/me/boards', { q: 'filter=open&fields=name' });
    return boards.map(b => ({ id: b.id, name: b.name }));
  }
  async getColumns(target) {
    const lists = await this.call(`/boards/${target.id}/lists`, { q: 'filter=open&fields=name,pos' });
    return lists.sort((a, b) => a.pos - b.pos).map(l => ({ id: l.id, name: l.name }));
  }
  map(c) {
    return { remoteId: c.id, key: null, title: c.name, description: c.desc || '', column: c.idList, url: c.shortUrl || c.url || null, updatedAt: c.dateLastActivity || null, pos: c.pos };
  }
  async listCards(target) {
    const cards = await this.call(`/boards/${target.id}/cards`, { q: 'filter=open&fields=name,desc,idList,pos,dateLastActivity,shortUrl' });
    return cards.sort((a, b) => a.pos - b.pos).map(c => this.map(c));
  }
  async getCard(target, columns, remoteId) {
    return this.map(await this.call(`/cards/${remoteId}`, { q: 'fields=name,desc,idList,pos,dateLastActivity,shortUrl' }));
  }
  async createCard(target, columns, card) {
    const c = await this.call('/cards', { method: 'POST', body: { idList: card.column, name: card.title, desc: card.description || '', pos: 'bottom' } });
    return this.map(c);
  }
  async updateCard(target, columns, remoteId, patch) {
    const body = {};
    if ('title' in patch) body.name = patch.title;
    if ('description' in patch) body.desc = patch.description;
    if ('column' in patch) { body.idList = patch.column; body.pos = 'bottom'; }
    return this.map(await this.call(`/cards/${remoteId}`, { method: 'PUT', body }));
  }
  async archiveCard(target, remoteId) { await this.call(`/cards/${remoteId}`, { method: 'PUT', body: { closed: true } }); }
  async addColumn(target, name) {
    const l = await this.call('/lists', { method: 'POST', body: { name, idBoard: target.id, pos: 'bottom' } });
    return { id: l.id, name: l.name };
  }
}

// ---------- Jira Cloud ----------
// Beschrijvingen in Jira zijn "Atlassian Document Format"; wij gebruiken platte tekst.
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content || []).map(adfToText).join('');
  if (['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type)) return inner + '\n';
  return inner;
}
const textToAdf = text => ({
  type: 'doc', version: 1,
  content: String(text || '').split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
});

class Jira {
  constructor({ site, email, token }) {
    this.kind = 'jira'; this.label = 'Jira';
    const s = String(site || '').trim().replace(/\/+$/, '');
    // Alleen https, behalve voor tests op je eigen computer.
    this.base = /^https?:\/\//.test(s) ? (s.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(s) ? s.replace('http://', 'https://') : s) : `https://${s}`;
    this.headers = { authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') };
  }
  call(p, opts = {}) { return http(this.base + p, { ...opts, headers: this.headers, service: 'Jira' }); }

  async whoami() { const m = await this.call('/rest/api/3/myself'); return m.displayName || m.emailAddress; }
  async listTargets() {
    const r = await this.call('/rest/api/3/project/search?maxResults=100&orderBy=name');
    return (r.values || []).map(p => ({ id: p.key, name: `${p.name} (${p.key})` }));
  }
  // Kolommen van het bord van dit project (zoals het team ze ziet); anders de statussen van het project.
  async getColumns(target) {
    try {
      const boards = await this.call(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(target.id)}&maxResults=10`);
      const board = (boards.values || [])[0];
      if (board) {
        const conf = await this.call(`/rest/agile/1.0/board/${board.id}/configuration`);
        const cols = (conf.columnConfig?.columns || []).filter(c => (c.statuses || []).length);
        if (cols.length) return cols.map((c, i) => ({ id: `kol${i + 1}`, name: c.name, statusIds: c.statuses.map(s => String(s.id)) }));
      }
    } catch (e) { if (e.remoteStatus === 401) throw e; }
    const types = await this.call(`/rest/api/3/project/${encodeURIComponent(target.id)}/statuses`);
    const order = { new: 0, indeterminate: 1, done: 2 };
    const seen = new Map();
    for (const t of types || []) for (const s of t.statuses || []) if (!seen.has(s.id)) seen.set(s.id, s);
    return [...seen.values()].sort((a, b) => (order[a.statusCategory?.key] ?? 1) - (order[b.statusCategory?.key] ?? 1))
      .map(s => ({ id: `st${s.id}`, name: s.name, statusIds: [String(s.id)] }));
  }
  columnFor(columns, statusId) { return columns.find(c => (c.statusIds || []).includes(String(statusId)))?.id || null; }
  map(issue, columns) {
    const f = issue.fields || {};
    return {
      remoteId: issue.id, key: issue.key, title: f.summary || '', description: adfToText(f.description).replace(/\n+$/, ''),
      column: this.columnFor(columns, f.status?.id), url: `${this.base}/browse/${issue.key}`, updatedAt: f.updated || null
    };
  }
  async listCards(target, columns) {
    const out = []; let next;
    const jql = `project = "${target.id}" AND (statusCategory != Done OR updated >= -30d) ORDER BY created ASC`;
    for (let page = 0; page < 10; page++) {
      const r = await this.call('/rest/api/3/search/jql', { method: 'POST', body: { jql, fields: ['summary', 'description', 'status', 'updated'], maxResults: 100, ...(next ? { nextPageToken: next } : {}) } });
      for (const i of r.issues || []) { const c = this.map(i, columns); if (c.column) out.push(c); }
      next = r.nextPageToken; if (!next || r.isLast) break;
    }
    return out;
  }
  async issueTypeId(target) {
    const r = await this.call(`/rest/api/3/issue/createmeta/${encodeURIComponent(target.id)}/issuetypes?maxResults=50`);
    const types = (r.issueTypes || r.values || []).filter(t => !t.subtask);
    const pick = types.find(t => /story/i.test(t.name)) || types.find(t => /task|taak/i.test(t.name)) || types[0];
    if (!pick) throw Object.assign(new Error('Jira: geen soort issue gevonden om aan te maken in dit project.'), { status: 502 });
    return pick.id;
  }
  async transition(key, columns, columnId) {
    const col = columns.find(c => c.id === columnId);
    if (!col) return;
    const r = await this.call(`/rest/api/3/issue/${key}/transitions`);
    const t = (r.transitions || []).find(x => col.statusIds.includes(String(x.to?.id)));
    if (!t) throw Object.assign(new Error(`Jira staat niet toe dat ${key} direct naar “${col.name}” gaat. Zet hem in Jira zelf over, of kies een tussenstap.`), { status: 409 });
    await this.call(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id: t.id } } });
  }
  async getIssue(key, columns) {
    return this.map(await this.call(`/rest/api/3/issue/${key}?fields=summary,description,status,updated`), columns);
  }
  async getCard(target, columns, key) { return this.getIssue(key, columns); }
  async createCard(target, columns, card) {
    const created = await this.call('/rest/api/3/issue', { method: 'POST', body: { fields: {
      project: { key: target.id }, summary: card.title, issuetype: { id: await this.issueTypeId(target) },
      ...(card.description ? { description: textToAdf(card.description) } : {})
    } } });
    let issue = await this.getIssue(created.key, columns);
    if (card.column && issue.column !== card.column) {
      try { await this.transition(created.key, columns, card.column); issue = await this.getIssue(created.key, columns); } catch {}
    }
    return issue;
  }
  async updateCard(target, columns, remoteId, patch) {
    const fields = {};
    if ('title' in patch) fields.summary = patch.title;
    if ('description' in patch) fields.description = textToAdf(patch.description);
    if (Object.keys(fields).length) await this.call(`/rest/api/3/issue/${remoteId}`, { method: 'PUT', body: { fields } });
    if ('column' in patch) await this.transition(remoteId, columns, patch.column);
    return this.getIssue(remoteId, columns);
  }
  async archiveCard() {
    throw Object.assign(new Error('Issues verwijder je in Jira zelf; dat is in een groepsproject veiliger.'), { status: 409 });
  }
  async addColumn() {
    throw Object.assign(new Error('Kolommen pas je aan in Jira zelf (Bord → Bordinstellingen → Kolommen). Daarna op Verversen klikken.'), { status: 409 });
  }
}

function makeAdapter(kind, creds) {
  if (kind === 'trello') return new Trello(creds || {});
  if (kind === 'jira') return new Jira(creds || {});
  throw Object.assign(new Error('Onbekende koppeling'), { status: 400 });
}

module.exports = { makeAdapter, adfToText, textToAdf };
