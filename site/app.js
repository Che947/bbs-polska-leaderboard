'use strict';

const byId = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('pl-PL');
const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' });
const monthNames = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
let dataset = { generatedAt: null, tournaments: [], players: [], warnings: [], error: null };
let sortState = { key: 'points', direction: 'desc' };
let showAllPlayers = false;

function fmtDate(ms, short = false) {
  if (!ms) return '—';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '—' : (short ? shortDateFmt : dateFmt).format(d);
}
function fmtScore(n) { return nf.format(Math.round(Number(n) || 0)); }
function normalizedHistory(player) {
  return Array.isArray(player.history) ? player.history : [];
}
function getFilters() {
  return { year: byId('year-filter').value, month: byId('month-filter').value, search: byId('search-player').value.trim().toLocaleLowerCase('pl-PL') };
}
function periodHistory(player, filters) {
  return normalizedHistory(player).filter((entry) => {
    const d = new Date(entry.startsAt || 0);
    const targetYear = filters.year === 'current' ? String(new Date().getFullYear()) : filters.year;
    if (targetYear !== 'all' && String(d.getFullYear()) !== targetYear) return false;
    if (filters.month !== 'all' && String(d.getMonth() + 1) !== filters.month) return false;
    return true;
  });
}
function calculatePlayers() {
  const filters = getFilters();
  const result = dataset.players.map((p) => {
    const history = periodHistory(p, filters);
    const points = history.reduce((sum, x) => sum + (Number(x.score) || 0), 0);
    const best = history.reduce((acc, x) => !acc || (Number(x.score) || 0) > (Number(acc.score) || 0) ? x : acc, null);
    return { ...p, history, points, battles: history.length, average: history.length ? points / history.length : 0, best };
  }).filter((p) => p.battles > 0 && (!filters.search || p.username.toLocaleLowerCase('pl-PL').includes(filters.search)));
  result.sort((a, b) => {
    const av = sortState.key === 'battles' ? a.battles : sortState.key === 'average' ? a.average : a.points;
    const bv = sortState.key === 'battles' ? b.battles : sortState.key === 'average' ? b.average : b.points;
    const diff = bv - av;
    return (sortState.direction === 'desc' ? diff : -diff) || a.username.localeCompare(b.username);
  });
  return result;
}
function fillFilters() {
  const years = [...new Set(dataset.tournaments.filter((t) => Number(t.bbsPlayerCount) > 0).map((t) => new Date(t.startsAt).getFullYear()).filter(Number.isFinite))].sort((a,b) => b-a);
  const year = byId('year-filter');
  const keepYear = year.value;
  year.innerHTML = '<option value="all">Cała historia</option><option value="current">Bieżący rok</option>';
  years.forEach((y) => { const o = document.createElement('option'); o.value = String(y); o.textContent = String(y); year.append(o); });
  if ([...year.options].some((o) => o.value === keepYear)) year.value = keepYear;
  const month = byId('month-filter');
  const keepMonth = month.value;
  month.innerHTML = '<option value="all">Wszystkie</option>';
  monthNames.forEach((name, i) => { const o = document.createElement('option'); o.value = String(i + 1); o.textContent = name; month.append(o); });
  if ([...month.options].some((o) => o.value === keepMonth)) month.value = keepMonth;
}
function updateRangeStats(events) {
  if (!events.length) { byId('stat-range').textContent = '—'; return; }
  const dates = events.map((e) => Number(e.startsAt)).filter(Number.isFinite).sort((a,b) => a-b);
  if (!dates.length) { byId('stat-range').textContent = '—'; return; }
  const first = new Date(dates[0]);
  const last = new Date(dates[dates.length - 1]);
  byId('stat-range').textContent = first.getFullYear() === last.getFullYear() ? String(first.getFullYear()) : `${first.getFullYear()}–${last.getFullYear()}`;
}
function makeAvatar(username) {
  const el = document.createElement('span');
  el.className = 'player-avatar';
  el.textContent = (username || '?').slice(0, 1).toLocaleUpperCase('pl-PL');
  return el;
}
function createPlayerCell(player, rank) {
  const cell = document.createElement('td');
  const wrapper = document.createElement('div'); wrapper.className = 'player-cell';
  wrapper.append(makeAvatar(player.username));
  const name = document.createElement('span'); name.className = 'player-name'; name.textContent = player.username;
  const a = document.createElement('a'); a.href = `https://lichess.org/@/${encodeURIComponent(player.username)}`; a.target = '_blank'; a.rel = 'noreferrer'; a.setAttribute('aria-label', `Profil ${player.username} na Lichess`); a.append(name);
  const icon = document.createElement('span'); icon.className = 'player-link-icon'; icon.textContent = '↗'; a.append(icon);
  wrapper.append(a);
  if (rank === 1) { const badge = document.createElement('span'); badge.className = 'player-badge'; badge.textContent = 'LIDER'; wrapper.append(badge); }
  cell.append(wrapper); return cell;
}
function renderLeaderboard(players) {
  const tbody = byId('leaderboard-body');
  const expand = byId('table-expand');
  const toggle = byId('toggle-all-players');
  tbody.replaceChildren();
  if (!players.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 6; td.className = 'empty-cell';
    td.textContent = dataset.players.length ? 'Brak wyników w wybranym okresie lub dla tej frazy.' : 'Nie ma jeszcze pobranych wyników. Po pierwszym uruchomieniu synchronizacji tabela wypełni się automatycznie.';
    tr.append(td); tbody.append(tr);
    expand.hidden = true;
    byId('table-count').textContent = '0 zawodników';
    return;
  }
  const searchActive = Boolean(getFilters().search);
  const expanded = showAllPlayers || searchActive || players.length <= 10;
  const visiblePlayers = expanded ? players : players.slice(0, 10);
  expand.hidden = players.length <= 10 || searchActive;
  toggle.textContent = showAllPlayers ? 'Pokaż tylko TOP 10' : `Pokaż wszystkich (${fmtScore(players.length)})`;
  toggle.setAttribute('aria-expanded', String(showAllPlayers));
  byId('table-count').textContent = expanded
    ? `${fmtScore(players.length)} zawodników`
    : `Pokazano 10 z ${fmtScore(players.length)} zawodników`;
  visiblePlayers.forEach((p, i) => {
    const tr = document.createElement('tr');
    const rank = document.createElement('td'); rank.className = 'rank-number' + (i < 3 ? ` top-${['one','two','three'][i]}` : ''); rank.textContent = String(i + 1).padStart(2, '0'); tr.append(rank);
    tr.append(createPlayerCell(p, i + 1));
    const points = document.createElement('td'); points.className = 'points-cell'; points.textContent = fmtScore(p.points); tr.append(points);
    const battles = document.createElement('td'); battles.textContent = fmtScore(p.battles); tr.append(battles);
    const avg = document.createElement('td'); avg.textContent = p.battles ? p.average.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—'; tr.append(avg);
    const best = document.createElement('td');
    if (p.best) { const chip = document.createElement('span'); chip.className = 'score-chip'; chip.textContent = fmtScore(p.best.score); best.append(chip); const label = document.createElement('span'); label.style.cssText = 'margin-left:8px;color:#7e8a7b;font-size:10px'; label.textContent = p.best.name || 'bitwa klubowa'; best.append(label); }
    else best.textContent = '—';
    tr.append(best); tbody.append(tr);
  });
}
function renderPodium(players) {
  const root = byId('podium'); root.replaceChildren();
  if (!players.length) { const p = document.createElement('p'); p.className='empty-inline'; p.textContent='Podium pojawi się po pobraniu wyników.'; root.append(p); return; }
  const order = [1, 0, 2];
  order.forEach((idx) => {
    const player = players[idx];
    if (!player) { const empty = document.createElement('div'); empty.className = 'podium-card'; empty.style.opacity = '.3'; empty.textContent = '—'; root.append(empty); return; }
    const card = document.createElement('div'); card.className = 'podium-card' + (idx === 0 ? ' first' : '');
    const rank = document.createElement('div'); rank.className = 'podium-rank'; rank.textContent = `MIEJSCE ${idx + 1}`; card.append(rank);
    const medal = document.createElement('span'); medal.className='podium-medal'; medal.textContent = ['♛','♜','♝'][idx]; card.append(medal);
    const link = document.createElement('a'); link.className='podium-name'; link.href=`https://lichess.org/@/${encodeURIComponent(player.username)}`; link.target='_blank'; link.rel='noreferrer'; link.textContent=player.username; card.append(link);
    const score = document.createElement('div'); score.className='podium-score'; score.textContent=`${fmtScore(player.points)} pkt`; card.append(score);
    const caption = document.createElement('div'); caption.className='podium-caption'; caption.textContent=`${player.battles} bitew`; card.append(caption);
    root.append(card);
  });
}
function renderBattles() {
  const root = byId('recent-battles'); root.replaceChildren();
  const filters = getFilters();
  let events = dataset.tournaments.filter((t) => Number(t.bbsPlayerCount) > 0).filter((t) => {
    const d = new Date(t.startsAt || 0);
    if (filters.year !== 'all' && String(d.getFullYear()) !== (filters.year === 'current' ? String(new Date().getFullYear()) : filters.year)) return false;
    if (filters.month !== 'all' && String(d.getMonth() + 1) !== filters.month) return false;
    return true;
  }).sort((a,b) => b.startsAt - a.startsAt).slice(0, 7);
  if (!events.length) { const p=document.createElement('p');p.className='empty-inline';p.textContent='Brak bitew w wybranym okresie.';root.append(p);return; }
  events.forEach((event) => {
    const row = document.createElement('div'); row.className='battle-row';
    const d = new Date(event.startsAt || 0); const date = document.createElement('div'); date.className='battle-date';
    const day = document.createElement('strong'); day.textContent=String(d.getDate()).padStart(2,'0'); date.append(day, document.createTextNode(d.toLocaleDateString('pl-PL',{month:'short'}).replace('.',''))); row.append(date);
    const info = document.createElement('div'); info.className='battle-info'; const a=document.createElement('a');a.className='battle-name';a.href=event.url || `https://lichess.org/tournament/${encodeURIComponent(event.id)}`;a.target='_blank';a.rel='noreferrer';a.textContent=event.name || 'Bitwa klubowa';info.append(a);
    const meta=document.createElement('div');meta.className='battle-meta';meta.textContent=`${fmtScore(event.bbsPlayerCount || 0)} zawodników BBS · ${fmtDate(event.startsAt,true)}`;info.append(meta);row.append(info);
    const score=document.createElement('span');score.className='battle-score';score.textContent=`${fmtScore(event.bbsPoints || 0)} pkt`;row.append(score);root.append(row);
  });
}
function renderStats(players) {
  const filters = getFilters();
  const events = dataset.tournaments.filter((t) => Number(t.bbsPlayerCount) > 0).filter((t) => {
    const d=new Date(t.startsAt || 0);
    if (filters.year !== 'all' && String(d.getFullYear()) !== (filters.year === 'current' ? String(new Date().getFullYear()) : filters.year)) return false;
    if (filters.month !== 'all' && String(d.getMonth()+1) !== filters.month) return false;
    return true;
  });
  byId('stat-players').textContent=fmtScore(players.length);
  byId('stat-battles').textContent=fmtScore(events.length);
  byId('stat-points').textContent=fmtScore(events.reduce((sum,e)=>sum+(Number(e.bbsPoints)||0),0));
  updateRangeStats(events);
  byId('table-count').textContent=`${players.length} ${players.length===1?'zawodnik':players.length>=2&&players.length<=4?'zawodników':'zawodników'}`;
}
function showWarnings() {
  const box = byId('data-notice');
  const messages = [];
  if (dataset.error) messages.push(dataset.error);

  // Events where no Polish-team player participated are routine in
  // international team battles, not warnings for visitors. Ignore those
  // legacy warning strings and summarize only actionable data-quality notes.
  const warnings = Array.isArray(dataset.warnings) ? dataset.warnings : [];
  const actionable = warnings.filter((message) => !message.includes('nie ma wyników przypisanych do drużyny'));
  if (actionable.length) {
    const missingTeam = actionable.filter((message) => message.includes('wpisów z API nie miało pola team'));
    if (missingTeam.length === actionable.length) {
      const missingRows = missingTeam.reduce((sum, message) => {
        const match = message.match(/(\\d+) wpisów z API/);
        return sum + (match ? Number(match[1]) : 0);
      }, 0);
      messages.push(`Lichess nie udostępnił informacji o drużynie dla ${fmtScore(missingRows)} wpisów w ${fmtScore(missingTeam.length)} bitwach. Do rankingu wliczono wyłącznie jednoznacznie przypisanych zawodników.`);
    } else {
      messages.push(`Pobrano dane, ale wykryto ${fmtScore(actionable.length)} ostrzeżeń. Szczegóły są dostępne w Actions na GitHubie.`);
    }
  }
  if (!dataset.generatedAt && !dataset.error) messages.push('Dane nie zostały jeszcze pobrane. Uruchom workflow „BBS Polska — update and deploy” w zakładce Actions na GitHubie.');
  box.hidden = messages.length === 0;
  box.textContent = messages.join(' ');
}
function render() {
  const players=calculatePlayers();
  renderStats(players);
  renderLeaderboard(players);
  renderPodium(players);
  renderBattles();
  document.querySelectorAll('.sort-button').forEach((btn)=>{
    const active=btn.dataset.sort===sortState.key;
    const arrow=btn.querySelector('span');
    if(arrow) arrow.textContent=active?(sortState.direction==='desc'?'↓':'↑'):'↕';
  });
}
function initEvents() {
  byId('search-player').addEventListener('input',render);
  byId('toggle-all-players').addEventListener('click', () => {
    showAllPlayers = !showAllPlayers;
    render();
  });
  byId('year-filter').addEventListener('change',()=>{
    if(byId('year-filter').value==='current') { /* Current year is resolved at render time. */ }
    render();
  });
  byId('month-filter').addEventListener('change',render);
  document.querySelectorAll('.sort-button').forEach((btn)=>btn.addEventListener('click',()=>{
    const key=btn.dataset.sort;
    if(sortState.key===key) sortState.direction=sortState.direction==='desc'?'asc':'desc';
    else {sortState.key=key;sortState.direction='desc';}
    render();
  }));
}
async function init() {
  initEvents();
  try {
    const response=await fetch('data/results.json',{cache:'no-store'});
    if(!response.ok) throw new Error(`Nie udało się odczytać pliku z danymi (HTTP ${response.status}).`);
    const incoming=await response.json();
    dataset={...dataset,...incoming};
    if(dataset.generatedAt) {
      const d=new Date(dataset.generatedAt);
      byId('last-updated').textContent=`Dane z ${d.toLocaleString('pl-PL',{dateStyle:'medium',timeStyle:'short'})}`;
    } else byId('last-updated').textContent='Oczekiwanie na pierwszą synchronizację';
    fillFilters();
    showWarnings();
    render();
  } catch (error) {
    byId('last-updated').textContent='Nie udało się odczytać danych';
    dataset.error=error.message || 'Nie udało się odczytać danych.';
    showWarnings();render();
  }
}
init();
