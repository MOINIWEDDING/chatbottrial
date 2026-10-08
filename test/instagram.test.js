const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseWebhook, createSender, createProfileFetcher, verifySignature } = require('../src/meta');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { createUser } = require('../src/auth');

const IG_ACCOUNT = '17841400000000000';
const igBody = (...events) => ({ object: 'instagram', entry: [{ id: IG_ACCOUNT, time: 1, messaging: events }] });
const dm = (mid, sender, text, extra = {}) => ({
  sender: { id: sender }, recipient: { id: IG_ACCOUNT }, timestamp: 1, message: { mid, text, ...extra },
});

test('Instagram: lee MD, ignora ecos y mensajes propios', () => {
  const msgs = parseWebhook(igBody(
    dm('m1', '111', 'Hay basura en la plaza'),
    dm('m2', IG_ACCOUNT, 'respuesta del bot'), // enviado por la cuenta municipal
    { sender: { id: IG_ACCOUNT }, recipient: { id: '111' }, message: { mid: 'm3', text: 'eco', is_echo: true } },
    dm('m4', '111', undefined, { is_deleted: true }),
    { sender: { id: '111' }, recipient: { id: IG_ACCOUNT }, read: { mid: 'm1' } },
  ));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].channel, 'instagram');
  assert.equal(msgs[0].contactId, '111');
  assert.equal(msgs[0].text, 'Hay basura en la plaza');
});

test('Instagram: formato "changes" (botón Probar de Meta)', () => {
  const msgs = parseWebhook({
    object: 'instagram',
    entry: [{ id: '0', time: 1, changes: [{ field: 'messages', value: dm('m1', '12334', 'random text') }] }],
  });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, 'random text');
});

test('Instagram: fotos, menciones en historias, respuestas a historias y botones', () => {
  const msgs = parseWebhook(igBody(
    dm('m1', '111', undefined, { attachments: [{ type: 'image', payload: { url: 'https://cdn/img.jpg' } }] }),
    dm('m2', '111', undefined, { attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/story' } }] }),
    dm('m3', '111', 'mira esto', { reply_to: { story: { url: 'https://cdn/s2', id: '9' } } }),
    { sender: { id: '111' }, recipient: { id: IG_ACCOUNT }, postback: { mid: 'm4', title: '¿Cómo va mi denuncia?', payload: 'ESTADO' } },
  ));
  assert.deepEqual(msgs[0].attachments, [{ type: 'image', url: 'https://cdn/img.jpg' }]);
  assert.deepEqual(msgs[1].attachments, [{ type: 'Mención en historia', url: 'https://cdn/story' }]);
  assert.deepEqual(msgs[2].attachments, [{ type: 'Respuesta a historia', url: 'https://cdn/s2' }]);
  assert.equal(msgs[3].text, 'ESTADO');
  assert.equal(msgs[3].postback, true);
});

test('Instagram: envía por graph.instagram.com con token IGAA y por graph.facebook.com con token de página', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({}) }; };
  await createSender({ graphVersion: 'v21.0', instagramAccessToken: 'IGAAxyz' }, { fetchImpl })(
    { channel: 'instagram', contactId: '111' }, 'x'.repeat(1500));
  await createSender({ graphVersion: 'v21.0', instagramAccessToken: 'EAApage' }, { fetchImpl })(
    { channel: 'instagram', contactId: '111' }, 'hola');
  assert.equal(calls[0].url, 'https://graph.instagram.com/v21.0/me/messages');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer IGAAxyz');
  const payload = JSON.parse(calls[0].opts.body);
  assert.deepEqual(payload.recipient, { id: '111' });
  assert.equal(payload.message.text.length, 1000, 'Instagram acepta hasta 1000 caracteres');
  assert.equal(calls[1].url, 'https://graph.facebook.com/v21.0/me/messages');
});

test('Instagram: obtiene el @usuario de quien escribe', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://graph.instagram.com/v21.0/111?fields=name,username');
    return { ok: true, json: async () => ({ name: 'Ana Pérez', username: 'anaperez' }) };
  };
  const fetchProfile = createProfileFetcher({ graphVersion: 'v21.0', instagramAccessToken: 'IGAAxyz' }, { fetchImpl });
  assert.equal(await fetchProfile({ channel: 'instagram', contactId: '111' }), 'Ana Pérez (@anaperez)');
  const failing = createProfileFetcher({ graphVersion: 'v21.0', instagramAccessToken: 'IGAAxyz' }, { fetchImpl: async () => ({ ok: false }) });
  assert.equal(await failing({ channel: 'instagram', contactId: '111' }), null);
});

test('acepta firmas hechas con la clave de la app de Meta o la de Instagram', () => {
  const raw = Buffer.from('{}');
  const sign = (k) => `sha256=${crypto.createHmac('sha256', k).update(raw).digest('hex')}`;
  assert.ok(verifySignature(raw, sign('ig-secret'), ['meta-secret', 'ig-secret']));
  assert.ok(verifySignature(raw, sign('meta-secret'), ['meta-secret', '']));
  assert.ok(!verifySignature(raw, sign('otra'), ['meta-secret', 'ig-secret']));
});

test('flujo Instagram: MD → respuesta automática → denuncia en el panel del equipo', async (t) => {
  const db = openDatabase(':memory:');
  const sent = [];
  const send = async (target, text) => { sent.push({ ...target, text }); };
  const fetchProfile = async ({ channel }) => (channel === 'instagram' ? 'Ana Pérez (@anaperez)' : null);
  const config = {
    publicUrl: '', enableSimulator: true, conversationWindowMinutes: 30, sessionDays: 1,
    meta: { verifyToken: 'v', appSecret: 'meta-secret', instagramAppSecret: 'ig-secret' },
  };
  const { app } = createApp({ db, send, fetchProfile, config, logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  createUser(db, { username: 'parques', name: 'Parques', password: 'parques-pass', department: 'parques' });

  const post = (payload) => {
    const raw = JSON.stringify(payload);
    const sig = `sha256=${crypto.createHmac('sha256', 'ig-secret').update(raw).digest('hex')}`;
    return fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw });
  };
  const waitFor = async (fn) => {
    for (let i = 0; i < 100; i += 1) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error('timeout');
  };

  // Botón de inicio → menú de bienvenida, sin crear denuncia.
  await post(igBody({ sender: { id: '111' }, recipient: { id: IG_ACCOUNT }, postback: { mid: 'p1', title: 'Quiero hacer una denuncia', payload: 'MENU' } }));
  await waitFor(() => sent.length === 1);
  assert.match(sent[0].text, /Cuéntanos/);

  assert.equal((await post(igBody(dm('m1', '111', 'Los juegos infantiles de la plaza Yungay están rotos')))).status, 200);
  await waitFor(() => sent.length === 2);
  assert.equal(sent[1].channel, 'instagram');
  assert.equal(sent[1].contactId, '111');
  assert.match(sent[1].text, /folio es \*SCL-\d{4}-000001\*/);
  assert.match(sent[1].text, /Plazas y Parques/);

  await post(igBody(dm('m2', '111', undefined, { attachments: [{ type: 'image', payload: { url: 'https://cdn/foto.jpg' } }] })));
  await waitFor(() => sent.length === 3);
  assert.match(sent[2].text, /Agregamos/);

  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"parques","password":"parques-pass"}' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const list = await (await fetch(`${base}/api/tickets?channel=instagram`, { headers: { cookie } })).json();
  assert.equal(list.total, 1);
  const [ticket] = list.items;
  assert.equal(ticket.contact_name, 'Ana Pérez (@anaperez)');
  assert.equal(ticket.sector, 'yungay');
  const detail = await (await fetch(`${base}/api/tickets/${ticket.id}`, { headers: { cookie } })).json();
  assert.deepEqual(detail.messages.find((m) => m.external_id === 'm2').attachments, [{ type: 'image', url: 'https://cdn/foto.jpg' }]);
});
