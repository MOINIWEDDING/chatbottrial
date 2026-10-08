// Flujo completo contra Postgres por red (driver "pg"), igual que con Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase, toPositional, pgOptions, isUniqueViolation } = require('../src/db');
const { createApp } = require('../src/app');
const { createUser } = require('../src/auth');
const { startPostgres } = require('./helpers');

test('traduce los parámetros "?" a $1, $2… sin tocar textos entre comillas', () => {
  assert.equal(toPositional("SELECT ? , 'a?b', x = ? AND y LIKE 'it''s?'"), "SELECT $1 , 'a?b', x = $2 AND y LIKE 'it''s?'");
});

test('conexión con Supabase: SSL y limpieza de sslmode', () => {
  const sb = pgOptions('postgresql://postgres.abc:p%40ss@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x');
  assert.deepEqual(sb.ssl, { rejectUnauthorized: false });
  assert.equal(sb.connectionString, 'postgresql://postgres.abc:p%40ss@aws-0-sa-east-1.pooler.supabase.com:6543/postgres');
  const withCa = pgOptions('postgresql://u:p@db.example.com:5432/postgres', '-----BEGIN CERTIFICATE-----\\nX\\n-----END CERTIFICATE-----');
  assert.deepEqual(withCa.ssl, { ca: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----', rejectUnauthorized: true });
  assert.equal(pgOptions('postgres://u:p@localhost:5432/db').ssl, false);
});

test('Postgres: denuncias, panel por equipo, duplicados y usuarios', async (t) => {
  const pg = await startPostgres();
  const db = await openDatabase({ url: pg.url });
  t.after(async () => { await db.close(); await pg.stop(); });
  assert.equal(db.kind, 'postgres');

  // Abrir de nuevo no vuelve a crear el esquema ni falla.
  const again = await openDatabase({ url: pg.url });
  await again.close();

  // Supabase expone "public" por su API: las tablas deben tener RLS activado.
  const rls = await db.all("SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity ORDER BY relname");
  assert.deepEqual(rls.map((r) => r.relname), ['conversations', 'messages', 'sessions', 'tickets', 'users']);

  const sent = [];
  const { app } = createApp({
    db, send: async (target, text) => { sent.push({ ...target, text }); },
    config: { publicUrl: '', enableSimulator: true, conversationWindowMinutes: 30, sessionDays: 7, meta: { verifyToken: 'v', appSecret: 'sec' } },
    logger: { info() {}, warn() {}, error() {} },
  });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await createUser(db, { username: 'admin', name: 'Admin', password: 'admin-pass', role: 'admin' });
  await createUser(db, { username: 'obras', name: 'Obras', password: 'obras-pass', department: 'obras' });
  await assert.rejects(createUser(db, { username: 'OBRAS', name: 'X', password: 'x', department: 'obras' }), isUniqueViolation);

  const post = (payload) => {
    const raw = JSON.stringify(payload);
    const sig = `sha256=${crypto.createHmac('sha256', 'sec').update(raw).digest('hex')}`;
    return fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw });
  };
  const ig = (mid, text) => ({ object: 'instagram', entry: [{ id: 'IG', messaging: [{ sender: { id: '55' }, recipient: { id: 'IG' }, message: { mid, text } }] }] });

  await post(ig('a1', 'Hay un bache enorme en mi calle'));
  await post(ig('a1', 'Hay un bache enorme en mi calle')); // reintento de Meta
  await post(ig('a2', 'Calle Lira 450'));
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /folio es \*SCL-\d{4}-000001\*/);
  assert.match(sent[1].text, /San Borja/);

  const login = async (username, password) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    return async (path, opts = {}) => fetch(`${base}${path}`, {
      ...opts, headers: { cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  };
  const obras = await login('obras', 'obras-pass');
  const list = await (await obras('/api/tickets')).json();
  assert.equal(list.total, 1);
  const [ticket] = list.items;
  assert.equal(ticket.sector, 'san-borja');
  assert.ok(!Number.isNaN(Date.parse(ticket.created_at)), 'fecha en formato ISO');

  // Búsqueda sin distinguir mayúsculas, filtro por fecha y estadísticas numéricas.
  assert.equal((await (await obras('/api/tickets?q=BACHE')).json()).total, 1);
  assert.equal((await (await obras('/api/tickets?q=50%25')).json()).total, 0, '% se busca literal');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  assert.equal((await (await obras(`/api/tickets?from=${today}&to=${today}`)).json()).total, 1);
  assert.equal((await (await obras('/api/tickets?to=2000-01-01')).json()).total, 0);
  assert.deepEqual((await (await obras('/api/stats')).json()).byStatus, { nueva: 1 });

  // Cambio de estado (con aviso al vecino) e historial.
  const patch = await (await obras(`/api/tickets/${ticket.id}`, { method: 'PATCH', body: { status: 'resuelta' } })).json();
  assert.equal(patch.ticket.status, 'resuelta');
  assert.ok(patch.ticket.resolved_at);
  assert.match(sent.at(-1).text, /Resuelta/);
  const detail = await (await obras(`/api/tickets/${ticket.id}`)).json();
  assert.deepEqual(detail.messages.map((m) => m.direction), ['in', 'out', 'in', 'out', 'system', 'out']);

  // Una denuncia cerrada no recibe más mensajes: el siguiente abre otra.
  await post(ig('a3', 'Ahora hay basura acumulada en plaza Yungay'));
  assert.match(sent.at(-1).text, /SCL-\d{4}-000002/);

  // Administración de usuarios.
  const admin = await login('admin', 'admin-pass');
  assert.equal((await admin('/api/users', { method: 'POST', body: { username: 'obras', name: 'X', password: '12345678', department: 'obras' } })).status, 409);
  const users = await (await admin('/api/users')).json();
  const obrasUser = users.find((u) => u.username === 'obras');
  assert.equal((await admin(`/api/users/${obrasUser.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await obras('/api/tickets')).status, 401, 'la sesión del usuario eliminado deja de servir');
  const csv = await (await admin('/api/tickets.csv')).text();
  assert.match(csv, /SCL-\d{4}-000001/);
});
