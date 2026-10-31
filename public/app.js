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
async function downloadDoc(id, format, type, slug) {
  const root = type ? `/api/spaces/${type}/${slug}` : base();
  const res = await fetch(`${root}/documents/${id}/export/${format}`, { headers: { 'x-leerjournaal': '1' } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Fout ${res.status}`);
  const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || `document.${format}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const dlLinks = (id, type = '', slug = '') => `<span class="dl-links">↓ ${['md', 'txt', 'docx'].map(f => `<button class="link" data-action="dl" data-id="${id}" data-format="${f}"${type ? ` data-type="${type}" data-slug="${slug}"` : ''}>.${f}</button>`).join(' ')}</span>`;

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
  const ad = $('#all-docs-btn'); if (ad) ad.classList.toggle('active', state.mainMode === 'docs');
  const sb = $('#settings-btn'); if (sb) sb.classList.toggle('on', state.mainMode === 'settings');
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
  state.mainMode = null;
  try {
    state.current = await api('GET', `/api/spaces/${type}/${slug}`);
    state.view = view; state.replyTo = null; state.composeMode = 'gedachte'; state.editing = null;
    state.openDoc = null; state.docEdit = false; state.selecting = false; state.selected.clear();
    try { localStorage.setItem('lj-last', `${type}/${slug}`); } catch {}
    renderSidebar(); render();
  } catch (e) { fail(e); }
}

function setTopbar(title) { const el = $('#topbar-title'); if (el) el.textContent = title || 'Leerjournaal'; }
function closeDrawer() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open'); }
$('#menu-btn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); });
$('#scrim').addEventListener('click', closeDrawer);
// Op de telefoon: na een keuze in het menu sluit het menu vanzelf.
$('#sidebar').addEventListener('click', e => { if (e.target.closest('.space-item, .nav-item, #settings-btn, #keys-btn, [data-open-keys]')) closeDrawer(); });

function render() {
  const c = state.current; if (!c) return;
  setTopbar(c.meta.name);
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
        ${isProject && feature('kanban') ? `<button class="tab ${state.view === 'kanban' ? 'active' : ''}" data-view="kanban">Kanban</button>` : ''}
        ${isProject && feature('feedback') ? `<button class="tab ${state.view === 'feedback' ? 'active' : ''}" data-view="feedback">Feedback</button>` : ''}
      </div>
    </div>
    <div id="view"></div>`;
  if (state.view === 'gedachten') renderThread();
  if (state.view === 'documenten') renderDocs();
  if (state.view === 'template') renderTemplate();
  if (state.view === 'kanban') renderBoard();
  if (state.view === 'feedback') renderFeedback();
}
// Functies die in Instellingen aan of uit kunnen (standaard aan).
const feature = name => state.settings?.features?.[name] !== false;

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
  if (t.dataset.view) { state.view = t.dataset.view; state.openDoc = null; state.docEdit = false; state.fbEdit = null; state.cardEdit = null; return render(); }
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
    if (a === 'dl') await downloadDoc(t.dataset.id, t.dataset.format, t.dataset.type, t.dataset.slug);
    if (a === 'open-hit') return openHit(t.dataset);
    if (a === 'card-add') return addCard(t.dataset.column);
    if (a === 'card-edit') { if (e.target.closest('[data-stop]')) return; state.cardEdit = t.dataset.id; return drawBoard(); }
    if (a === 'board-refresh') return refreshBoard();
    if (a === 'board-unlink') {
      if (!confirm(`Ontkoppelen van ${svcName(state.board.link.kind)}? De kaarten blijven hier staan, maar worden niet meer bijgewerkt.`)) return;
      applyBoardResult(await api('DELETE', `${base()}/board/link`)); return drawBoard();
    }
    if (a === 'link-start') { state.linking = t.dataset.kind; drawBoard(); return drawLinkPanel(t.dataset.kind); }
    if (a === 'link-cancel') { state.linking = null; return drawBoard(); }
    if (a === 'goto-connections') { state.linking = null; await openSettings(); return $('#connections')?.scrollIntoView({ behavior: 'smooth' }); }
    if (a === 'link-do') {
      t.disabled = true; t.textContent = 'Koppelen…';
      try {
        const r = await api('POST', `${base()}/board/link`, { kind: t.dataset.kind, targetId: $('#link-target').value, sendExisting: !!$('#link-send')?.checked });
        state.linking = null; applyBoardResult(r); drawBoard(); toast(`Gekoppeld: ${r.summary.added} kaarten opgehaald`);
      } catch (err) { t.disabled = false; t.textContent = 'Koppelen'; throw err; }
      return;
    }
    if (a === 'conflict') { applyBoardResult(await api('POST', `${base()}/board/conflicts`, { cardId: t.dataset.card, field: t.dataset.field, choice: t.dataset.choice })); return drawBoard(); }
    if (a === 'card-cancel') { state.cardEdit = null; return drawBoard(); }
    if (a === 'card-save') return saveCard(t.dataset.id);
    if (a === 'card-del') return deleteCard(t.dataset.id);
    if (a === 'fb-new') { state.fbEdit = 'new'; return drawFeedback(); }
    if (a === 'fb-edit') { state.fbEdit = t.dataset.id; return drawFeedback(); }
    if (a === 'fb-cancel') { state.fbEdit = null; return drawFeedback(); }
    if (a === 'fb-save') return saveFeedback();
    if (a === 'fb-del') return deleteFeedback(t.dataset.id);
    if (a === 'fb-addq') { collectFeedbackForm(); state.fbDraft.questions.push({ q: '', a: '' }); return drawFeedback(); }
    if (a === 'fb-delq') { collectFeedbackForm(); state.fbDraft.questions.splice(Number(t.dataset.i), 1); return drawFeedback(); }
    if (a === 'open-link') return openLink(t.dataset);
    if (a === 'tpl-use') { const tp = state.templates.find(x => x.id === t.dataset.id); $('#template-input').value = tp.content; return toast(`“${tp.name}” staat in de editor. Klik op Opslaan om het te gebruiken.`); }
    if (a === 'tpl-save-as') {
      const name = prompt('Naam voor dit template in de bibliotheek:', state.current.meta.name); if (!name || !name.trim()) return;
      await api('POST', '/api/templates', { name, content: $('#template-input').value }); toast('In de bibliotheek opgeslagen'); return drawTemplateLibrary();
    }
    if (a === 'tpl-update') {
      if (!confirm('Dit template in de bibliotheek vervangen door wat nu in de editor staat?')) return;
      await api('PUT', `/api/templates/${t.dataset.id}`, { content: $('#template-input').value }); toast('Template bijgewerkt'); return drawTemplateLibrary();
    }
    if (a === 'tpl-rename') {
      const tp = state.templates.find(x => x.id === t.dataset.id); const name = prompt('Nieuwe naam:', tp.name); if (!name || !name.trim()) return;
      await api('PUT', `/api/templates/${tp.id}`, { name }); return drawTemplateLibrary();
    }
    if (a === 'tpl-del') { if (!confirm('Dit template uit de bibliotheek verwijderen?')) return; await api('DELETE', `/api/templates/${t.dataset.id}`); return drawTemplateLibrary(); }
    if (a === 'docs-filter') { state.docsFilter = t.dataset.filter; return renderAllDocs(); }
    if (a === 'sprint-add') return addSprint();
    if (a === 'sprint-next') return nextSprint();
    if (a === 'sprint-del') return saveSprints((state.current.meta.sprints || []).filter(x => x.id !== t.dataset.id));
    if (a === 'sprint-edit') return editSprint(t.dataset.id);
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
    if (day !== lastDay) {
      const sp = (c.meta.sprints || []).filter(x => x.from <= day && (lastDay ? x.from > lastDay : x.to >= day));
      html += `<div class="divider">${dayLabel(day)}${sp.length ? ` <span class="sprint-tag">${sp.map(x => esc(x.name)).join(', ')} begint</span>` : ''}</div>`;
      lastDay = day;
    }
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
  return `<div class="card${state.selected.has(e.id) ? ' selected' : ''}${e.pending ? ' pending' : ''}" id="e-${e.id}"${selAttrs(e)}>
    <div class="meta">${selBox(e)}<span class="time">${time(e.id)}</span><span class="file">${e.pending ? 'wacht op verbinding…' : `${e.id}.txt${e.updatedAt ? ' · bewerkt' : ''}`}</span></div>
    ${titleLine(e)}
    ${quote}
    ${editing
      ? `<textarea class="edit-area" id="edit-${e.id}">${esc(e.text)}</textarea>
         <div class="row-end"><button class="btn small ghost" data-action="cancel-edit">Annuleer</button><button class="btn small primary" data-action="save-thought" data-id="${e.id}">Opslaan</button></div>`
      : `<div class="text">${esc(e.text)}</div>
         ${state.selecting || e.pending ? '' : `<div class="actions"><button class="link accent" data-action="reply" data-id="${e.id}">Reageer</button><button class="link" data-action="edit-thought" data-id="${e.id}">Bewerk</button>${manageLinks(e)}</div>`}`}
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
      ${feature('aiButtons') ? '<button class="btn small chip-ai" data-action="ai-questions">✦ AI-vragen genereren</button>' : ''}
      <button class="btn small chip-own" data-action="mode-question">${isQ ? '← Terug naar gedachte' : '+ Eigen vraag toevoegen'}</button>
      ${c.entries.length ? '<button class="btn small ghost" data-action="select-mode">☐ Selecteren</button>' : ''}
      ${isQ ? '<span class="mode-pill">Je typt nu een vraag aan jezelf. Het antwoord geef je in het kaartje.</span>' : ''}
    </div>
    <div class="input-row">
      <textarea id="compose-input" rows="1" placeholder="${isQ ? 'Typ je vraag…' : innerWidth < 760 ? 'Typ je gedachte…' : 'Typ je gedachte… (Enter = opslaan, Shift+Enter = nieuwe regel)'}"></textarea>
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
    let entry;
    try {
      entry = await api('POST', `${base()}/entries`, body);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      // Geen verbinding (bijv. op je telefoon): bewaren en later versturen.
      entry = queueEntry(base(), body);
      toast('Geen verbinding: je gedachte wordt verstuurd zodra je weer online bent.');
    }
    state.current.entries.push(entry);
    state.replyTo = null; state.composeMode = 'gedachte';
    renderThread(); bumpCount(1);
    $('#compose-input').focus();
  } finally { if (ta.isConnected) ta.disabled = false; }
}

// ---------- offline wachtrij ----------
const QKEY = 'lj-queue';
const readQueue = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQueue = q => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch {} };
function queueEntry(url, body) {
  const q = readQueue(); const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const id = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  q.push({ url, body, at: now.toISOString() }); writeQueue(q);
  return { id, kind: body.kind, text: body.text, question: body.question, answer: '', source: body.source, replyTo: body.replyTo, createdAt: now.toISOString(), pending: true };
}
let flushing = false;
async function flushQueue() {
  const q = readQueue(); if (!q.length || flushing) return;
  flushing = true; let sent = 0;
  try {
    while (readQueue().length) {
      const [item, ...rest] = readQueue();
      try { await api('POST', `${item.url}/entries`, item.body); } catch (e) { if (e instanceof TypeError) break; }
      writeQueue(rest); sent++;
    }
  } finally { flushing = false; }
  if (sent) {
    toast(`${sent} ${sent === 1 ? 'gedachte' : 'gedachten'} van toen je offline was verstuurd`);
    if (state.current && state.view === 'gedachten') openSpace(state.current.type, state.current.slug);
  }
}
window.addEventListener('online', flushQueue);

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
    const isProject = state.current.type === 'projecten';
    const sprints = state.current.meta.sprints || [];
    const todayKey = isoDay(today);
    // Standaard de lopende sprint, anders de laatst afgelopen.
    const cur = sprints.find(x => x.from <= todayKey && todayKey <= x.to) || [...sprints].reverse().find(x => x.to < todayKey) || null;
    inner.innerHTML = `
      <div class="panel">
        <h2>Document genereren</h2>
        <div class="sub">De AI ordent alleen jouw eigen gedachten en antwoorden volgens het template van ${state.current.type === 'projecten' ? 'dit project' : 'deze chat'}. Hij voegt niets toe.</div>
        ${ai || !feature('aiButtons') ? '' : '<div class="notice">Er is geen API-sleutel ingesteld. Gebruik "Kopieer prompt", plak die in Claude, en zet het resultaat terug via "Plak resultaat".</div>'}
        ${sprints.length ? `<div class="form-row"><label class="field grow">Periode
          <select id="doc-sprint"><option value="">Eigen periode kiezen</option>${sprints.map(x => `<option value="${x.id}" ${x.id === cur?.id ? 'selected' : ''}>${esc(x.name)} (${x.from.slice(8)}-${x.from.slice(5, 7)} t/m ${x.to.slice(8)}-${x.to.slice(5, 7)})</option>`).join('')}</select></label></div>` : ''}
        <div class="form-row">
          <label class="field grow">Titel<input id="doc-title" value="${cur ? esc(cur.name) : state.current.type === 'projecten' ? 'Sprint' : esc(state.current.meta.name)}"></label>
          <label class="field">Van<input type="date" id="doc-from" value="${cur ? cur.from : isoDay(twoWeeks)}"></label>
          <label class="field">Tot en met<input type="date" id="doc-to" value="${cur ? cur.to : isoDay(today)}"></label>
        </div>
        <div class="form-row">
          ${feature('aiButtons') ? `<button class="btn primary" data-action="gen-doc" ${ai ? '' : 'disabled'}>Genereer ruwe versie</button>` : ''}
          <button class="btn" data-action="copy-prompt">Kopieer prompt</button>
          <button class="btn ghost" data-action="paste-doc">Plak resultaat</button>
        </div>
      </div>
      ${isProject ? sprintsPanel(sprints, todayKey) : ''}
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
    const sel = $('#doc-sprint');
    if (sel) sel.addEventListener('change', () => {
      const x = sprints.find(y => y.id === sel.value); if (!x) return;
      $('#doc-title').value = x.name; $('#doc-from').value = x.from; $('#doc-to').value = x.to;
    });
  } catch (e) { fail(e); }
}

// ---------- sprints ----------
function nextSprintName(list) {
  const last = list.at(-1); const n = last && (last.name.match(/(\d+)\s*$/) || [])[1];
  return n ? last.name.replace(/\d+\s*$/, String(Number(n) + 1)) : `Sprint ${list.length + 1}`;
}
function sprintsPanel(sprints, todayKey) {
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  return `<div class="panel">
    <h2>Sprints</h2>
    <div class="sub">Vaste periodes voor dit project. Kies er een bij het genereren, dan worden titel en datums vanzelf ingevuld.</div>
    ${sprints.length ? `<div class="sprint-list">${sprints.map(x => `<div class="sprint-row${x.from <= todayKey && todayKey <= x.to ? ' now' : ''}">
        <span class="sprint-name">${esc(x.name)}${x.from <= todayKey && todayKey <= x.to ? ' <span class="badge project">nu</span>' : ''}</span>
        <span class="doc-date">${fmt(x.from)} t/m ${fmt(x.to)}</span>
        <span class="row-links"><button class="link" data-action="sprint-edit" data-id="${x.id}">Wijzig</button><button class="link danger" data-action="sprint-del" data-id="${x.id}">Verwijder</button></span>
      </div>`).join('')}</div>` : ''}
    <div class="form-row">
      <label class="field grow">Naam<input id="sprint-name" placeholder="${esc(nextSprintName(sprints))}"></label>
      <label class="field">Van<input type="date" id="sprint-from" value="${todayKey}"></label>
      <label class="field">Tot en met<input type="date" id="sprint-to" value="${isoDay(new Date(Date.now() + 13 * 864e5))}"></label>
      <button class="btn" data-action="sprint-add">Toevoegen</button>
      ${sprints.length ? '<button class="btn ghost" data-action="sprint-next" title="Zelfde lengte, direct na de laatste sprint">+ Volgende sprint</button>' : ''}
    </div>
  </div>`;
}
async function saveSprints(list) {
  state.current.meta = await api('PUT', base(), { sprints: list });
  renderDocs(); if (state.view === 'gedachten') renderThread(false);
}
async function addSprint() {
  const list = state.current.meta.sprints || [];
  const name = $('#sprint-name').value.trim() || nextSprintName(list);
  const from = $('#sprint-from').value, to = $('#sprint-to').value;
  if (!from || !to || from > to) return toast('Kies een geldige begin- en einddatum', true);
  await saveSprints([...list, { name, from, to }]); toast(`${name} toegevoegd`);
}
async function nextSprint() {
  const list = state.current.meta.sprints || []; const last = list.at(-1); if (!last) return;
  const day = 864e5, len = Math.round((Date.parse(last.to) - Date.parse(last.from)) / day);
  const from = new Date(Date.parse(last.to) + day), to = new Date(from.getTime() + len * day);
  const name = nextSprintName(list);
  await saveSprints([...list, { name, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }]); toast(`${name} toegevoegd`);
}
async function editSprint(id) {
  const list = (state.current.meta.sprints || []).map(x => ({ ...x }));
  const x = list.find(y => y.id === id); if (!x) return;
  const name = prompt('Naam van de sprint:', x.name); if (name === null) return;
  const from = prompt('Begindatum (JJJJ-MM-DD):', x.from); if (from === null) return;
  const to = prompt('Einddatum (JJJJ-MM-DD):', x.to); if (to === null) return;
  Object.assign(x, { name: name.trim() || x.name, from: from.trim(), to: to.trim() });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.from) || !/^\d{4}-\d{2}-\d{2}$/.test(x.to) || x.from > x.to) return toast('Ongeldige datum', true);
  await saveSprints(list); toast('Sprint gewijzigd');
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
async function renderTemplate() {
  $('#view').outerHTML = `<div id="view" class="page"><div class="page-inner">
    <div class="panel">
      <h2>Template voor documenten</h2>
      <div class="sub">Dit template bepaalt hoe het document van ${state.current.type === 'projecten' ? 'dit project' : 'deze chat'} eruitziet: de kopjes, de taal en de toon. Gebruik {titel} voor de titel die je bij het genereren invult.</div>
      <textarea class="doc-editor template-editor" id="template-input">${esc(state.current.meta.template || '')}</textarea>
      <div class="row-end"><button class="btn ghost" data-action="tpl-save-as">Opslaan in bibliotheek…</button><span class="spacer-h"></span><button class="btn ghost" data-action="reset-template">Standaardtemplate</button><button class="btn primary" data-action="save-template">Opslaan</button></div>
    </div>
    <div class="panel"><h2>Templatebibliotheek</h2>
      <div class="sub">Bewaar templates om ze in andere projecten en chats te gebruiken. <b>Gebruiken</b> zet het template in de editor hierboven; klik daarna op Opslaan.</div>
      <div class="tpl-list" id="tpl-list"><div class="hint">Laden…</div></div>
    </div></div></div>`;
  await drawTemplateLibrary();
}
async function drawTemplateLibrary() {
  try {
    state.templates = await api('GET', '/api/templates');
    const el = $('#tpl-list'); if (!el) return;
    el.innerHTML = state.templates.map(t => `<div class="tpl-row"><span class="name">${esc(t.name)}${t.builtIn ? ' <span class="hint">ingebouwd</span>' : ''}</span>
      <button class="link accent" data-action="tpl-use" data-id="${t.id}">Gebruiken</button>
      ${t.builtIn ? '' : `<button class="link" data-action="tpl-update" data-id="${t.id}">Overschrijven met editor</button><button class="link" data-action="tpl-rename" data-id="${t.id}">Naam wijzigen</button><button class="link danger" data-action="tpl-del" data-id="${t.id}">Verwijder</button>`}</div>`).join('');
  } catch (e) { fail(e); }
}

// ---------- kanban ----------
async function renderBoard() {
  $('#view').outerHTML = `<div id="view" class="page"><div class="board-wrap" id="board"><div class="hint">Laden…</div></div></div>`;
  try {
    state.board = await api('GET', `${base()}/board`); drawBoard();
    if (state.board.link) refreshBoard(true); // bij openen meteen de laatste stand ophalen
  } catch (e) { fail(e); }
}
const svcName = k => (k === 'jira' ? 'Jira' : 'Trello');
// Verwerkt het antwoord van een kaart-actie: nieuw bord, en meldingen van Trello/Jira.
function applyBoardResult(r) {
  if (r?.board) state.board = r.board;
  const errs = [...(r?.summary?.errors || []), ...(r?.error ? [r.error] : [])];
  if (errs.length) toast(errs.join(' '), true);
  else if (r?.summary?.conflicts) toast('Iemand heeft dit intussen ook aangepast. Kies hieronder welke versie blijft.', true);
}
async function refreshBoard(quiet = false) {
  const btn = $('#board-refresh'); if (btn) { btn.disabled = true; btn.textContent = 'Verversen…'; }
  try {
    const r = await api('POST', `${base()}/board/refresh`);
    applyBoardResult(r); drawBoard();
    const s = r.summary;
    if (!quiet && s) toast(`Ververst: ${s.added} nieuw, ${s.pulled} bijgewerkt, ${s.pushed + s.created} verstuurd${s.removed ? `, ${s.removed} weg` : ''}${s.conflicts ? `, ${s.conflicts} conflict(en)` : ''}`);
  } catch (e) { if (!quiet) fail(e); state.board = await api('GET', `${base()}/board`).catch(() => state.board); drawBoard(); }
}
function linkBar(b) {
  if (!b.link) return `<div class="link-bar">
      <span>Dit bord is alleen lokaal.</span><span class="spacer-h"></span>
      <button class="btn small" data-action="link-start" data-kind="trello">Koppelen met Trello</button>
      <button class="btn small" data-action="link-start" data-kind="jira">Koppelen met Jira</button></div>
    ${state.linking ? '<div class="panel" id="link-panel"><div class="hint">Laden…</div></div>' : ''}`;
  const l = b.link;
  return `<div class="link-bar linked">
      <span class="svc ${l.kind}">${svcName(l.kind)}</span><b>${esc(l.target.name)}</b>
      <span class="hint">${l.lastRefresh ? `ververst om ${new Date(l.lastRefresh).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : 'nog niet ververst'}</span>
      <span class="spacer-h"></span>
      <button class="btn small primary" id="board-refresh" data-action="board-refresh">↻ Verversen</button>
      <button class="btn small ghost" data-action="board-unlink">Ontkoppelen</button></div>
    ${l.lastError ? `<div class="notice bad">${esc(l.lastError)}</div>` : ''}
    ${(b.conflicts || []).length ? `<div class="panel conflicts"><h2>Kies welke versie blijft</h2>
      <div class="sub">Deze kaarten zijn hier én in ${svcName(l.kind)} aangepast.</div>
      ${b.conflicts.map(c => { const card = b.cards.find(x => x.id === c.cardId); const fld = { title: 'Titel', description: 'Beschrijving', column: 'Kolom' }[c.field];
        const show = v => c.field === 'column' ? esc(b.columns.find(x => x.id === v)?.name || v) : esc(v || '(leeg)');
        return `<div class="conflict"><div><b>${esc(card?.title || '')}</b> · ${fld}</div>
          <div class="conflict-grid"><div><span class="lbl">Hier</span><div class="text">${show(c.local)}</div><button class="btn small" data-action="conflict" data-card="${c.cardId}" data-field="${c.field}" data-choice="mine">Mijn versie houden</button></div>
          <div><span class="lbl">${svcName(l.kind)}</span><div class="text">${show(c.remote)}</div><button class="btn small" data-action="conflict" data-card="${c.cardId}" data-field="${c.field}" data-choice="theirs">Deze versie nemen</button></div></div></div>`; }).join('')}
    </div>` : ''}`;
}
async function drawLinkPanel(kind) {
  const el = $('#link-panel'); if (!el) return;
  try {
    const conns = await api('GET', '/api/connections');
    if (!conns[kind].configured) {
      el.innerHTML = `<h2>Koppelen met ${svcName(kind)}</h2><div class="sub">Stel eerst je ${svcName(kind)}-account in.</div>
        <div class="row-end"><button class="btn ghost" data-action="link-cancel">Annuleer</button><button class="btn primary" data-action="goto-connections">Naar Instellingen → Koppelingen</button></div>`;
      return;
    }
    const targets = await api('GET', `/api/connections/${kind}/targets`);
    const n = state.board.cards.length;
    el.innerHTML = `<h2>Koppelen met ${svcName(kind)}</h2>
      <div class="sub">Ingelogd als ${esc(conns[kind].name)}. De kolommen van het bord worden overgenomen.</div>
      <label class="field grow">${kind === 'jira' ? 'Project' : 'Bord'}<select id="link-target">${targets.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
      ${n ? `<label class="check"><input type="checkbox" id="link-send"> Mijn ${n} huidige ${n === 1 ? 'kaart' : 'kaarten'} ook in ${svcName(kind)} zetten <span class="hint">(anders blijven ze alleen hier)</span></label>` : ''}
      <div class="row-end"><button class="btn ghost" data-action="link-cancel">Annuleer</button><button class="btn primary" data-action="link-do" data-kind="${kind}">Koppelen</button></div>`;
  } catch (e) { el.innerHTML = `<div class="notice bad">${esc(e.message)}</div><div class="row-end"><button class="btn ghost" data-action="link-cancel">Sluiten</button></div>`; }
}

function drawBoard() {
  const b = state.board, el = $('#board'); if (!b || !el) return;
  const colOpts = cur => b.columns.map(c => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  el.innerHTML = `${linkBar(b)}
    <div class="board">${b.columns.map(col => {
      const cards = b.cards.filter(c => c.column === col.id);
      return `<section class="col" data-col="${col.id}">
        <header><span>${esc(col.name)}</span><span class="count">${cards.length}</span></header>
        <div class="col-cards">
          ${cards.map(c => state.cardEdit === c.id ? `
            <div class="kcard editing">
              <input class="k-title" id="kt-${c.id}" value="${esc(c.title)}">
              <textarea class="k-desc" id="kd-${c.id}" placeholder="Beschrijving (optioneel)">${esc(c.description || '')}</textarea>
              <label class="field">Kolom<select id="kc-${c.id}">${colOpts(c.column)}</select></label>
              ${b.link && c.localOnly ? `<label class="check"><input type="checkbox" id="ks-${c.id}"> Ook in ${svcName(b.link.kind)} zetten</label>` : ''}
              <div class="row-end">${b.link?.kind === 'jira' && c.remote ? '<span class="hint">Verwijderen doe je in Jira zelf</span>' : `<button class="link danger" data-action="card-del" data-id="${c.id}">${c.remote ? 'Archiveren in Trello' : 'Verwijder'}</button>`}<span class="spacer-h"></span>
                <button class="btn small ghost" data-action="card-cancel">Annuleer</button><button class="btn small primary" data-action="card-save" data-id="${c.id}">Opslaan</button></div>
            </div>` : `
            <div class="kcard" draggable="true" data-card="${c.id}" data-action="card-edit" data-id="${c.id}">
              <div class="k-title-view">${esc(c.title)}</div>
              ${c.description ? `<div class="k-desc-view">${esc(c.description)}</div>` : ''}
              ${c.remote || c.localOnly || c.remoteGone || (b.conflicts || []).some(x => x.cardId === c.id) ? `<div class="k-meta">
                ${c.remote ? `<a class="k-key" href="${esc(c.remote.url || '#')}" target="_blank" rel="noopener" data-stop="1">${esc(c.remote.key || svcName(b.link?.kind))} ↗</a>` : ''}
                ${c.localOnly && b.link ? '<span class="k-badge">alleen hier</span>' : ''}
                ${c.remoteGone ? `<span class="k-badge warn">niet meer in ${esc(c.remoteGone.kind)}</span>` : ''}
                ${(b.conflicts || []).some(x => x.cardId === c.id) ? '<span class="k-badge warn">conflict</span>' : ''}</div>` : ''}
            </div>`).join('')}
        </div>
        <div class="col-add"><input placeholder="+ Kaart toevoegen" data-add="${col.id}"><button class="btn small" data-action="card-add" data-column="${col.id}">Voeg toe</button></div>
      </section>`;
    }).join('')}</div>`;
  el.querySelectorAll('[data-add]').forEach(inp => inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addCard(inp.dataset.add).catch(fail); } }));
  // Slepen tussen kolommen (computer). Op een telefoon kies je de kolom in het bewerkscherm.
  el.querySelectorAll('.kcard[draggable]').forEach(card => {
    card.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', card.dataset.card); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  el.querySelectorAll('.col').forEach(col => {
    col.addEventListener('dragover', ev => { ev.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', ev => { if (!col.contains(ev.relatedTarget)) col.classList.remove('drop'); });
    col.addEventListener('drop', async ev => {
      ev.preventDefault(); col.classList.remove('drop');
      const id = ev.dataTransfer.getData('text/plain'); if (!id) return;
      const target = ev.target.closest('.kcard[data-card]');
      const before = target && target.dataset.card !== id ? state.board.cards.find(c => c.id === target.dataset.card) : null;
      const inCol = state.board.cards.filter(c => c.column === col.dataset.col && c.id !== id);
      const order = before ? before.order - 0.5 : Math.max(0, ...inCol.map(c => c.order)) + 1;
      await moveCard(id, col.dataset.col, order).catch(fail);
    });
  });
}

async function addCard(column) {
  const inp = $(`[data-add="${column}"]`); const title = inp.value.trim();
  if (!title) return inp.focus();
  const r = await api('POST', `${base()}/board/cards`, { title, column });
  if (r.board) applyBoardResult(r); else { state.board.cards.push(r.card); applyBoardResult(r); }
  drawBoard(); $(`[data-add="${column}"]`).focus();
}
async function moveCard(id, column, order) {
  const r = await api('PUT', `${base()}/board/cards/${id}`, { column, order });
  applyBoardResult(r); state.board = await api('GET', `${base()}/board`); drawBoard();
}
async function saveCard(id) {
  const r = await api('PUT', `${base()}/board/cards/${id}`, { title: $('#kt-' + id).value, description: $('#kd-' + id).value, column: $('#kc-' + id).value, ...($('#ks-' + id)?.checked ? { send: true } : {}) });
  state.cardEdit = null; applyBoardResult(r); state.board = await api('GET', `${base()}/board`); drawBoard();
  if (!r.error && !r.summary?.errors?.length && !r.summary?.conflicts) toast('Kaart opgeslagen');
}
async function deleteCard(id) {
  const c = state.board.cards.find(x => x.id === id);
  if (!confirm(c?.remote ? 'Deze kaart archiveren in Trello en hier weghalen?' : 'Deze kaart verwijderen?')) return;
  await api('DELETE', `${base()}/board/cards/${id}`);
  state.cardEdit = null; state.board.cards = state.board.cards.filter(c => c.id !== id); drawBoard();
}

// ---------- feedback ----------
async function renderFeedback() {
  $('#view').outerHTML = `<div id="view" class="page"><div class="page-inner" id="feedback"><div class="hint">Laden…</div></div></div>`;
  try {
    const [items, docs, board] = await Promise.all([
      api('GET', `${base()}/feedback`), api('GET', `${base()}/documents`), api('GET', `${base()}/board`)
    ]);
    state.feedback = items; state.fbDocs = docs; state.board = board;
    drawFeedback();
  } catch (e) { fail(e); }
}

function linkLabel(l) {
  if (l.kind === 'document') return (state.fbDocs || []).find(d => d.id === l.id)?.title || l.label || 'document';
  return (state.board?.cards || []).find(c => c.id === l.id)?.title || l.label || 'kaart';
}

function drawFeedback() {
  const el = $('#feedback'); if (!el) return;
  if (state.fbEdit) return drawFeedbackForm(el);
  const items = state.feedback || [];
  el.innerHTML = `
    <div class="form-row" style="justify-content:space-between">
      <div class="sub">Feedback van docenten of anderen. Je antwoorden en wat je ervan leerde gaan mee in je documenten van die periode.</div>
      <button class="btn primary" data-action="fb-new">+ Feedback toevoegen</button>
    </div>
    ${items.length ? items.map(f => `
      <div class="panel fb">
        <div class="fb-head"><h2>${esc(f.title)}</h2><span class="doc-date">${new Date(f.date + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}${f.from ? ` · van ${esc(f.from)}` : ''}</span>
          <span class="spacer-h"></span><button class="link" data-action="fb-edit" data-id="${f.id}">Bewerk</button><button class="link danger" data-action="fb-del" data-id="${f.id}">Verwijder</button></div>
        ${f.links?.length ? `<div class="chips">${f.links.map(l => `<button class="chip" data-action="open-link" data-kind="${l.kind}" data-id="${l.id}">${l.kind === 'document' ? '▤' : '▦'} ${esc(linkLabel(l))}</button>`).join('')}</div>` : ''}
        ${f.text ? `<div class="fb-sec"><span class="lbl">Feedback</span><div class="text">${esc(f.text)}</div></div>` : ''}
        ${(f.questions || []).map(q => `<div class="fb-q"><div class="question">${esc(q.q)}</div><div class="answer"><span class="lbl">Mijn antwoord</span><div class="text">${esc(q.a) || '<span class="hint">Nog niet beantwoord</span>'}</div></div></div>`).join('')}
        ${f.learned ? `<div class="fb-sec learned"><span class="lbl">Wat ik heb geleerd</span><div class="text">${esc(f.learned)}</div></div>` : ''}
      </div>`).join('') : '<div class="panel"><div class="hint">Nog geen feedback. Klik op “Feedback toevoegen”.</div></div>'}`;
}

function drawFeedbackForm(el) {
  const src = state.fbEdit === 'new' ? null : (state.feedback || []).find(f => f.id === state.fbEdit);
  if (!state.fbDraft || state.fbDraft.for !== state.fbEdit) {
    state.fbDraft = { for: state.fbEdit, title: src?.title || '', from: src?.from || '', date: src?.date || isoDay(new Date()),
      text: src?.text || '', learned: src?.learned || '', questions: (src?.questions || []).map(q => ({ ...q })),
      links: (src?.links || []).map(l => ({ ...l })) };
  }
  const d = state.fbDraft;
  const linked = (kind, id) => d.links.some(l => l.kind === kind && l.id === id);
  const docs = state.fbDocs || [], cards = state.board?.cards || [];
  el.innerHTML = `<div class="panel">
    <h2>${src ? 'Feedback bewerken' : 'Nieuwe feedback'}</h2>
    <div class="form-row">
      <label class="field grow">Titel<input id="fb-title" value="${esc(d.title)}" placeholder="Bijvoorbeeld: Gesprek met docent"></label>
      <label class="field">Van wie<input id="fb-from" value="${esc(d.from)}" placeholder="Docent, klant, …"></label>
      <label class="field">Datum<input type="date" id="fb-date" value="${d.date}"></label>
    </div>
    <label class="field grow">Feedback<textarea class="edit-area tall" id="fb-text" placeholder="Plak of typ de feedback, bijvoorbeeld uit je transcriptie">${esc(d.text)}</textarea></label>
    <div class="fb-qs">
      <span class="lbl-strong">Vragen in de feedback</span>
      ${d.questions.map((q, i) => `<div class="fb-qedit">
        <input data-q="${i}" value="${esc(q.q)}" placeholder="Vraag">
        <textarea data-a="${i}" placeholder="Mijn antwoord">${esc(q.a)}</textarea>
        <button class="link danger" data-action="fb-delq" data-i="${i}">Vraag weghalen</button></div>`).join('')}
      <button class="btn small ghost" data-action="fb-addq">+ Vraag toevoegen</button>
    </div>
    <label class="field grow">Wat ik heb geleerd<textarea class="edit-area" id="fb-learned">${esc(d.learned)}</textarea></label>
    <div class="fb-links">
      <span class="lbl-strong">Koppelen aan</span>
      ${docs.length || cards.length ? `<div class="link-grid">
        ${docs.map(x => `<label class="check"><input type="checkbox" data-link="document" value="${x.id}" ${linked('document', x.id) ? 'checked' : ''}> ▤ ${esc(x.title)} <span class="hint">${x.kind === 'eind' ? 'eind' : 'ruw'}</span></label>`).join('')}
        ${cards.map(x => `<label class="check"><input type="checkbox" data-link="kaart" value="${x.id}" ${linked('kaart', x.id) ? 'checked' : ''}> ▦ ${esc(x.title)}</label>`).join('')}
      </div>` : '<div class="hint">Nog geen documenten of kaarten in dit project.</div>'}
    </div>
    <div class="row-end"><button class="btn ghost" data-action="fb-cancel">Annuleer</button><button class="btn primary" data-action="fb-save">Opslaan</button></div>
  </div>`;
}

function collectFeedbackForm() {
  const d = state.fbDraft; if (!d) return;
  d.title = $('#fb-title').value; d.from = $('#fb-from').value; d.date = $('#fb-date').value;
  d.text = $('#fb-text').value; d.learned = $('#fb-learned').value;
  d.questions = d.questions.map((q, i) => ({ q: $(`[data-q="${i}"]`)?.value ?? q.q, a: $(`[data-a="${i}"]`)?.value ?? q.a }));
  d.links = [...document.querySelectorAll('[data-link]:checked')].map(c => ({ kind: c.dataset.link, id: c.value, label: c.closest('label').textContent.trim() }));
}

async function saveFeedback() {
  collectFeedbackForm();
  const d = state.fbDraft, body = { title: d.title, from: d.from, date: d.date, text: d.text, learned: d.learned, questions: d.questions, links: d.links };
  const saved = state.fbEdit === 'new' ? await api('POST', `${base()}/feedback`, body) : await api('PUT', `${base()}/feedback/${state.fbEdit}`, body);
  state.fbEdit = null; state.fbDraft = null;
  state.feedback = await api('GET', `${base()}/feedback`); drawFeedback(); toast(`Feedback “${saved.title}” opgeslagen`);
}

async function deleteFeedback(id) {
  if (!confirm('Deze feedback verwijderen?')) return;
  await api('DELETE', `${base()}/feedback/${id}`);
  state.feedback = state.feedback.filter(f => f.id !== id); drawFeedback();
}

async function openLink(d) {
  if (d.kind === 'document') { state.view = 'documenten'; render(); state.openDoc = await api('GET', `${base()}/documents/${d.id}`); return renderDocs(); }
  state.view = 'kanban'; state.cardEdit = d.id; render();
}

// ---------- zoeken ----------
let searchTimer;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => q.length >= 2 ? runSearch(q) : (q.length === 0 && state.mainMode === 'search' ? goBack() : null), 250);
});
$('#search').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; goBack(); } });

function goBack() {
  state.mainMode = null;
  if (state.current) { renderSidebar(); render(); }
  else $('#main').innerHTML = '<div class="empty-state"><h1>Welkom bij je leerjournaal</h1><p>Kies links een project of chat.</p></div>';
}

function highlight(text, q) {
  const t = esc(text); if (!q) return t;
  const f = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const i = f(text).indexOf(f(q)); if (i < 0) return t;
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

async function runSearch(q) {
  setTopbar('Zoeken');
  state.mainMode = 'search';
  const kindLabel = { gedachte: 'Gedachte', vraag: 'Vraag', document: 'Document', ruimte: 'Project/chat' };
  try {
    const { results } = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
    if ($('#search').value.trim() !== q) return; // er is intussen verder getypt
    $('#main').innerHTML = `<div class="header-wrap" style="padding-bottom:18px"><h1>Zoeken</h1>
      <div class="sub">${results.length ? `${results.length}${results.length === 100 ? '+' : ''} resultaten` : 'Niets gevonden'} voor “${esc(q)}”</div></div>
      <div class="page"><div class="page-inner">
        ${results.map(r => `<button class="hit" data-action="open-hit" data-type="${r.type}" data-slug="${esc(r.slug)}" data-kind="${r.kind}" data-id="${r.id || ''}">
          <span class="hit-head"><span class="badge ${r.type === 'projecten' ? 'project' : 'chat'}">${esc(r.spaceName)}</span>
            <span class="hit-kind">${kindLabel[r.kind] || r.kind}${r.docKind ? ` · ${r.docKind === 'eind' ? 'eindversie' : 'ruwe versie'}` : ''}</span>
            ${r.createdAt ? `<span class="doc-date">${fmtDateTime(r.createdAt)}</span>` : ''}${r.archived ? '<span class="doc-date">· archief</span>' : ''}</span>
          ${r.title ? `<span class="hit-title">${highlight(r.title, q)}</span>` : ''}
          ${r.snippet ? `<span class="hit-snippet">${highlight(r.snippet, q)}</span>` : ''}
        </button>`).join('')}
      </div></div>`;
  } catch (e) { fail(e); }
}

async function openHit(d) {
  state.mainMode = null;
  if (d.kind === 'document') {
    await openSpace(d.type, d.slug, 'documenten');
    state.openDoc = await api('GET', `${base()}/documents/${d.id}`); renderDocs();
  } else {
    await openSpace(d.type, d.slug);
    if (d.id) setTimeout(() => jumpTo(d.id), 150);
  }
}

// ---------- alle documenten ----------
$('#all-docs-btn').addEventListener('click', () => { state.docsFilter = state.docsFilter || 'alle'; renderAllDocs(); });
async function renderAllDocs() {
  setTopbar('Alle documenten');
  state.mainMode = 'docs'; state.current = null; renderSidebar();
  $('#all-docs-btn').classList.add('active');
  $('#main').innerHTML = `<div class="header-wrap" style="padding-bottom:18px"><h1>Alle documenten</h1>
    <div class="sub">Alle ruwe versies en eindversies uit al je projecten en chats.</div></div>
    <div class="page"><div class="page-inner" id="all-docs"><div class="hint">Laden…</div></div></div>`;
  try {
    const docs = await api('GET', '/api/documents');
    const f = state.docsFilter || 'alle';
    const list = docs.filter(d => f === 'alle' || d.kind === f);
    $('#all-docs').innerHTML = `
      <div class="seg">${[['alle', `Alle (${docs.length})`], ['ruw', 'Ruwe versies'], ['eind', 'Eindversies']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-action="docs-filter" data-filter="${k}">${l}</button>`).join('')}</div>
      <div class="panel">${list.length ? `<div class="doc-list">${list.map(d => `
        <div class="doc-row all">
          <button class="doc-title link-like" data-action="open-hit" data-kind="document" data-type="${d.type}" data-slug="${esc(d.slug)}" data-id="${d.id}">${esc(d.title)}</button>
          <span class="doc-space">${esc(d.spaceName)}${d.archived ? ' · archief' : ''}</span>
          <span><span class="badge ${d.kind}">${d.kind === 'eind' ? 'Eindversie' : 'Ruwe versie'}</span></span>
          <span class="doc-date">${d.createdAt ? fmtDateTime(d.createdAt) : ''}</span>
          ${dlLinks(d.id, d.type, d.slug)}
        </div>`).join('')}</div>` : '<div class="hint">Nog geen documenten.</div>'}</div>`;
  } catch (e) { fail(e); }
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
    const needsLogin = s.lastSyncError && /inloggen|inloggegevens/i.test(s.lastSyncError.message || '');
    if (needsLogin) $('#sync-status').textContent = 'GitHub vraagt om in te loggen · klik hier';
    st.onclick = needsLogin ? () => { closeDrawer(); openGitHubLogin(); }
      : s.lastSyncError ? () => alert(`Sync mislukt bij ${s.lastSyncError.step}.\n\n${s.lastSyncError.message}\n\nTechnische melding:\n${s.lastSyncError.detail}`) : null;
    if (s.keyCreatedNow && !sessionStorage.getItem('lj-key-warned')) {
      sessionStorage.setItem('lj-key-warned', '1');
      toast(`Nieuwe sleutel gemaakt in ${s.keyFile}. Maak er een back-up van!`, true);
    }
    flushQueue();
  } catch (e) { $('#sync-status').textContent = 'Server niet bereikbaar'; }
}
$('#sync-btn').addEventListener('click', async e => {
  const b = e.currentTarget; b.disabled = true; b.textContent = 'Bezig…';
  try { await api('POST', '/api/sync'); toast('Gesynchroniseerd met GitHub'); }
  catch (err) { fail(err); }
  finally { b.disabled = false; b.textContent = 'Sync met GitHub'; loadStatus(); }
});
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'dark';
  try { localStorage.setItem('lj-theme', theme || 'dark'); } catch {}
}
async function loadSettings() {
  try { state.settings = await api('GET', '/api/settings'); applyTheme(state.settings.theme); } catch {}
}
$('#settings-btn').addEventListener('click', openSettings);

// ---------- inloggen bij GitHub ----------
let devicePoll = null;
async function openGitHubLogin() {
  clearTimeout(devicePoll);
  state.current = null; state.mainMode = 'github'; renderSidebar(); setTopbar('GitHub');
  $('#main').innerHTML = `<div class="header-wrap" style="padding-bottom:18px"><h1>Inloggen bij GitHub</h1>
    <div class="sub">Nodig om je versleutelde gedachten te uploaden. Je logt één keer in; daarna blijft de app ingelogd.</div></div>
    <div class="page"><div class="page-inner" id="gh"><div class="hint">Laden…</div></div></div>`;
  try {
    const g = await api('GET', '/api/github');
    const repo = (g.remote || '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') || 'je data-repository';
    $('#gh').innerHTML = g.loggedIn ? `
      <div class="panel"><h2>Ingelogd als ${esc(g.login)}</h2>
        <div class="sub">Via ${g.via === 'device' ? 'Inloggen met GitHub' : 'een token'}, sinds ${fmtDateTime(g.savedAt)}. Uploaden naar <b>${esc(repo)}</b> gebruikt deze inlog.</div>
        <div class="form-row"><button class="btn primary" id="gh-sync">Nu synchroniseren</button><button class="btn ghost" id="gh-logout">Uitloggen</button></div></div>`
    : `
      ${g.deviceFlow ? `<div class="panel"><h2>Inloggen met GitHub</h2>
        <div class="sub">Je krijgt een code die je op github.com invult. Daarna is de app ingelogd.</div>
        <div id="gh-device"><button class="btn primary" id="gh-start">Inloggen met GitHub</button></div></div>` : ''}
      <div class="panel"><h2>${g.deviceFlow ? 'Of: met een token' : 'Inloggen met een token'}</h2>
        <ol class="steps">
          <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → nieuw fine-grained token</a>.</li>
          <li>Naam: <b>Leerjournaal</b>. Vervaldatum: zo lang als je wilt (<i>No expiration</i> = nooit opnieuw inloggen).</li>
          <li>Repository access: <b>Only select repositories</b> → <b>${esc(repo)}</b>.</li>
          <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
          <li>Klik <i>Generate token</i>, kopieer het en plak het hieronder.</li>
        </ol>
        <div class="form-row"><label class="field grow">Token<input type="password" id="gh-token" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
          <button class="btn primary" id="gh-save">Inloggen</button></div>
        <div class="sub">Het token blijft op deze computer (in <code>github.json</code>, niet op GitHub) en mag alleen bij ${esc(repo)}.</div>
      </div>
      ${g.deviceFlow ? '' : `<details class="panel"><summary><b>Liever inloggen met één klik?</b> (eenmalig instellen)</summary>
        <ol class="steps">
          <li>Maak een OAuth-app: <a href="https://github.com/settings/applications/new" target="_blank" rel="noopener">github.com → New OAuth App</a>. Homepage en callback-URL: <code>http://localhost:4173</code>.</li>
          <li>Vink <b>Enable Device Flow</b> aan en sla op.</li>
          <li>Kopieer de <b>Client ID</b> naar <code>config.json</code>: <code>"githubClientId": "…"</code> en start de app opnieuw.</li>
        </ol></details>`}`;
    const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', () => fn().catch(fail)); };
    on('gh-save', async () => {
      const r = await api('POST', '/api/github/token', { token: $('#gh-token').value });
      toast(`Ingelogd als ${r.login}${r.repo ? ` · toegang tot ${r.repo}` : ''}`); openGitHubLogin(); loadStatus();
    });
    on('gh-logout', async () => { if (!confirm('Uitloggen bij GitHub in de app?')) return; await api('DELETE', '/api/github'); openGitHubLogin(); });
    on('gh-sync', async () => { await api('POST', '/api/sync'); toast('Gesynchroniseerd met GitHub'); loadStatus(); });
    on('gh-start', async () => {
      const d = await api('POST', '/api/github/device');
      $('#gh-device').innerHTML = `<div class="device-code">${esc(d.userCode)}</div>
        <div class="form-row"><a class="btn primary" href="${esc(d.verificationUri)}" target="_blank" rel="noopener">Open github.com/login/device</a>
        <button class="btn ghost" id="gh-copy">Code kopiëren</button></div><div class="hint" id="gh-wait">Wachten tot je de code op GitHub hebt ingevuld…</div>`;
      $('#gh-copy').addEventListener('click', () => navigator.clipboard.writeText(d.userCode).then(() => toast('Code gekopieerd')));
      const poll = async () => {
        if (state.mainMode !== 'github') return;
        const r = await api('POST', '/api/github/device/poll').catch(e => ({ state: 'fout', error: e.message }));
        if (r.state === 'klaar') { toast(`Ingelogd als ${r.login}`); loadStatus(); return openGitHubLogin(); }
        if (r.state === 'wachten') { devicePoll = setTimeout(poll, (r.interval || d.interval) * 1000); return; }
        const el = $('#gh-wait'); if (el) el.textContent = r.state === 'verlopen' ? 'De code is verlopen. Probeer opnieuw.' : r.state === 'geweigerd' ? 'Inloggen is geweigerd op GitHub.' : (r.error || 'Er ging iets mis.');
      };
      devicePoll = setTimeout(poll, d.interval * 1000);
    });
  } catch (e) { fail(e); }
}

// ---------- instellingen ----------
const THEME_INFO = {
  dark: ['Donker', ['#12141b', '#1f2330', '#7c7cf0']], light: ['Licht', ['#f6f6f3', '#ffffff', '#5b5bd6']],
  night: ['Nacht (zwart)', ['#000000', '#111114', '#8f8ff5']], sepia: ['Sepia', ['#f4ecdc', '#fffaf0', '#b0602c']],
  forest: ['Bos', ['#0f1612', '#18241d', '#4cc38a']], ocean: ['Oceaan', ['#0d1520', '#152234', '#4ea8ff']]
};
async function openSettings() {
  setTopbar('Instellingen');
  state.current = null; state.mainMode = 'settings'; renderSidebar();
  await loadSettings();
  const st = state.settings || {};
  const f = st.features || {};
  $('#main').innerHTML = `<div class="header-wrap" style="padding-bottom:18px"><h1>Instellingen</h1>
    <div class="sub">Wijzigingen worden meteen opgeslagen, op deze computer (in instellingen.json, niet op GitHub).</div></div>
    <div class="page"><div class="page-inner">
      <div class="panel"><h2>Thema</h2>
        <div class="theme-grid">${(st.themes || Object.keys(THEME_INFO)).map(t => `<button class="theme-card ${st.theme === t ? 'on' : ''}" data-set-theme="${t}">
          <span class="theme-swatch">${THEME_INFO[t][1].map(c => `<span style="background:${c}"></span>`).join('')}</span>
          <span class="theme-name">${THEME_INFO[t][0]}</span></button>`).join('')}</div></div>
      <div class="panel"><h2>Functies</h2>
        <label class="toggle-row"><input type="checkbox" data-feature="kanban" ${f.kanban !== false ? 'checked' : ''}><div><b>Kanban</b><span>Tabblad Kanban in projecten.</span></div></label>
        <label class="toggle-row"><input type="checkbox" data-feature="feedback" ${f.feedback !== false ? 'checked' : ''}><div><b>Feedback</b><span>Tabblad Feedback in projecten.</span></div></label>
        <label class="toggle-row"><input type="checkbox" data-feature="aiButtons" ${f.aiButtons !== false ? 'checked' : ''}><div><b>AI-knoppen</b><span>“AI-vragen genereren” en “Genereer ruwe versie”. Uit = alleen Kopieer prompt.</span></div></label>
      </div>
      <div class="panel"><h2>GitHub</h2>
        <div class="toggle-row"><span style="flex:1"><b style="color:var(--ink)">Inloggen bij GitHub</b><span id="gh-line">Laden…</span></span><button class="btn small" id="gh-manage">Beheren</button></div>
        <label class="toggle-row"><input type="checkbox" id="set-autosync" ${st.autoSync ? 'checked' : ''}><div><b>Automatisch uploaden</b><span>Elke wijziging gaat binnen een paar seconden naar GitHub.</span></div></label>
        <label class="toggle-row"><span style="flex:1"><b style="color:var(--ink)">Elke zoveel minuten ophalen en uploaden</b>0 = uit. Handig als je ook op een ander apparaat schrijft.</span><input type="number" min="0" max="1440" class="inline-num" id="set-interval" value="${st.autoSyncMinutes ?? 10}"></label>
      </div>
      <div class="panel" id="connections"><h2>Koppelingen (Kanban)</h2>
        <div class="sub">Per project koppel je het Kanbanbord aan een Trello-bord of een Jira-project (tabblad Kanban). Hier stel je de accounts in. De gegevens worden versleuteld opgeslagen.</div>
        <div id="conn-list"><div class="hint">Laden…</div></div>
      </div>
      <div class="panel"><h2>Documenten</h2>
        <label class="toggle-row"><span style="flex:1"><b style="color:var(--ink)">Datums in gegenereerde documenten</b>Tijden van berichten komen er standaard niet in.</span>
          <select id="set-docdates" class="inline-select">
            <option value="geen" ${st.docDates === 'geen' ? 'selected' : ''}>Geen datums</option>
            <option value="dag" ${(st.docDates || 'dag') === 'dag' ? 'selected' : ''}>Alleen de dag</option>
            <option value="dag-tijd" ${st.docDates === 'dag-tijd' ? 'selected' : ''}>Dag en tijd</option>
          </select></label>
      </div>
      <div class="panel"><h2>AI</h2>
        <div class="sub">${st.hasApiKey ? '✓ Er is een Anthropic API-sleutel ingesteld.' : 'Geen API-sleutel ingesteld: de AI-knoppen werken via Kopieer prompt.'} De sleutel blijft op deze computer.</div>
        <div class="form-row">
          <label class="field grow">API-sleutel<input type="password" id="set-key" placeholder="${st.hasApiKey ? '•••••••• (laat leeg om te houden)' : 'sk-ant-…'}" autocomplete="off"></label>
          <label class="field">Model<input id="set-model" value="${esc(st.model || '')}"></label>
          <button class="btn" data-set-ai="1">Opslaan</button>
          ${st.hasApiKey ? '<button class="btn ghost" data-set-ai="clear">Sleutel weghalen</button>' : ''}
        </div>
      </div>
      <div class="panel"><h2>Meer</h2>
        <div class="form-row"><button class="btn" data-open-keys="1">Sleutels beheren</button><span class="hint">Templates beheer je in het tabblad Template van een project of chat.</span></div>
      </div>
    </div></div>`;
  const main = $('#main');
  main.querySelectorAll('[data-set-theme]').forEach(b => b.addEventListener('click', () => saveSettings({ theme: b.dataset.setTheme }, true)));
  main.querySelectorAll('[data-feature]').forEach(c => c.addEventListener('change', () => saveSettings({ features: { [c.dataset.feature]: c.checked } })));
  $('#set-autosync').addEventListener('change', e => saveSettings({ autoSync: e.target.checked }));
  $('#set-docdates').addEventListener('change', e => saveSettings({ docDates: e.target.value }));
  $('#gh-manage').addEventListener('click', openGitHubLogin);
  drawConnections();
  api('GET', '/api/github').then(g => { const el = $('#gh-line'); if (el) el.textContent = g.loggedIn ? `Ingelogd als ${g.login}.` : 'Niet ingelogd in de app; uploaden gebruikt dan de inlog van je computer (als die er is).'; }).catch(() => {});
  $('#set-interval').addEventListener('change', e => saveSettings({ autoSyncMinutes: Number(e.target.value) }));
  main.querySelectorAll('[data-set-ai]').forEach(b => b.addEventListener('click', () => {
    const patch = { model: $('#set-model').value };
    if (b.dataset.setAi === 'clear') patch.anthropicApiKey = '';
    else if ($('#set-key').value.trim()) patch.anthropicApiKey = $('#set-key').value.trim();
    saveSettings(patch, true);
  }));
}
async function drawConnections() {
  const el = $('#conn-list'); if (!el) return;
  const c = await api('GET', '/api/connections').catch(e => { el.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; return null; });
  if (!c) return;
  el.innerHTML = `
    <div class="conn">
      <div class="conn-head"><span class="svc trello">Trello</span>${c.trello.configured ? `<span>Ingelogd als <b>${esc(c.trello.name)}</b></span><span class="spacer-h"></span><button class="link danger" data-conn-del="trello">Verwijderen</button>` : '<span class="hint">Nog niet ingesteld</span>'}</div>
      ${c.trello.configured ? '<details><summary class="link">Opnieuw instellen</summary>' : '<div>'}
      <ol class="steps">
        <li>Ga naar <a href="https://trello.com/apps/admin" target="_blank" rel="noopener">trello.com/apps/admin</a> en maak een nieuwe app. Kies <b>Mijn app gebruikt geen Power-Up-mogelijkheden</b>; dan is er geen URL nodig.</li>
        <li>Open in die app het tabblad <b>Trello Auth</b> (niet OAuth 2.0) en klik <b>Generate a new API Key</b>. Kopieer de sleutel: 32 tekens, alleen cijfers en a–f.</li>
        <li>Plak de sleutel hieronder en klik op <b>Token ophalen</b>. Klik daar op <i>Allow</i> en kopieer het token.</li>
      </ol>
      <div class="form-row">
        <label class="field grow">API-sleutel<input id="tr-key" autocomplete="off" spellcheck="false"></label>
        <button class="btn ghost" id="tr-auth">Token ophalen</button>
        <label class="field grow">Token<input id="tr-token" type="password" autocomplete="off" spellcheck="false"></label>
        <button class="btn" id="tr-save">Opslaan en testen</button>
      </div>
      ${c.trello.configured ? '</details>' : '</div>'}
    </div>
    <div class="conn">
      <div class="conn-head"><span class="svc jira">Jira</span>${c.jira.configured ? `<span>Ingelogd als <b>${esc(c.jira.name)}</b> op ${esc(c.jira.site)}</span><span class="spacer-h"></span><button class="link danger" data-conn-del="jira">Verwijderen</button>` : '<span class="hint">Nog niet ingesteld</span>'}</div>
      ${c.jira.configured ? '<details><summary class="link">Opnieuw instellen</summary>' : '<div>'}
      <ol class="steps">
        <li>Maak een API-token op <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">id.atlassian.com → API-tokens</a> (kies <b>Create API token</b>, zonder scopes).</li>
        <li>Vul de site van je team in (bijvoorbeeld <code>jouwteam.atlassian.net</code>), je e-mailadres van Atlassian en het token.</li>
      </ol>
      <div class="form-row">
        <label class="field grow">Site<input id="ji-site" placeholder="jouwteam.atlassian.net" value="${esc(c.jira.site || '')}" autocomplete="off"></label>
        <label class="field grow">E-mail<input id="ji-email" value="${esc(c.jira.email || '')}" autocomplete="off"></label>
        <label class="field grow">API-token<input id="ji-token" type="password" autocomplete="off" spellcheck="false"></label>
        <button class="btn" id="ji-save">Opslaan en testen</button>
      </div>
      ${c.jira.configured ? '</details>' : '</div>'}
    </div>`;
  $('#tr-auth').addEventListener('click', () => {
    const key = $('#tr-key').value.trim(); if (!key) return toast('Plak eerst de API-sleutel', true);
    if (!/^[0-9a-f]{32}$/.test(key)) return toast('Dit is geen Trello API-sleutel. De Client-ID van OAuth 2.0 werkt hier niet: neem de sleutel uit het tabblad Trello Auth (32 tekens, alleen cijfers en a–f).', true);
    open(`https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=Leerjournaal&key=${encodeURIComponent(key)}`, '_blank', 'noopener');
  });
  const save = async (kind, body, btn) => {
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Testen…';
    try { const r = await api('PUT', `/api/connections/${kind}`, body); toast(`${svcName(kind)} werkt: ingelogd als ${r.name}`); drawConnections(); }
    catch (e) { fail(e); btn.disabled = false; btn.textContent = label; }
  };
  $('#tr-save').addEventListener('click', e => save('trello', { key: $('#tr-key').value, token: $('#tr-token').value }, e.currentTarget));
  $('#ji-save').addEventListener('click', e => save('jira', { site: $('#ji-site').value, email: $('#ji-email').value, token: $('#ji-token').value }, e.currentTarget));
  el.querySelectorAll('[data-conn-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`${svcName(b.dataset.connDel)}-account verwijderen? Gekoppelde borden worden dan niet meer bijgewerkt.`)) return;
    await api('DELETE', `/api/connections/${b.dataset.connDel}`); drawConnections();
  }));
}

async function saveSettings(patch, rerender = false) {
  try {
    state.settings = await api('PUT', '/api/settings', patch);
    applyTheme(state.settings.theme); loadStatus(); toast('Opgeslagen');
    if (rerender) openSettings();
  } catch (e) { fail(e); }
}

// ---------- sleutels ----------
async function openKeys() {
  setTopbar('Sleutels');
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

// ---------- installeerbaar op je telefoon ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------- start ----------
(async () => {
  await Promise.all([loadSpaces().catch(fail), loadStatus(), loadSettings()]);
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
