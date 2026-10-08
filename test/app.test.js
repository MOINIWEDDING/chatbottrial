const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createUser } = require('../src/auth');

const SECRET = 'app-secret';
const silent = { info() {}, warn() {}, error() {} };

async function setup() {
  const db = await openDatabase({ url: ':memory:' });
  const sent = [];
  const send = async (target, text) => { sent.push({ ...target, text }); return {}; };
  const config = {
    publicUrl: '', enableSimulator: true, conversationWindowMinutes: 30, sessionDays: 1,
    meta: { verifyToken: 'verificame', appSecret: SECRET },
  };
  const { app } = createApp({ db, send, config, logger: silent });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await createUser(db, { username: 'admin', name: 'Admin', password: 'admin-pass', role: 'admin' });
  await createUser(db, { username: 'obras', name: 'Obras', password: 'obras-pass', department: 'obras' });
  await createUser(db, { username: 'aseo', name: 'Aseo', password: 'aseo-pass', department: 'aseo' });
  return { db, sent, server, base };
}

async function login(base, username, password) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (path, opts = {}) => fetch(`${base}${path}`, {
    ...opts,
    headers: { cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

function postWebhook(base, payload, secret = SECRET) {
  const raw = JSON.stringify(payload);
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return fetch(`${base}/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw,
  });
}

const waText = (id, from, body) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'PNID' },
    contacts: [{ wa_id: from, profile: { name: 'Vecina' } }],
    messages: [{ from, id, type: 'text', text: { body } }],
  } }] }],
});

const waitFor = async (fn) => {
  for (let i = 0; i < 50; i += 1) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timeout');
};

test('verificación del webhook', async (t) => {
  const { server, base } = await setup();
  t.after(() => server.close());
  const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verificame&hub.challenge=123`);
  assert.equal(await ok.text(), '123');
  const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=123`);
  assert.equal(bad.status, 403);
});

test('rechaza webhooks con firma inválida', async (t) => {
  const { server, base, db } = await setup();
  t.after(() => server.close());
  const res = await postWebhook(base, waText('w1', '569', 'bache en Lira'), 'falso');
  assert.equal(res.status, 401);
  assert.equal((await db.get('SELECT COUNT(*) n FROM tickets')).n, 0);
});

test('flujo completo: WhatsApp → denuncia → panel del equipo correcto', async (t) => {
  const { server, base, db, sent } = await setup();
  t.after(() => server.close());

  // 1. El vecino denuncia sin dirección: el bot responde con folio y pide ubicación.
  assert.equal((await postWebhook(base, waText('w1', '56911111111', 'Hay un bache enorme en mi calle'))).status, 200);
  await waitFor(() => sent.length === 1);
  assert.match(sent[0].text, /SCL-\d{4}-000001/);
  assert.match(sent[0].text, /Obras Públicas/);
  assert.match(sent[0].text, /dirección exacta/);
  assert.deepEqual(sent[0].replyTo, { phoneNumberId: 'PNID' });

  // 2. Webhook repetido por Meta: no se duplica.
  await postWebhook(base, waText('w1', '56911111111', 'Hay un bache enorme en mi calle'));
  // 3. El vecino entrega la dirección → se detecta el sector.
  await postWebhook(base, waText('w2', '56911111111', 'Calle Lira 450'));
  await waitFor(() => sent.length === 2);
  assert.match(sent[1].text, /San Borja/);
  const ticket = (await db.get('SELECT * FROM tickets'));
  assert.equal((await db.get('SELECT COUNT(*) n FROM tickets')).n, 1);
  assert.equal(ticket.department, 'obras');
  assert.equal(ticket.sector, 'san-borja');
  assert.equal(ticket.address, 'Calle Lira 450');

  // 4. Obras ve la denuncia; Aseo no.
  const obras = await login(base, 'obras', 'obras-pass');
  const aseo = await login(base, 'aseo', 'aseo-pass');
  assert.equal((await (await obras('/api/tickets')).json()).total, 1);
  assert.equal((await (await aseo('/api/tickets')).json()).total, 0);
  assert.equal((await aseo('/api/tickets?department=obras')).status, 200);
  assert.equal((await (await aseo('/api/tickets?department=obras')).json()).total, 0, 'no puede saltarse el filtro');
  assert.equal((await aseo(`/api/tickets/${ticket.id}`)).status, 404);

  // 5. Filtro por sector.
  assert.equal((await (await obras('/api/tickets?sector=san-borja')).json()).total, 1);
  assert.equal((await (await obras('/api/tickets?sector=yungay')).json()).total, 0);

  // 6. Obras la marca en proceso → el vecino recibe aviso.
  const patch = await obras(`/api/tickets/${ticket.id}`, { method: 'PATCH', body: { status: 'en_proceso', note: 'Vamos mañana' } });
  assert.equal(patch.status, 200);
  assert.match(sent.at(-1).text, /En proceso/);
  assert.match(sent.at(-1).text, /Vamos mañana/);

  // 7. Historial completo en el detalle.
  const detail = await (await obras(`/api/tickets/${ticket.id}`)).json();
  assert.deepEqual(detail.messages.map((m) => m.direction), ['in', 'out', 'in', 'out', 'system', 'out']);

  // 8. Derivación a otro equipo.
  await obras(`/api/tickets/${ticket.id}`, { method: 'PATCH', body: { department: 'aseo' } });
  assert.equal((await (await obras('/api/tickets')).json()).total, 0);
  assert.equal((await (await aseo('/api/tickets')).json()).total, 1);
});

test('el administrador ve todo y gestiona usuarios', async (t) => {
  const { server, base } = await setup();
  t.after(() => server.close());
  const admin = await login(base, 'admin', 'admin-pass');
  const obras = await login(base, 'obras', 'obras-pass');
  for (const text of ['basura en Yungay', 'bache en Lira', 'plaza Brasil con juegos rotos']) {
    await admin('/api/simulate', { method: 'POST', body: { contactId: text, text } });
  }
  const all = await (await admin('/api/tickets')).json();
  assert.equal(all.total, 3);
  const stats = await (await admin('/api/stats')).json();
  assert.deepEqual(stats.byDepartment, { aseo: 1, obras: 1, parques: 1 });
  assert.deepEqual(stats.bySector, { yungay: 1, 'san-borja': 1, brasil: 1 });

  assert.equal((await obras('/api/users')).status, 403);
  const created = await admin('/api/users', { method: 'POST', body: { username: 'parques', name: 'P', password: 'parques-123', department: 'parques' } });
  assert.equal(created.status, 201);
  const parques = await login(base, 'parques', 'parques-123');
  assert.equal((await (await parques('/api/tickets')).json()).total, 1);

  const csv = await (await admin('/api/tickets.csv')).text();
  assert.equal(csv.trim().split('\r\n').length, 4);
});

test('conversación: saludo, mensajes adicionales y consulta de estado', async (t) => {
  const { server, base } = await setup();
  t.after(() => server.close());
  const admin = await login(base, 'admin', 'admin-pass');
  const say = async (text) => (await (await admin('/api/simulate', { method: 'POST', body: { contactId: 'v1', text } })).json());

  assert.match((await say('Hola')).replies[0], /Cuéntanos/);
  const first = await say('Hay basura acumulada en la plaza Yungay');
  assert.equal(first.ticket.department, 'aseo');
  assert.equal(first.ticket.sector, 'yungay');
  assert.match((await say('Además hay ratas')).replies[0], /Agregamos/);
  assert.match((await say('ESTADO')).replies[0], /Nueva/);
  assert.match((await say('nueva')).replies[0], /nuevo problema/);
  const second = await say('Semáforo malo en Matta con Santa Rosa');
  assert.notEqual(second.ticket.id, first.ticket.id);
  assert.equal(second.ticket.department, 'transito');
});

test('requiere sesión', async (t) => {
  const { server, base } = await setup();
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/api/tickets`)).status, 401);
  const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"admin","password":"x"}' });
  assert.equal(bad.status, 401);
});
