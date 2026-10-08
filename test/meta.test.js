const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseWebhook, verifySignature, createSender } = require('../src/meta');

test('interpreta mensajes de WhatsApp (texto, imagen y ubicación)', () => {
  const msgs = parseWebhook({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'PNID' },
      contacts: [{ wa_id: '56911111111', profile: { name: 'Ana' } }],
      messages: [
        { from: '56911111111', id: 'wamid.1', type: 'text', text: { body: 'bache en Lira' } },
        { from: '56911111111', id: 'wamid.2', type: 'image', image: { id: 'MEDIA', caption: 'foto' } },
        { from: '56911111111', id: 'wamid.3', type: 'location', location: { latitude: -33.4, longitude: -70.6, address: 'Lira 450' } },
        { from: '56911111111', id: 'wamid.4', type: 'reaction', reaction: {} },
      ],
    } }] }],
  });
  assert.equal(msgs.length, 3);
  assert.deepEqual(msgs[0], {
    channel: 'whatsapp', contactId: '56911111111', contactName: 'Ana', externalId: 'wamid.1', text: 'bache en Lira',
    attachments: [], location: null, replyTo: { phoneNumberId: 'PNID' },
  });
  assert.deepEqual(msgs[1].attachments, [{ type: 'image', mediaId: 'MEDIA' }]);
  assert.equal(msgs[2].location.address, 'Lira 450');
});

test('interpreta mensajes de Messenger e Instagram e ignora ecos', () => {
  const body = (object) => ({
    object,
    entry: [{ messaging: [
      { sender: { id: 'PSID' }, message: { mid: 'm1', text: 'hola', attachments: [{ type: 'image', payload: { url: 'https://x/img.jpg' } }] } },
      { sender: { id: 'PAGE' }, message: { mid: 'm2', text: 'eco', is_echo: true } },
      { sender: { id: 'PSID' }, read: { watermark: 1 } },
    ] }],
  });
  const fb = parseWebhook(body('page'));
  assert.equal(fb.length, 1);
  assert.equal(fb[0].channel, 'messenger');
  assert.deepEqual(fb[0].attachments, [{ type: 'image', url: 'https://x/img.jpg' }]);
  assert.equal(parseWebhook(body('instagram'))[0].channel, 'instagram');
});

test('verifica la firma del webhook', () => {
  const raw = Buffer.from('{"a":1}');
  const sig = `sha256=${crypto.createHmac('sha256', 'secreto').update(raw).digest('hex')}`;
  assert.ok(verifySignature(raw, sig, 'secreto'));
  assert.ok(!verifySignature(raw, sig, 'otro'));
  assert.ok(!verifySignature(raw, undefined, 'secreto'));
  assert.ok(!verifySignature(raw, 'sha256=abc', 'secreto'));
});

test('envía por la API correcta según el canal', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({}) }; };
  const send = createSender({ graphVersion: 'v21.0', whatsappToken: 'WA', pageAccessToken: 'PG', instagramAccessToken: 'IG' }, { fetchImpl });
  await send({ channel: 'whatsapp', contactId: '569', replyTo: { phoneNumberId: 'PNID' } }, 'hola');
  await send({ channel: 'messenger', contactId: 'PSID' }, 'hola');
  await send({ channel: 'instagram', contactId: 'IGSID' }, 'hola');
  assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/PNID/messages');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer WA');
  assert.equal(JSON.parse(calls[0].opts.body).to, '569');
  assert.equal(calls[1].url, 'https://graph.facebook.com/v21.0/me/messages');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer PG');
  assert.equal(calls[2].opts.headers.Authorization, 'Bearer IG');
});

test('sin credenciales no llama a Meta', async () => {
  let called = false;
  const send = createSender({ graphVersion: 'v21.0' }, { fetchImpl: async () => { called = true; }, logger: { info() {} } });
  assert.deepEqual(await send({ channel: 'messenger', contactId: 'x' }, 'hola'), { dryRun: true });
  assert.ok(!called);
});
