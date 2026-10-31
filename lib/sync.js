// Synchronisatie in twee richtingen tussen het lokale Kanbanbord en Trello of Jira.
//
// Per gekoppelde kaart onthouden we de laatst gesynchroniseerde waarden ("base").
// Bij het verversen vergelijken we per veld (titel, beschrijving, kolom):
//   alleen daar gewijzigd  -> hier overnemen
//   alleen hier gewijzigd  -> naar Trello/Jira sturen
//   op beide anders        -> conflict: jij kiest welke versie blijft
const crypto = require('crypto');

const FIELDS = ['title', 'description', 'column'];
const newId = () => crypto.randomBytes(4).toString('hex');
const norm = v => (v == null ? '' : String(v));

function addConflict(board, card, field, remote) {
  board.conflicts = (board.conflicts || []).filter(c => !(c.cardId === card.id && c.field === field));
  board.conflicts.push({ cardId: card.id, field, local: card[field], remote, at: new Date().toISOString() });
}
const hasConflict = (board, cardId, field) => (board.conflicts || []).some(c => c.cardId === cardId && c.field === field);

// Haalt alles op van Trello/Jira en verwerkt het in het lokale bord. Stuurt daarna lokale wijzigingen terug.
async function refresh(board, adapter) {
  const link = board.link;
  const summary = { pulled: 0, added: 0, removed: 0, pushed: 0, created: 0, conflicts: 0, errors: [] };

  // 1. Kolommen volgen Trello/Jira.
  const columns = await adapter.getColumns(link.target);
  if (!columns.length) throw Object.assign(new Error(`Dit ${adapter.label}-bord heeft geen kolommen.`), { status: 400 });
  board.columns = columns;
  const colIds = new Set(columns.map(c => c.id));
  for (const c of board.cards) if (!colIds.has(c.column)) c.column = columns[0].id;
  for (const c of board.cards) if (c.remote?.base && !colIds.has(c.remote.base.column)) c.remote.base.column = c.column;

  // 2. Kaarten ophalen en vergelijken.
  const remote = await adapter.listCards(link.target, columns);
  const byRemote = new Map(board.cards.filter(c => c.remote).map(c => [c.remote.id, c]));
  const seen = new Set();
  remote.forEach((rc, i) => {
    seen.add(rc.remoteId);
    let card = byRemote.get(rc.remoteId);
    if (!card) {
      board.cards.push({
        id: newId(), title: rc.title, description: rc.description, column: rc.column, order: i + 1, createdAt: new Date().toISOString(),
        remote: { id: rc.remoteId, key: rc.key, url: rc.url, updatedAt: rc.updatedAt, base: { title: rc.title, description: rc.description, column: rc.column } }
      });
      summary.added++;
      return;
    }
    card.remote.key = rc.key; card.remote.url = rc.url; card.remote.updatedAt = rc.updatedAt;
    const base = card.remote.base || {};
    let localColumnChanged = false;
    for (const f of FIELDS) {
      const L = norm(card[f]), B = norm(base[f]), R = norm(rc[f]);
      if (R === B) { if (f === 'column' && L !== B) localColumnChanged = true; continue; }
      if (L === B) { card[f] = rc[f]; base[f] = rc[f]; summary.pulled++; }
      else if (L === R) { base[f] = rc[f]; }
      else if (!hasConflict(board, card.id, f)) { addConflict(board, card, f, rc[f]); summary.conflicts++; }
    }
    card.remote.base = base;
    if (!localColumnChanged) card.order = i + 1;
  });

  // 3. Kaarten die daar niet meer bestaan (gearchiveerd, verwijderd of al lang klaar).
  board.cards = board.cards.filter(card => {
    if (!card.remote || seen.has(card.remote.id)) return true;
    const changed = FIELDS.some(f => norm(card[f]) !== norm(card.remote.base?.[f]));
    if (!changed) { summary.removed++; board.conflicts = (board.conflicts || []).filter(c => c.cardId !== card.id); return false; }
    // Hier nog gewijzigd: als lokale kaart bewaren, zodat er niets verloren gaat.
    card.remoteGone = { kind: adapter.label, key: card.remote.key, at: new Date().toISOString() };
    delete card.remote; card.localOnly = true;
    return true;
  });

  // 4. Lokale wijzigingen terugsturen.
  await push(board, adapter, summary);
  link.lastRefresh = new Date().toISOString();
  link.lastError = summary.errors.length ? summary.errors.join(' ') : null;
  return summary;
}

// Stuurt nieuwe en gewijzigde kaarten naar Trello/Jira. Mislukt iets, dan blijft de wijziging staan voor een volgende keer.
async function push(board, adapter, summary = { pushed: 0, created: 0, errors: [] }, onlyCardId = null) {
  const link = board.link;
  for (const card of board.cards) {
    if (onlyCardId && card.id !== onlyCardId) continue;
    if (card.localOnly) continue;
    try {
      if (!card.remote) {
        const rc = await adapter.createCard(link.target, board.columns, { title: card.title, description: card.description, column: card.column });
        card.remote = { id: rc.remoteId, key: rc.key, url: rc.url, updatedAt: rc.updatedAt, base: { title: rc.title, description: rc.description, column: rc.column } };
        if (rc.column && rc.column !== card.column) card.column = rc.column; // Jira kon niet direct naar die kolom
        summary.created++;
        continue;
      }
      let patch = {};
      for (const f of FIELDS) {
        if (hasConflict(board, card.id, f)) continue;
        if (norm(card[f]) !== norm(card.remote.base?.[f])) patch[f] = card[f];
      }
      if (!Object.keys(patch).length) continue;
      // Eerst kijken of iemand daar intussen hetzelfde veld heeft aangepast: dan niet overschrijven maar laten kiezen.
      const now = await adapter.getCard(link.target, board.columns, card.remote.key || card.remote.id);
      for (const f of Object.keys(patch)) {
        const B = norm(card.remote.base[f]), R = norm(now[f]), L = norm(card[f]);
        if (R === L) { card.remote.base[f] = now[f]; delete patch[f]; }
        else if (R !== B) { addConflict(board, card, f, now[f]); delete patch[f]; summary.conflicts = (summary.conflicts || 0) + 1; }
      }
      if (!Object.keys(patch).length) continue;
      const rc = await adapter.updateCard(link.target, board.columns, card.remote.key || card.remote.id, patch);
      for (const f of Object.keys(patch)) card.remote.base[f] = card[f];
      if (rc) { card.remote.updatedAt = rc.updatedAt; card.remote.url = rc.url || card.remote.url; }
      summary.pushed++;
    } catch (e) {
      summary.errors.push(`“${card.title}”: ${e.message}`);
      if (e.network) break; // geen verbinding: de rest heeft ook geen zin
      // Jira weigert een kolomwissel: kaart terugzetten naar waar hij in Jira staat.
      if (e.status === 409 && card.remote?.base) card.column = card.remote.base.column;
    }
  }
  if (summary.errors.length) link.lastError = summary.errors.join(' ');
  return summary;
}

// Lost een conflict op: 'mine' = mijn versie naar Trello/Jira sturen, 'theirs' = hun versie overnemen.
function resolve(board, cardId, field, choice) {
  const c = (board.conflicts || []).find(x => x.cardId === cardId && x.field === field);
  if (!c) throw Object.assign(new Error('Dit conflict bestaat niet meer.'), { status: 404 });
  const card = board.cards.find(x => x.id === cardId);
  board.conflicts = board.conflicts.filter(x => x !== c);
  if (!card || !card.remote) return null;
  card.remote.base[field] = c.remote;
  if (choice === 'theirs') card[field] = c.remote;
  return card;
}

// Koppelen: bestaande lokale kaarten worden lokaal (niet verstuurd), tenzij sendExisting.
function link(board, kind, target, sendExisting) {
  board.link = { kind, target, linkedAt: new Date().toISOString(), lastRefresh: null, lastError: null };
  board.conflicts = [];
  for (const c of board.cards) { delete c.remote; delete c.remoteGone; c.localOnly = !sendExisting; }
  return board;
}

function unlink(board) {
  const kind = board.link?.kind;
  delete board.link;
  board.conflicts = [];
  for (const c of board.cards) { if (c.remote) { c.unlinkedFrom = { kind, key: c.remote.key }; delete c.remote; } c.localOnly = false; }
  return board;
}

module.exports = { refresh, push, resolve, link, unlink };
