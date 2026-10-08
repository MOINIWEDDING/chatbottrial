// Herramientas para conectar la cuenta de Instagram de la Municipalidad.
// Uso:
//   npm run instagram -- verificar     muestra la cuenta asociada al token
//   npm run instagram -- suscribir     suscribe la cuenta al webhook (mensajes y botones)
//   npm run instagram -- rompehielos   agrega los botones de inicio del chat
const config = require('../src/config');
const { instagramApi, graphBase } = require('../src/meta');

const meta = config.meta;
const token = meta.instagramAccessToken;
const api = instagramApi(meta);
const base = graphBase(meta, 'instagram');

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
}

const commands = {
  async verificar() {
    if (api === 'instagram') {
      const me = await call('GET', '/me?fields=user_id,username,name');
      console.log(`✓ Token válido para @${me.username} (${me.name ?? ''}) · ID ${me.user_id ?? me.id}`);
    } else {
      const me = await call('GET', '/me?fields=id,name,instagram_business_account{id,username}');
      const ig = me.instagram_business_account;
      console.log(`✓ Token de la página "${me.name}" (${me.id})`);
      console.log(ig ? `✓ Cuenta de Instagram vinculada: @${ig.username} (${ig.id})`
        : '✗ La página no tiene una cuenta profesional de Instagram vinculada.');
    }
  },
  async suscribir() {
    const fields = 'messages,messaging_postbacks';
    await call('POST', `/me/subscribed_apps?subscribed_fields=${fields}`);
    console.log(`✓ Cuenta suscrita a: ${fields}`);
    console.log(`  Verifique que el webhook de la app apunte a ${config.publicUrl || 'https://SU-DOMINIO'}/webhook`);
  },
  async rompehielos() {
    const iceBreakers = [{
      locale: 'default',
      call_to_actions: [
        { question: 'Quiero hacer una denuncia', payload: 'MENU' },
        { question: '¿Cómo va mi denuncia?', payload: 'ESTADO' },
      ],
    }];
    const path = api === 'instagram' ? '/me/messenger_profile' : '/me/messenger_profile?platform=instagram';
    await call('POST', path, { platform: 'instagram', ice_breakers: iceBreakers });
    console.log('✓ Botones de inicio configurados en el chat de Instagram');
  },
};

const cmd = process.argv[2];
if (!commands[cmd]) {
  console.log('Uso: npm run instagram -- verificar | suscribir | rompehielos');
  process.exit(1);
}
if (!token) {
  console.error('Falta INSTAGRAM_ACCESS_TOKEN (o FB_PAGE_ACCESS_TOKEN) en el archivo .env');
  process.exit(1);
}
console.log(`Usando la API ${api === 'instagram' ? 'de Instagram (graph.instagram.com)' : 'vía página de Facebook (graph.facebook.com)'}`);
commands[cmd]().catch((err) => {
  console.error(`✗ Meta respondió: ${err.message}`);
  process.exit(1);
});
