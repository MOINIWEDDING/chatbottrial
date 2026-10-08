'use strict';

const $ = (sel) => document.querySelector(sel);
const PAGE_SIZE = 50;
const state = { user: null, catalog: null, filters: {}, offset: 0, total: 0, current: null, simulator: false };

// ------------------------------------------------------------------ utilidades
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error(data.error || 'Sesión expirada'); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

const name = (list, id) => state.catalog[list].find((x) => x.id === id)?.name ?? id;
const deptName = (id) => name('departments', id);
const sectorName = (id) => name('sectors', id);
const statusName = (id) => name('statuses', id);
const channelName = (id) => name('channels', id);
const fmtDate = (s) => new Date(s).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });
const statusBadge = (s) => h('span', { class: `status status-${s}` }, statusName(s));
const isAdmin = () => state.user?.role === 'admin';

// ------------------------------------------------------------------ sesión
function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  closeDrawer();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await api('/api/login', { method: 'POST', body: Object.fromEntries(form) });
    $('#login-error').hidden = true;
    e.target.reset();
    await boot();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').hidden = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

async function boot() {
  let me;
  try { me = await api('/api/me'); } catch { return showLogin(); }
  state.user = me.user;
  state.simulator = me.simulator;
  state.catalog = await api('/api/catalog');
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#user-name').textContent = state.user.name;
  $('#user-team').textContent = isAdmin() ? 'Administración · todos los equipos' : deptName(state.user.department);
  $('#tab-users').hidden = !isAdmin();
  $('#tab-simulator').hidden = !state.simulator;
  $('#department-group').hidden = !isAdmin();
  $('#f-department').hidden = !isAdmin();
  $('#tickets-title').textContent = isAdmin() ? 'Todas las denuncias' : `Denuncias · ${deptName(state.user.department)}`;
  fillSelects();
  switchTab('tickets');
  refresh();
}

function fillSelects() {
  const opts = (sel, list, keepFirst = true) => {
    const el = $(sel);
    const first = keepFirst ? el.querySelector('option') : null;
    el.replaceChildren(...(first ? [first] : []), ...list.map((x) => h('option', { value: x.id }, x.name)));
  };
  opts('#f-department', state.catalog.departments);
  opts('#f-sector', state.catalog.sectors);
  opts('#f-status', state.catalog.statuses);
  opts('#f-channel', state.catalog.channels);
  opts('#d-status', state.catalog.statuses, false);
  opts('#d-department', state.catalog.departments, false);
  opts('#d-sector', state.catalog.sectors, false);
  opts('#user-dept', state.catalog.departments, false);
}

// ------------------------------------------------------------------ pestañas
function switchTab(tab) {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `${tab}-tab`;
  if (tab === 'users') loadUsers();
}
$('#tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) switchTab(e.target.dataset.tab); });

// ------------------------------------------------------------------ listado
function query(extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...state.filters, ...extra })) if (v) p.set(k, v);
  return p.toString();
}

async function refresh() {
  if (!state.user) return;
  const [list, stats] = await Promise.all([
    api(`/api/tickets?${query({ limit: PAGE_SIZE, offset: state.offset })}`),
    api(`/api/stats?${query()}`),
  ]);
  state.total = list.total;
  renderKpis(stats);
  renderChips(stats);
  renderTable(list.items);
  $('#export-csv').href = `/api/tickets.csv?${query()}`;
  $('#last-update').textContent = `Actualizado ${new Date().toLocaleTimeString('es-CL', { timeStyle: 'short' })}`;
}

function renderKpis(stats) {
  const total = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);
  const card = (id, label, n, color) => h('button', {
    class: `card kpi${(state.filters.status || '') === id ? ' selected' : ''}`,
    onclick: () => setFilter('status', id),
  }, h('span', {}, label), h('strong', {}, n), h('div', { class: 'bar', style: `background:${color}` }));
  $('#kpis').replaceChildren(
    card('', 'Total', total, '#98a2b3'),
    ...state.catalog.statuses.map((s) => card(s.id, s.name, stats.byStatus[s.id] ?? 0, `var(--${s.id})`)),
  );
}

function renderChips(stats) {
  const chips = (el, key, list, counts) => {
    const current = state.filters[key] || '';
    $(el).replaceChildren(...list
      .filter((x) => counts[x.id] || current === x.id)
      .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
      .map((x) => h('button', {
        class: current === x.id ? 'selected' : '',
        onclick: () => setFilter(key, current === x.id ? '' : x.id),
      }, x.name, h('b', {}, counts[x.id] ?? 0))));
    if (!$(el).children.length) $(el).append(h('span', { class: 'muted' }, 'Sin denuncias'));
  };
  chips('#sector-chips', 'sector', state.catalog.sectors, stats.bySector);
  if (isAdmin()) chips('#department-chips', 'department', state.catalog.departments, stats.byDepartment);
}

function renderTable(items) {
  $('#tickets-body').replaceChildren(...items.map((t) => h('tr', { class: 'row', onclick: () => openTicket(t.id) },
    h('td', { class: 'nowrap' }, h('strong', {}, t.folio)),
    h('td', { class: 'nowrap' }, fmtDate(t.created_at)),
    h('td', {}, channelName(t.channel)),
    h('td', {}, deptName(t.department)),
    h('td', {}, sectorName(t.sector)),
    h('td', { class: 'desc' }, h('div', {}, t.description), t.address ? h('small', { class: 'muted' }, `📍 ${t.address}`) : null),
    h('td', {}, statusBadge(t.status)),
  )));
  $('#tickets-empty').hidden = items.length > 0;
  const from = state.total ? state.offset + 1 : 0;
  $('#page-info').textContent = `${from}–${state.offset + items.length} de ${state.total}`;
  $('#prev').disabled = state.offset === 0;
  $('#next').disabled = state.offset + PAGE_SIZE >= state.total;
}

function setFilter(key, value) {
  state.filters[key] = value;
  const field = $('#filters').elements[key];
  if (field) field.value = value;
  state.offset = 0;
  refresh();
}

let searchTimer;
$('#filters').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setFilter(e.target.name, e.target.value), e.target.type === 'search' ? 300 : 0);
});
$('#filters').addEventListener('submit', (e) => e.preventDefault());
$('#clear-filters').addEventListener('click', () => {
  $('#filters').reset();
  state.filters = {};
  state.offset = 0;
  refresh();
});
$('#prev').addEventListener('click', () => { state.offset = Math.max(0, state.offset - PAGE_SIZE); refresh(); });
$('#next').addEventListener('click', () => { state.offset += PAGE_SIZE; refresh(); });

// ------------------------------------------------------------------ detalle
async function openTicket(id) {
  const { ticket, messages } = await api(`/api/tickets/${id}`);
  state.current = ticket;
  $('#d-folio').textContent = ticket.folio;
  $('#d-meta').replaceChildren(statusBadge(ticket.status), ` ${channelName(ticket.channel)} · ${fmtDate(ticket.created_at)}`);
  const fact = (k, v) => (v ? [h('dt', {}, k), h('dd', {}, v)] : []);
  const map = ticket.latitude != null
    ? h('a', { href: `https://www.google.com/maps?q=${ticket.latitude},${ticket.longitude}`, target: '_blank', rel: 'noopener' }, 'Ver en mapa')
    : null;
  $('#d-facts').replaceChildren(
    ...fact('Vecino', `${ticket.contact_name || 'Sin nombre'} (${ticket.contact_id})`),
    ...fact('Departamento', deptName(ticket.department)),
    ...fact('Sector', sectorName(ticket.sector)),
    ...fact('Dirección', ticket.address),
    ...fact('Ubicación', map),
    ...fact('Denuncia', ticket.description),
    ...fact('Cerrada', ticket.resolved_at && fmtDate(ticket.resolved_at)),
  );
  $('#d-status').value = ticket.status;
  $('#d-department').value = ticket.department;
  $('#d-sector').value = ticket.sector;
  $('#d-address').value = ticket.address ?? '';
  $('#d-note').value = '';
  $('#d-notify').checked = true;
  renderThread(messages);
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
}

function renderThread(messages) {
  const who = { in: 'Vecino', out: 'Bot / Municipalidad', note: 'Nota interna', system: '' };
  $('#d-thread').replaceChildren(...messages.map((m) => {
    const attachments = (m.attachments ?? []).map((a) => {
      if (a.type === 'location') return h('div', {}, '📍 ', h('a', { href: `https://www.google.com/maps?q=${a.latitude},${a.longitude}`, target: '_blank', rel: 'noopener' }, a.address || 'Ubicación compartida'));
      if (a.url) return h('div', {}, '📎 ', h('a', { href: a.url, target: '_blank', rel: 'noopener' }, `Ver ${a.type}`));
      return h('div', {}, `📎 ${a.type} (id ${a.mediaId})`);
    });
    const author = m.author_name ? ` · ${m.author_name}` : '';
    return h('div', { class: `msg msg-${m.direction}` },
      m.direction !== 'system' ? h('small', {}, `${who[m.direction]}${author} · ${fmtDate(m.created_at)}`) : null,
      m.direction === 'system' ? `${fmtDate(m.created_at)} · ${m.body}${author}` : m.body,
      attachments,
      m.delivery_error ? h('span', { class: 'fail' }, `⚠ No entregado: ${m.delivery_error}`) : null);
  }));
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  state.current = null;
}
$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-backdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

$('#d-save').addEventListener('click', async () => {
  const t = state.current;
  try {
    const res = await api(`/api/tickets/${t.id}`, {
      method: 'PATCH',
      body: {
        status: $('#d-status').value, department: $('#d-department').value, sector: $('#d-sector').value,
        address: $('#d-address').value, notify: $('#d-notify').checked, note: $('#d-note').value,
      },
    });
    if (res.notification?.deliveryError) toast(`Guardado, pero no se pudo avisar al vecino: ${res.notification.deliveryError}`);
    else toast(res.notification ? 'Guardado y vecino notificado' : 'Cambios guardados');
    if (!isAdmin() && res.ticket.department !== state.user.department) {
      closeDrawer();
      toast(`Denuncia derivada a ${deptName(res.ticket.department)}`);
    } else {
      await openTicket(t.id);
    }
    refresh();
  } catch (err) { toast(err.message); }
});

$('#d-reply').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = e.target.elements.body.value.trim();
  if (!body) return;
  const toCitizen = e.submitter?.value === 'citizen';
  try {
    const res = await api(`/api/tickets/${state.current.id}/messages`, { method: 'POST', body: { body, toCitizen } });
    toast(res.deliveryError ? `No se pudo entregar: ${res.deliveryError}` : toCitizen ? 'Mensaje enviado al vecino' : 'Nota guardada');
    e.target.reset();
    openTicket(state.current.id);
  } catch (err) { toast(err.message); }
});

// ------------------------------------------------------------------ simulador
let simContact = `vecino-${Math.random().toString(36).slice(2, 8)}`;
const bubble = (text, who) => {
  const log = $('#chat-log');
  log.append(h('div', { class: `bubble ${who}` }, text));
  log.scrollTop = log.scrollHeight;
};
const resetChat = () => {
  simContact = `vecino-${Math.random().toString(36).slice(2, 8)}`;
  $('#chat-log').replaceChildren();
  $('#chat-contact').textContent = `Conversando como ${simContact}`;
};
resetChat();
$('#chat-reset').addEventListener('click', resetChat);
$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.text;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  bubble(text, 'me');
  try {
    const res = await api('/api/simulate', { method: 'POST', body: { contactId: simContact, contactName: 'Vecino de prueba', text } });
    res.replies.forEach((r) => bubble(r, 'bot'));
    refresh();
  } catch (err) { toast(err.message); }
});

// ------------------------------------------------------------------ usuarios
async function loadUsers() {
  const users = await api('/api/users');
  $('#users-body').replaceChildren(...users.map((u) => h('tr', {},
    h('td', {}, u.name),
    h('td', {}, u.username),
    h('td', {}, u.role === 'admin' ? 'Administrador' : deptName(u.department)),
    h('td', { class: 'nowrap' },
      h('button', { class: 'btn ghost', onclick: () => resetPassword(u) }, 'Contraseña'),
      u.id !== state.user.id ? h('button', { class: 'btn ghost', onclick: () => deleteUser(u) }, 'Eliminar') : null),
  )));
}

async function resetPassword(u) {
  const password = prompt(`Nueva contraseña para ${u.name} (mínimo 8 caracteres):`);
  if (!password) return;
  try { await api(`/api/users/${u.id}/password`, { method: 'PATCH', body: { password } }); toast('Contraseña actualizada'); }
  catch (err) { toast(err.message); }
}

async function deleteUser(u) {
  if (!confirm(`¿Eliminar el usuario ${u.name}?`)) return;
  try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); loadUsers(); }
  catch (err) { toast(err.message); }
}

$('#user-role').addEventListener('change', (e) => { $('#user-dept-label').hidden = e.target.value === 'admin'; });
$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    $('#user-dept-label').hidden = false;
    $('#user-error').hidden = true;
    toast('Usuario creado');
    loadUsers();
  } catch (err) {
    $('#user-error').textContent = err.message;
    $('#user-error').hidden = false;
  }
});

// ------------------------------------------------------------------ inicio
setInterval(() => { if (!$('#app-view').hidden && !document.hidden) refresh().catch(() => {}); }, 30_000);
boot();
