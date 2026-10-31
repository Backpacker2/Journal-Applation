// Leerjournaal – front-end (vanilla JS, geen build-stap nodig)
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  spaces: [],
  current: null,        // { type, slug, meta, entries, defaultTemplate }
  view: 'gedachten',    // gedachten | documenten | template
  replyTo: null,
  composeMode: 'gedachte', // gedachte | vraag
  editing: null,        // id van gedachte die bewerkt wordt
  docs: [],
  openDoc: null,
  docEdit: false,
  selecting: false,     // meerdere berichten selecteren
  selected: new Set(),
  showArchive: (() => { try { return localStorage.getItem('lj-archive') === '1'; } catch { return false; } })(),
  docFormat: (() => { try { return localStorage.getItem('lj-docformat') || 'preview'; } catch { return 'preview'; } })(),
  status: null
};

// ---------- helpers ----------
async function api(method, url, body) {
  const headers = { 'x-leerjournaal': '1', ...(body ? { 'content-type': 'application/json' } : {}) };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Fout ${res.status}`);
  if (method !== 'GET' && !url.startsWith('/api/sync') && !url.startsWith('/api/update')) {
    // Wijziging opgeslagen: de server uploadt hem zo naar GitHub; toon de voortgang.
    [600, 5500, 12000].forEach(ms => setTimeout(() => loadStatus(), ms));
  }
  return json;
}
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 2500);
}
const fail = e => toast(e.message, true);
const base = () => `/api/spaces/${state.current.type}/${state.current.slug}`;
const time = id => `${id.slice(11, 13)}:${id.slice(14, 16)}`;
const dayKey = id => id.slice(0, 10);
function dayLabel(key) {
  const d = new Date(key + 'T12:00:00');
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((today - d) / 864e5);
  if (diff === 0) return 'Vandaag';
  if (diff === 1) return 'Gisteren';
  const s = d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const subLine = c => `${plural(c.entries.filter(e => e.kind === 'gedachte').length, 'gedachte', 'gedachten')} · ${plural(c.entries.filter(e => e.kind === 'vraag').length, 'vraag', 'vragen')} · elke gedachte is een versleuteld .txt-bestand met datum en tijd`;
const isoDay = d => d.toLocaleDateString('sv-SE');
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
// Downloadt een document als .md, .txt of .docx (de server maakt het bestand).
async function downloadDoc(id, format) {
  const res = await fetch(`${base()}/documents/${id}/export/${format}`, { headers: { 'x-leerjournaal': '1' } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Fout ${res.status}`);
  const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || `document.${format}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const dlLinks = id => `<span class="dl-links">↓ ${['md', 'txt', 'docx'].map(f => `<button class="link" data-action="dl" data-id="${id}" data-format="${f}">.${f}</button>`).join(' ')}</span>`;

// Minimale Markdown-weergave (koppen, lijsten, vet, cursief, citaten, alinea's)
function md(src) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>').replace(/_(.+?)_/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  const out = []; let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const line of src.split('\n')) {
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      flushPara(); const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[1]); continue;
    }
    if ((m = line.match(/^>\s?(.*)/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    flushList(); para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

// ---------- sidebar ----------
async function loadSpaces() {
  state.spaces = await api('GET', '/api/spaces');
  renderSidebar();
}
const spaceButton = (s, extra = '') => {
  if (s.locked) return `<button class="space-item locked" data-open-keys="1" title="Versleuteld met een sleutel die ontbreekt">
        <span class="dot"></span><span class="name">Vergrendeld · sleutel ontbreekt</span></button>`;
  const active = state.current && state.current.type === s.type && state.current.slug === s.slug;
  return `<button class="space-item${active ? ' active' : ''}${extra}" data-type="${s.type}" data-slug="${esc(s.slug)}">
        <span class="dot" style="background:${s.type === 'projecten' ? 'var(--accent)' : 'var(--green)'}"></span>
        <span class="name">${esc(s.name)}</span><span class="count">${s.count ?? ''}</span></button>`;
};
const byRecent = (a, b) => (b.lastEntry || b.createdAt || '').localeCompare(a.lastEntry || a.createdAt || '');

function renderSidebar() {
  const archived = state.spaces.filter(s => s.archived).sort(byRecent);
  const box = $('#archive');
  if (box) {
    box.hidden = !archived.length;
    box.innerHTML = `<button class="archive-toggle" data-action-side="toggle-archive">${state.showArchive ? '▾' : '▸'} Archief <span class="count">${archived.length}</span></button>
      ${state.showArchive ? `<nav class="space-list">${archived.map(s => spaceButton(s, ' archived')).join('')}</nav>` : ''}`;
  }
  for (const type of ['projecten', 'chats']) {
    const items = state.spaces.filter(s => s.type === type && !s.archived).sort(byRecent);
    $('#list-' + type).innerHTML = items.length ? items.map(s => spaceButton(s)).join('') : `<div class="space-empty">${type === 'projecten' ? 'Nog geen projecten' : 'Nog geen chats'}</div>`;
  }
}
document.addEventListener('click', async e => {
  if (e.target.closest('[data-open-keys]')) return openKeys();
  if (e.target.closest('[data-action-side="toggle-archive"]')) {
    state.showArchive = !state.showArchive;
    try { localStorage.setItem('lj-archive', state.showArchive ? '1' : '0'); } catch {}
    return renderSidebar();
  }
  const item = e.target.closest('.space-item');
  if (item) return openSpace(item.dataset.type, item.dataset.slug);
  const nw = e.target.closest('[data-new]');
  if (nw) {
    const type = nw.dataset.new;
    const name = prompt(type === 'projecten' ? 'Naam van het project:' : 'Waar wil je over nadenken? Geef de chat een naam:');
    if (!name || !name.trim()) return;
    try {
      const s = await api('POST', '/api/spaces', { type, name });
      await loadSpaces();
      openSpace(s.type, s.slug);
    } catch (err) { fail(err); }
  }
});

// ---------- ruimte openen ----------
async function openSpace(type, slug, view = 'gedachten') {
  try {
    state.current = await api('GET', `/api/spaces/${type}/${slug}`);
    state.view = view; state.replyTo = null; state.composeMode = 'gedachte'; state.editing = null;
    state.openDoc = null; state.docEdit = false; state.selecting = false; state.selected.clear();
    try { localStorage.setItem('lj-last', `${type}/${slug}`); } catch {}
    renderSidebar(); render();
  } catch (e) { fail(e); }
}

function render() {
  const c = state.current; if (!c) return;
  const isProject = c.type === 'projecten';
  $('#main').innerHTML = `
    <div class="header-wrap">
      <div class="header-top">
        <div>
          <h1>${esc(c.meta.name)} <span class="badge ${isProject ? 'project' : 'chat'}">${isProject ? 'Project' : 'Chat'}</span>${c.meta.archived ? ' <span class="badge ruw">Gearchiveerd</span>' : ''}</h1>
          <div class="sub">${subLine(c)}</div>
        </div>
        <div class="header-actions">
          <button class="btn ghost small" data-action="rename-space" title="Naam wijzigen">Naam wijzigen</button>
          <button class="btn ghost small" data-action="archive-space">${c.meta.archived ? 'Uit archief halen' : 'Archiveren'}</button>
          <button class="btn primary" data-action="goto-docs">Genereer document</button>
        </div>
      </div>
      <div class="tabs">
        <button class="tab ${state.view === 'gedachten' ? 'active' : ''}" data-view="gedachten">Gedachten</button>
        <button class="tab ${state.view === 'documenten' ? 'active' : ''}" data-view="documenten">Documenten</button>
        <button class="tab ${state.view === 'template' ? 'active' : ''}" data-view="template">Template</button>
        ${isProject ? `<button class="tab" disabled title="Komt in fase 2">Kanban<span class="soon">binnenkort</span></button>
        <button class="tab" disabled title="Komt in fase 3">Feedback<span class="soon">binnenkort</span></button>` : ''}
      </div>
    </div>
    <div id="view"></div>`;
  if (state.view === 'gedachten') renderThread();
  if (state.view === 'documenten') renderDocs();
  if (state.view === 'template') renderTemplate();
}

$('#main').addEventListener('click', async e => {
  const card = state.selecting && e.target.closest('.card[data-sel]');
  if (card && !e.target.closest('textarea')) {
    const id = card.dataset.sel;
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    card.classList.toggle('selected', state.selected.has(id));
    const cb = card.querySelector('.sel-box'); if (cb) cb.checked = state.selected.has(id);
    return renderSelectBar();
  }
  const t = e.target.closest('[data-view],[data-action]');
  if (!t) return;
  if (t.dataset.view) { state.view = t.dataset.view; state.openDoc = null; state.docEdit = false; return render(); }
  const a = t.dataset.action;
  try {
    if (a === 'add-key') return addKey(t);
    if (a === 'rekey') return rekey(t);
    if (a === 'goto-docs') { state.view = 'documenten'; state.openDoc = null; return render(); }
    if (a === 'rename-space') return renameSpace();
    if (a === 'archive-space') return archiveSpace();
    if (a === 'title-entry') return titleEntry(t.dataset.id);
    if (a === 'delete-entry') return deleteEntries([t.dataset.id]);
    if (a === 'select-mode') { state.selecting = !state.selecting; state.selected.clear(); return renderThread(false); }
    if (a === 'select-all') { const all = state.current.entries.map(x => x.id); if (state.selected.size === all.length) state.selected.clear(); else all.forEach(id => state.selected.add(id)); return renderThread(false); }
    if (a === 'delete-selected') return deleteEntries([...state.selected]);
    if (a === 'share-selected') return shareEntries([...state.selected]);
    if (a === 'reply') { state.replyTo = t.dataset.id; state.composeMode = 'gedachte'; renderComposer(); $('#compose-input').focus(); }
    if (a === 'cancel-reply') { state.replyTo = null; renderComposer(); }
    if (a === 'jump') jumpTo(t.dataset.id);
    if (a === 'mode-question') { state.composeMode = state.composeMode === 'vraag' ? 'gedachte' : 'vraag'; state.replyTo = null; renderComposer(); $('#compose-input').focus(); }
    if (a === 'ai-questions') await aiQuestions(t);
    if (a === 'send') await sendCompose();
    if (a === 'save-answer') await saveAnswer(t.dataset.id);
    if (a === 'edit-answer') { state.editing = t.dataset.id; renderThread(false); }
    if (a === 'edit-thought') { state.editing = t.dataset.id; renderThread(false); }
    if (a === 'cancel-edit') { state.editing = null; renderThread(false); }
    if (a === 'save-thought') await saveThought(t.dataset.id);
    if (a === 'gen-doc') await generateDoc(t);
    if (a === 'copy-prompt') await copyPrompt();
    if (a === 'paste-doc') { state.openDoc = { id: null, kind: 'ruw', title: $('#doc-title').value || 'Ruwe versie', content: '', from: $('#doc-from').value, to: $('#doc-to').value, generatedBy: 'geplakt' }; state.docEdit = true; renderDocs(); }
    if (a === 'open-doc') { state.openDoc = await api('GET', `${base()}/documents/${t.dataset.id}`); state.docEdit = false; renderDocs(); }
    if (a === 'close-doc') { state.openDoc = null; state.docEdit = false; renderDocs(); }
    if (a === 'edit-doc') { state.docEdit = true; renderDocs(); }
    if (a === 'save-doc') await saveDoc(t.dataset.as);
    if (a === 'dl') await downloadDoc(t.dataset.id, t.dataset.format);
    if (a === 'doc-format') { state.docFormat = t.dataset.format; try { localStorage.setItem('lj-docformat', state.docFormat); } catch {} renderDocs(); }
    if (a === 'save-template') { state.current.meta = await api('PUT', base(), { template: $('#template-input').value }); toast('Template opgeslagen'); }
    if (a === 'reset-template') { $('#template-input').value = state.current.defaultTemplate; toast('Standaardtemplate teruggezet. Vergeet niet op te slaan.'); }
  } catch (err) { fail(err); }
});

// ---------- gedachten ----------
function renderThread(scroll = true) {
  const c = state.current;
  const byId = Object.fromEntries(c.entries.map(e => [e.id, e]));
  let html = '', lastDay = null;
  for (const e of c.entries) {
    const day = dayKey(e.id);
    if (day !== lastDay) { html += `<div class="divider">${dayLabel(day)}</div>`; lastDay = day; }
    html += e.kind === 'vraag' ? questionCard(e) : thoughtCard(e, byId);
  }
  if (!c.entries.length) html = `<div class="empty-state"><h1>Nog leeg</h1><p>Typ hieronder je eerste gedachte. Elke gedachte wordt apart opgeslagen met de datum en tijd.</p></div>`;
  $('#view').outerHTML = `<div id="view" style="display:contents">
      <div class="thread" id="thread"><div class="thread-inner">${html}</div></div>
      <div class="composer" id="composer"></div>
    </div>`;
  renderComposer();
  if (scroll) { const th = $('#thread'); th.scrollTop = th.scrollHeight; }
}

const selAttrs = e => state.selecting ? ` data-sel="${e.id}"` : '';
const selBox = e => state.selecting ? `<input type="checkbox" class="sel-box" ${state.selected.has(e.id) ? 'checked' : ''} tabindex="-1" aria-label="Selecteren">` : '';
const titleLine = e => e.title ? `<div class="entry-title">${esc(e.title)}</div>` : '';
const manageLinks = e => `<button class="link" data-action="title-entry" data-id="${e.id}">${e.title ? 'Naam wijzigen' : 'Naam geven'}</button><button class="link danger" data-action="delete-entry" data-id="${e.id}">Verwijder</button>`;

function thoughtCard(e, byId) {
  const parent = e.replyTo && byId[e.replyTo];
  const quote = parent ? `<button class="quote" data-action="jump" data-id="${parent.id}">
      <span class="qhead">Reactie op ${dayLabel(dayKey(parent.id)).toLowerCase()} · ${time(parent.id)}${parent.title ? ` · ${esc(parent.title)}` : ''}</span>
      <span class="qtext">${esc(parent.text || parent.question)}</span></button>`
    : e.replyTo ? `<div class="quote gone"><span class="qhead">Reactie op een verwijderde gedachte</span></div>` : '';
  const editing = state.editing === e.id;
  return `<div class="card${state.selected.has(e.id) ? ' selected' : ''}" id="e-${e.id}"${selAttrs(e)}>
    <div class="meta">${selBox(e)}<span class="time">${time(e.id)}</span><span class="file">${e.id}.txt${e.updatedAt ? ' · bewerkt' : ''}</span></div>
    ${titleLine(e)}
    ${quote}
    ${editing
      ? `<textarea class="edit-area" id="edit-${e.id}">${esc(e.text)}</textarea>
         <div class="row-end"><button class="btn small ghost" data-action="cancel-edit">Annuleer</button><button class="btn small primary" data-action="save-thought" data-id="${e.id}">Opslaan</button></div>`
      : `<div class="text">${esc(e.text)}</div>
         ${state.selecting ? '' : `<div class="actions"><button class="link accent" data-action="reply" data-id="${e.id}">Reageer</button><button class="link" data-action="edit-thought" data-id="${e.id}">Bewerk</button>${manageLinks(e)}</div>`}`}
  </div>`;
}

function questionCard(e) {
  const isAi = e.source === 'ai';
  const editing = state.editing === e.id || !e.answer;
  return `<div class="card qcard ${isAi ? 'ai' : 'ik'}${state.selected.has(e.id) ? ' selected' : ''}" id="e-${e.id}"${selAttrs(e)}>
    <div class="meta">${selBox(e)}<span class="qlabel">${isAi ? 'Vraag van AI' : 'Eigen vraag'}</span><span class="file">${time(e.id)} · ${e.id}.txt</span></div>
    ${titleLine(e)}
    <div class="question">${esc(e.question)}</div>
    <div class="answer">
      <span class="lbl">Mijn antwoord</span>
      ${editing && !state.selecting
        ? `<textarea id="ans-${e.id}" placeholder="Typ je antwoord…">${esc(e.answer)}</textarea>
           <div class="row-end">${e.answer ? '<button class="btn small ghost" data-action="cancel-edit">Annuleer</button>' : ''}<button class="btn small primary" data-action="save-answer" data-id="${e.id}">Opslaan</button></div>`
        : `<div class="text">${esc(e.answer) || '<span class="hint">Nog niet beantwoord</span>'}</div>${state.selecting ? '' : `<div class="actions"><button class="link" data-action="edit-answer" data-id="${e.id}">Bewerk antwoord</button><button class="link accent" data-action="reply" data-id="${e.id}">Reageer</button></div>`}`}
    </div>
    ${state.selecting ? '' : `<div class="actions">${manageLinks(e)}</div>`}
  </div>`;
}

function renderSelectBar() {
  const el = $('#composer'); if (!el) return;
  const n = state.selected.size, all = state.current.entries.length;
  el.innerHTML = `<div class="select-bar">
      <span><b>${n}</b> geselecteerd</span>
      <button class="btn small ghost" data-action="select-all">${n === all && all ? 'Niets' : 'Alles'} selecteren</button>
      <span class="spacer-h"></span>
      <button class="btn small" data-action="share-selected" ${n ? '' : 'disabled'}>Delen</button>
      <button class="btn small danger" data-action="delete-selected" ${n ? '' : 'disabled'}>Verwijderen</button>
      <button class="btn small primary" data-action="select-mode">Klaar</button>
    </div>`;
}

function renderComposer() {
  const c = state.current, el = $('#composer'); if (!el) return;
  if (state.selecting) return renderSelectBar();
  const parent = state.replyTo && c.entries.find(e => e.id === state.replyTo);
  const isQ = state.composeMode === 'vraag';
  el.innerHTML = `
    ${parent ? `<div class="reply-bar"><span><b>Reageer op ${time(parent.id)}:</b> ${esc(parent.text || parent.question)}</span><button class="link" data-action="cancel-reply">✕</button></div>` : ''}
    <div class="tools">
      <button class="btn small chip-ai" data-action="ai-questions">✦ AI-vragen genereren</button>
      <button class="btn small chip-own" data-action="mode-question">${isQ ? '← Terug naar gedachte' : '+ Eigen vraag toevoegen'}</button>
      ${c.entries.length ? '<button class="btn small ghost" data-action="select-mode">☐ Selecteren</button>' : ''}
      ${isQ ? '<span class="mode-pill">Je typt nu een vraag aan jezelf. Het antwoord geef je in het kaartje.</span>' : ''}
    </div>
    <div class="input-row">
      <textarea id="compose-input" rows="1" placeholder="${isQ ? 'Typ je vraag…' : 'Typ je gedachte… (Enter = opslaan, Shift+Enter = nieuwe regel)'}"></textarea>
      <button class="btn primary" data-action="send">Opslaan</button>
    </div>`;
  const ta = $('#compose-input');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
  ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); sendCompose().catch(fail); } });
}

async function sendCompose() {
  const ta = $('#compose-input'); const text = ta.value.trim(); if (!text) return;
  ta.disabled = true;
  try {
    const body = state.composeMode === 'vraag'
      ? { kind: 'vraag', question: text, source: 'ik' }
      : { kind: 'gedachte', text, replyTo: state.replyTo };
    const entry = await api('POST', `${base()}/entries`, body);
    state.current.entries.push(entry);
    state.replyTo = null; state.composeMode = 'gedachte';
    renderThread(); bumpCount(1);
    $('#compose-input').focus();
  } finally { if (ta.isConnected) ta.disabled = false; }
}

function bumpCount(n) {
  const s = state.spaces.find(s => s.type === state.current.type && s.slug === state.current.slug);
  if (s) { s.count = (s.count || 0) + n; s.lastEntry = state.current.entries.at(-1)?.id; renderSidebar(); }
  const sub = $('.header .sub, .header-top .sub');
  if (sub) sub.textContent = subLine(state.current);
}

async function saveAnswer(id) {
  const answer = $('#ans-' + id).value;
  const updated = await api('PUT', `${base()}/entries/${id}`, { answer });
  replaceEntry(updated); state.editing = null; renderThread(false); toast('Antwoord opgeslagen');
}
async function saveThought(id) {
  const text = $('#edit-' + id).value;
  const updated = await api('PUT', `${base()}/entries/${id}`, { text });
  replaceEntry(updated); state.editing = null; renderThread(false);
}
async function titleEntry(id) {
  const e = state.current.entries.find(x => x.id === id); if (!e) return;
  const title = prompt('Naam voor dit bericht (leeg laten = geen naam):', e.title || '');
  if (title === null) return;
  replaceEntry(await api('PUT', `${base()}/entries/${id}`, { title }));
  renderThread(false); toast(title.trim() ? 'Naam opgeslagen' : 'Naam verwijderd');
}

async function deleteEntries(ids) {
  if (!ids.length) return;
  const msg = ids.length === 1 ? 'Dit bericht verwijderen? Dit kun je in de app niet ongedaan maken.' : `${ids.length} berichten verwijderen? Dit kun je in de app niet ongedaan maken.`;
  if (!confirm(msg)) return;
  const r = await api('POST', `${base()}/entries/delete`, { ids });
  state.current.entries = state.current.entries.filter(e => !ids.includes(e.id));
  state.selected.clear();
  if (!state.current.entries.length) state.selecting = false;
  renderThread(false); bumpCount(-r.deleted);
  toast(r.deleted === 1 ? 'Bericht verwijderd' : `${r.deleted} berichten verwijderd`);
}

function entriesAsText(ids) {
  const pick = state.current.entries.filter(e => ids.includes(e.id));
  const when = e => new Date(e.createdAt || `${e.id.slice(0, 10)}T${e.id.slice(11, 13)}:${e.id.slice(14, 16)}`).toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${state.current.meta.name}\n\n` + pick.map(e => {
    const head = `${when(e)}${e.title ? ` – ${e.title}` : ''}`;
    return e.kind === 'vraag'
      ? `${head}\nVraag${e.source === 'ai' ? ' (AI)' : ''}: ${e.question}\nAntwoord: ${e.answer || '(nog niet beantwoord)'}`
      : `${head}\n${e.text}`;
  }).join('\n\n');
}

async function shareEntries(ids) {
  const text = entriesAsText(ids);
  if (navigator.share) {
    try { await navigator.share({ title: state.current.meta.name, text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  await navigator.clipboard.writeText(text);
  toast(`${ids.length === 1 ? 'Bericht' : ids.length + ' berichten'} gekopieerd. Plak ze waar je wilt.`);
}

async function renameSpace() {
  const name = prompt('Nieuwe naam:', state.current.meta.name);
  if (!name || !name.trim() || name.trim() === state.current.meta.name) return;
  state.current.meta = await api('PUT', base(), { name });
  const s = state.spaces.find(x => x.type === state.current.type && x.slug === state.current.slug);
  if (s) s.name = state.current.meta.name;
  renderSidebar(); render(); toast('Naam gewijzigd');
}

async function archiveSpace() {
  const archived = !state.current.meta.archived;
  state.current.meta = await api('PUT', base(), { archived });
  const s = state.spaces.find(x => x.type === state.current.type && x.slug === state.current.slug);
  if (s) s.archived = archived;
  renderSidebar(); render();
  toast(archived ? 'Gearchiveerd. Je vindt hem onder Archief in de zijbalk.' : 'Uit het archief gehaald');
}

function replaceEntry(u) {
  const i = state.current.entries.findIndex(e => e.id === u.id);
  if (i >= 0) state.current.entries[i] = u;
}
function jumpTo(id) {
  const el = $('#e-' + id); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
}

async function aiQuestions(btn) {
  btn.disabled = true; btn.textContent = 'Vragen bedenken…';
  try {
    const qs = await api('POST', `${base()}/ai/questions`);
    state.current.entries.push(...qs); renderThread(); bumpCount(qs.length);
  } catch (e) {
    fail(e); btn.disabled = false; btn.textContent = '✦ AI-vragen genereren';
  }
}

// ---------- documenten ----------
async function renderDocs() {
  const view = $('#view');
  view.outerHTML = `<div id="view" class="page"><div class="page-inner" id="docs-inner"><div class="hint">Laden…</div></div></div>`;
  const inner = $('#docs-inner');
  try {
    if (state.openDoc) return renderOpenDoc(inner);
    state.docs = await api('GET', `${base()}/documents`);
    const today = new Date(); const twoWeeks = new Date(Date.now() - 13 * 864e5);
    const ai = state.status?.aiEnabled;
    inner.innerHTML = `
      <div class="panel">
        <h2>Document genereren</h2>
        <div class="sub">De AI ordent alleen jouw eigen gedachten en antwoorden volgens het template van ${state.current.type === 'projecten' ? 'dit project' : 'deze chat'}. Hij voegt niets toe.</div>
        ${ai ? '' : '<div class="notice">Er is geen API-sleutel ingesteld. Gebruik "Kopieer prompt", plak die in Claude, en zet het resultaat terug via "Plak resultaat".</div>'}
        <div class="form-row">
          <label class="field grow">Titel<input id="doc-title" value="${state.current.type === 'projecten' ? 'Sprint' : esc(state.current.meta.name)}"></label>
          <label class="field">Van<input type="date" id="doc-from" value="${isoDay(twoWeeks)}"></label>
          <label class="field">Tot en met<input type="date" id="doc-to" value="${isoDay(today)}"></label>
        </div>
        <div class="form-row">
          <button class="btn primary" data-action="gen-doc" ${ai ? '' : 'disabled'}>Genereer ruwe versie</button>
          <button class="btn" data-action="copy-prompt">Kopieer prompt</button>
          <button class="btn ghost" data-action="paste-doc">Plak resultaat</button>
        </div>
      </div>
      <div class="panel">
        <h2>Documenten</h2>
        ${state.docs.length ? `<div class="doc-list">${state.docs.map(d => `
          <div class="doc-row">
            <button class="doc-title link-like" data-action="open-doc" data-id="${d.id}">${esc(d.title)}</button>
            <span><span class="badge ${d.kind}">${d.kind === 'eind' ? 'Eindversie' : 'Ruwe versie'}</span></span>
            <span class="doc-date">${d.createdAt ? fmtDateTime(d.createdAt) : ''}${d.from ? ` · ${d.from.slice(5)} t/m ${(d.to || '').slice(5)}` : ''}</span>
            ${dlLinks(d.id)}
          </div>`).join('')}</div>` : '<div class="hint">Nog geen documenten.</div>'}
      </div>`;
  } catch (e) { fail(e); }
}

function renderOpenDoc(inner) {
  const d = state.openDoc;
  const header = `<div class="form-row" style="justify-content:space-between">
      <button class="btn ghost" data-action="close-doc">← Alle documenten</button>
      <div class="form-row">
        ${state.docEdit ? '' : `<div class="seg">${[['preview', 'Preview'], ['md', 'md'], ['txt', 'txt']].map(([f, l]) => `<button class="${state.docFormat === f ? 'on' : ''}" data-action="doc-format" data-format="${f}">${l}</button>`).join('')}</div>
          <div class="dl-menu"><span class="hint">Download</span>${['md', 'txt', 'docx'].map(f => `<button class="btn small" data-action="dl" data-id="${d.id}" data-format="${f}">.${f}</button>`).join('')}</div>
          <button class="btn" data-action="edit-doc">Bewerken</button>`}
      </div></div>`;
  if (state.docEdit) {
    const isNew = !d.id;
    inner.innerHTML = `${header}
      <div class="panel">
        <label class="field grow">Titel<input id="doc-edit-title" value="${esc(d.title)}"></label>
        ${isNew ? '<div class="sub">Plak hier het document dat Claude voor je heeft gemaakt.</div>' : ''}
        <textarea class="doc-editor" id="doc-edit-content">${esc(d.content)}</textarea>
        <div class="row-end">
          <button class="btn ghost" data-action="${isNew ? 'close-doc' : 'open-doc'}" data-id="${d.id || ''}">Annuleer</button>
          ${isNew ? '<button class="btn primary" data-action="save-doc" data-as="ruw">Opslaan als ruwe versie</button>'
            : `${d.kind === 'eind' ? '<button class="btn primary" data-action="save-doc" data-as="update">Opslaan</button>'
              : '<button class="btn primary" data-action="save-doc" data-as="eind">Opslaan als eindversie</button>'}`}
        </div>
      </div>`;
    return;
  }
  inner.innerHTML = `${header}
    <div class="panel">
      <div class="form-row" style="gap:8px"><span class="badge ${d.kind}">${d.kind === 'eind' ? 'Eindversie' : 'Ruwe versie'}</span>
        <span class="hint">${fmtDateTime(d.createdAt)} · ${esc(d.generatedBy || '')}${d.from ? ` · gedachten van ${d.from} t/m ${d.to}` : ''}</span></div>
      ${state.docFormat === 'md' ? `<pre class="doc-raw">${esc(d.content)}</pre>`
        : state.docFormat === 'txt' ? '<pre class="doc-raw" id="doc-txt">Laden…</pre>'
        : `<div class="doc-view">${md(d.content)}</div>`}
    </div>`;
  if (state.docFormat === 'txt') {
    fetch(`${base()}/documents/${d.id}/export/txt`, { headers: { 'x-leerjournaal': '1' } })
      .then(r => r.text()).then(t => { const el = $('#doc-txt'); if (el) el.textContent = t; }).catch(fail);
  }
}

async function saveDoc(as) {
  const d = state.openDoc;
  const title = $('#doc-edit-title').value, content = $('#doc-edit-content').value;
  if (as === 'update') state.openDoc = await api('PUT', `${base()}/documents/${d.id}`, { title, content });
  else state.openDoc = await api('POST', `${base()}/documents`, { kind: as, title, content, from: d.from, to: d.to, basedOn: d.id || null, generatedBy: as === 'eind' ? 'bewerkt door mij' : d.generatedBy });
  state.docEdit = false; toast(as === 'eind' ? 'Eindversie opgeslagen' : 'Opgeslagen'); renderDocs();
}

function docParams() {
  return { title: $('#doc-title').value.trim(), from: $('#doc-from').value, to: $('#doc-to').value };
}
async function generateDoc(btn) {
  btn.disabled = true; btn.textContent = 'Bezig met schrijven… (kan een minuut duren)';
  try {
    state.openDoc = await api('POST', `${base()}/ai/document`, docParams());
    state.docEdit = false; renderDocs();
  } catch (e) { fail(e); btn.disabled = false; btn.textContent = 'Genereer ruwe versie'; }
}
async function copyPrompt() {
  const { prompt, count } = await api('POST', `${base()}/prompt`, docParams());
  await navigator.clipboard.writeText(prompt);
  toast(`Prompt gekopieerd (${count} items). Plak hem in Claude.`);
}

// ---------- template ----------
function renderTemplate() {
  $('#view').outerHTML = `<div id="view" class="page"><div class="page-inner">
    <div class="panel">
      <h2>Template voor documenten</h2>
      <div class="sub">Dit template bepaalt hoe het document van ${state.current.type === 'projecten' ? 'dit project' : 'deze chat'} eruitziet: de kopjes, de taal en de toon. Gebruik {titel} voor de titel die je bij het genereren invult.</div>
      <textarea class="doc-editor template-editor" id="template-input">${esc(state.current.meta.template || '')}</textarea>
      <div class="row-end"><button class="btn ghost" data-action="reset-template">Standaardtemplate</button><button class="btn primary" data-action="save-template">Opslaan</button></div>
    </div></div></div>`;
}

// ---------- sync & thema ----------
async function loadStatus() {
  try {
    state.status = await api('GET', '/api/status');
    const s = state.status;
    const hhmm = iso => new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const n = s.pending > 0 ? s.pending : 0;
    const dot = $('.sync-line .dot');
    $('#sync-status').textContent = !s.hasRemote ? 'Lokaal opgeslagen · nog geen GitHub gekoppeld'
      : s.syncing ? 'Uploaden naar GitHub…'
      : s.lastSyncError ? `Upload mislukt${s.nextRetry ? ` · opnieuw om ${hhmm(s.nextRetry)}` : ''} · klik voor details`
      : n ? `${n} ${n === 1 ? 'wijziging wacht' : 'wijzigingen wachten'} op upload…`
      : s.lastSync ? `Alles staat op GitHub · ${hhmm(s.lastSync)}`
      : 'GitHub gekoppeld · nog niet gesynchroniseerd';
    if (dot) dot.style.background = !s.hasRemote ? '' : s.lastSyncError ? 'var(--red)' : (s.syncing || n) ? 'var(--amber)' : '';
    const st = $('#sync-status');
    st.style.cursor = s.lastSyncError ? 'pointer' : '';
    st.onclick = s.lastSyncError ? () => alert(`Sync mislukt bij ${s.lastSyncError.step}.\n\n${s.lastSyncError.message}\n\nTechnische melding:\n${s.lastSyncError.detail}`) : null;
    if (s.keyCreatedNow && !sessionStorage.getItem('lj-key-warned')) {
      sessionStorage.setItem('lj-key-warned', '1');
      toast(`Nieuwe sleutel gemaakt in ${s.keyFile}. Maak er een back-up van!`, true);
    }
  } catch (e) { $('#sync-status').textContent = 'Server niet bereikbaar'; }
}
$('#sync-btn').addEventListener('click', async e => {
  const b = e.currentTarget; b.disabled = true; b.textContent = 'Bezig…';
  try { await api('POST', '/api/sync'); toast('Gesynchroniseerd met GitHub'); }
  catch (err) { fail(err); }
  finally { b.disabled = false; b.textContent = 'Sync met GitHub'; loadStatus(); }
});
$('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('lj-theme', next); } catch {}
});

// ---------- sleutels ----------
async function openKeys() {
  state.current = null; renderSidebar();
  $('#main').innerHTML = `<div class="header-wrap" style="padding-bottom:18px"><h1>Sleutels</h1>
    <div class="sub">Je hoofdsleutel versleutelt alles wat je nu schrijft. Oude sleutels gebruikt de app alleen om oudere bestanden te lezen.</div></div>
    <div class="page"><div class="page-inner" id="keys-inner"><div class="hint">Laden…</div></div></div>`;
  try {
    const k = await api('GET', '/api/keys');
    const onOld = k.keys.filter(x => !x.primary).reduce((n, x) => n + x.files, 0);
    $('#keys-inner').innerHTML = `
      ${k.unreadable
        ? `<div class="notice bad">${k.unreadable} van de ${k.total} bestanden kan de app niet lezen.${k.missing.length ? ` Ontbrekende sleutel${k.missing.length > 1 ? 's' : ''}: ${k.missing.map(m => `<span class="mono">${esc(m.id)}</span> (${m.files})`).join(', ')}.` : ''} Voeg hieronder de oude sleutel toe.</div>`
        : `<div class="notice ok">Alle ${k.total} bestanden zijn leesbaar.</div>`}
      <div class="panel">
        <h2>Je sleutels</h2>
        <table class="key-table"><thead><tr><th>Sleutel-ID</th><th>Bestand</th><th>Rol</th><th>Bestanden</th></tr></thead><tbody>
          ${k.keys.map(x => `<tr><td class="mono">${esc(x.id)}</td><td class="mono">${esc(x.source)}</td>
            <td>${x.primary ? '<span class="badge project">Hoofdsleutel</span>' : '<span class="badge ruw">Oud, alleen lezen</span>'}</td><td>${x.files}</td></tr>`).join('')}
        </tbody></table>
        <div class="sub">Sleutels staan in <span class="mono">${esc(k.keyDir)}</span>. Elk <span class="mono">.key</span>-bestand in die map wordt automatisch geladen.</div>
      </div>
      <div class="panel">
        <h2>Oude sleutel toevoegen</h2>
        <div class="sub">Open het <code>secret.key</code> van je vorige versie en plak de inhoud hieronder. Op een Mac kopieer je hem met: <code>pbcopy &lt; pad/naar/oude-map/secret.key</code></div>
        <textarea class="key-input" id="key-input" placeholder="Bijvoorbeeld: q3V9…=" spellcheck="false" autocomplete="off"></textarea>
        <div class="row-end"><button class="btn primary" data-action="add-key">Sleutel toevoegen</button></div>
      </div>
      <div class="panel">
        <h2>Alles omzetten naar je hoofdsleutel</h2>
        <div class="sub">Versleutelt bestanden die nog met een oude sleutel zijn opgeslagen opnieuw met je hoofdsleutel. Daarna heb je alleen je hoofdsleutel nog nodig. Bewaar de oude sleutel toch, voor oudere versies in je GitHub-geschiedenis.</div>
        <div class="row-end"><button class="btn" data-action="rekey" ${onOld ? '' : 'disabled'}>${onOld ? `${onOld} bestanden omzetten` : 'Niets om te zetten'}</button></div>
      </div>`;
  } catch (e) { fail(e); }
}
async function addKey(btn) {
  const value = $('#key-input').value.trim();
  if (!value) return toast('Plak eerst een sleutel', true);
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/keys', { key: value });
    toast(r.added ? `Sleutel ${r.id} toegevoegd` : r.message);
    await loadSpaces(); openKeys();
  } catch (e) { fail(e); btn.disabled = false; }
}
async function rekey(btn) {
  btn.disabled = true; btn.textContent = 'Bezig…';
  try { const r = await api('POST', '/api/keys/rekey'); toast(`${r.changed} bestanden omgezet`); openKeys(); }
  catch (e) { fail(e); btn.disabled = false; }
}
$('#keys-btn').addEventListener('click', openKeys);

// ---------- updates ----------
async function checkUpdate() {
  try {
    const u = await api('GET', '/api/update');
    $('#version').textContent = `Versie ${u.version}${u.commit ? ' · ' + u.commit : ''}`;
    const box = $('#update-box');
    if (!u.available) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<b>Update beschikbaar</b>
      <span>${u.behind} ${u.behind === 1 ? 'wijziging' : 'wijzigingen'}. Je gedachten en sleutel blijven gewoon staan.</span>
      ${u.changes.length ? `<ul>${u.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${u.dirty ? '<span class="warn">Je hebt zelf app-bestanden aangepast; commit die eerst.</span>' : ''}
      <button class="btn small primary" id="update-btn" ${u.dirty ? 'disabled' : ''}>Nu bijwerken</button>`;
    $('#update-btn').addEventListener('click', applyUpdate);
  } catch { /* geen internet of geen git: gewoon doorgaan */ }
}
async function applyUpdate(e) {
  const b = e.currentTarget; b.disabled = true; b.textContent = 'Bijwerken…';
  try {
    const r = await api('POST', '/api/update');
    if (!r.updated) { toast('Al bijgewerkt'); return checkUpdate(); }
    b.textContent = 'Opnieuw starten…';
    for (let i = 0; i < 40; i++) {
      await new Promise(res => setTimeout(res, 500));
      try { const s = await api('GET', '/api/status'); if (s.commit === r.to) return location.reload(); } catch {}
    }
    toast('De app reageert niet. Start hem opnieuw met start.command.', true);
  } catch (err) { fail(err); b.disabled = false; b.textContent = 'Nu bijwerken'; }
}

// ---------- start ----------
(async () => {
  await Promise.all([loadSpaces().catch(fail), loadStatus()]);
  checkUpdate();
  setInterval(checkUpdate, 30 * 60e3);
  setInterval(loadStatus, 15e3);
  const locked = state.spaces.filter(s => s.locked).length;
  if (locked && locked === state.spaces.length) return openKeys();
  if (locked) toast(`${locked} ${locked === 1 ? 'ruimte is' : 'ruimtes zijn'} vergrendeld. Voeg je oude sleutel toe via Sleutels.`, true);
  let last = null; try { last = localStorage.getItem('lj-last'); } catch {}
  if (last) {
    const [type, slug] = last.split('/');
    if (state.spaces.some(s => s.type === type && s.slug === slug)) openSpace(type, slug);
  }
})();
