// Prueba la función de Vercel (api/index.js) en un proceso aparte, con las variables
// de entorno que entrega Vercel.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { configErrors } = require('../src/runtime');
const { startPostgres } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// Levanta api/index.js con un servidor http y ejecuta solicitudes de prueba.
const SCRIPT = `
const http = require('node:http');
const handler = require('./api/index.js');
const server = http.createServer(handler).listen(0, async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const out = {};
  const health = await fetch(base + '/health');
  out.health = { status: health.status, body: await health.json() };
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'clave-admin-123' }) });
  out.login = { status: login.status, cookie: login.headers.get('set-cookie') };
  const verify = await fetch(base + '/webhook?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=42');
  out.verify = await verify.text();
  console.log(JSON.stringify(out));
  server.close();
});`;

function run(env) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', SCRIPT], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, VERCEL: '1', META_VERIFY_TOKEN: 'tok', ADMIN_PASSWORD: 'clave-admin-123', ...env },
    }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(JSON.parse(stdout.trim().split('\n').pop()))));
  });
}

test('Vercel: la función atiende la API, el login y el webhook (con Postgres)', async (t) => {
  const pg = await startPostgres();
  t.after(() => pg.stop());
  const out = await run({ DATABASE_URL: pg.url, META_APP_SECRET: 's' });
  assert.deepEqual(out.health, { status: 200, body: { ok: true } });
  assert.equal(out.login.status, 200, 'crea el admin con ADMIN_PASSWORD en el primer uso');
  assert.match(out.login.cookie, /HttpOnly/);
  assert.equal(out.verify, '42');
});

test('Vercel: sin DATABASE_URL responde un error claro en vez de perder datos', async () => {
  const out = await run({});
  assert.equal(out.health.status, 500);
  assert.match(out.health.body.error, /DATABASE_URL/);
});

test('revisión de configuración', () => {
  const base = { isVercel: false, isProduction: false, database: { url: 'data/pglite' }, meta: {} };
  assert.deepEqual(configErrors(base), []);
  assert.match(configErrors({ ...base, isVercel: true }).join(), /DATABASE_URL/);
  assert.match(configErrors({ ...base, isProduction: true }).join(), /META_APP_SECRET/);
  assert.deepEqual(configErrors({ ...base, isVercel: true, isProduction: true,
    database: { url: 'postgresql://postgres.abc:pw@aws-0-sa-east-1.pooler.supabase.com:6543/postgres' }, meta: { appSecret: 's' } }), []);
});

// Reproduce lo que hace el runtime de Vercel ("helpers"): lee el cuerpo completo antes
// de llamar a la función, deja la solicitud como terminada, permite volver a leerla con
// los eventos data/end y define req.body con un getter que parsea el JSON.
function withVercelHelpers(handler) {
  const { PassThrough } = require('node:stream');
  return async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const replay = new PassThrough();
    const on = replay.on.bind(replay);
    const originalOn = req.on.bind(req);
    req.read = replay.read.bind(replay);
    req.on = req.addListener = (name, cb) => (name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb));
    replay.end(body);
    let parsed;
    Object.defineProperty(req, 'body', {
      configurable: true,
      get: () => (parsed ??= body.length ? JSON.parse(body) : undefined),
      set: (v) => { parsed = v; },
    });
    return handler(req, res);
  };
}

test('Vercel: el webhook verifica la firma aunque el runtime ya haya leído el cuerpo', async (t) => {
  const http = require('node:http');
  const crypto = require('node:crypto');
  const { openDatabase } = require('../src/db');
  const { createApp } = require('../src/app');
  const { createUser } = require('../src/auth');
  const db = await openDatabase({ url: ':memory:' });
  const sent = [];
  const { app } = createApp({
    db, send: async (target, text) => { sent.push({ ...target, text }); },
    config: { publicUrl: '', enableSimulator: true, conversationWindowMinutes: 30, sessionDays: 1, meta: { verifyToken: 'v', appSecret: 'sec' } },
    logger: { info() {}, warn() {}, error() {} },
  });
  await createUser(db, { username: 'admin', name: 'A', password: 'admin-pass', role: 'admin' });
  const server = http.createServer(withVercelHelpers(app));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: 'IG', messaging: [
    { sender: { id: '9' }, recipient: { id: 'IG' }, message: { mid: 'x1', text: 'bache en calle Lira 450' } }] }] });
  const sign = (k) => `sha256=${crypto.createHmac('sha256', k).update(raw).digest('hex')}`;
  const post = (sig) => fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw });

  assert.equal((await post(sign('otra'))).status, 401);
  assert.equal((await post(sign('sec'))).status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Obras Públicas/);

  // El resto de la API (JSON) también funciona con los helpers.
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"admin","password":"admin-pass"}' });
  assert.equal(login.status, 200);
});
