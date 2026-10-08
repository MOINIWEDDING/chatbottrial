// Integración con la plataforma de Meta: WhatsApp Cloud API, Messenger e Instagram.
const crypto = require('node:crypto');

/** Verifica la firma X-Hub-Signature-256 que Meta envía en cada webhook. */
function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true; // sin secreto configurado (desarrollo) no se valida
  if (!rawBody || !signatureHeader?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Convierte el cuerpo de un webhook de Meta en una lista de mensajes normalizados:
 * { channel, contactId, contactName, externalId, text, attachments[], location, replyTo }
 */
function parseWebhook(body) {
  const out = [];
  if (!body || !Array.isArray(body.entry)) return out;

  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const names = Object.fromEntries((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
        for (const m of value.messages ?? []) {
          const msg = {
            channel: 'whatsapp',
            contactId: m.from,
            contactName: names[m.from] ?? null,
            externalId: m.id,
            text: '',
            attachments: [],
            location: null,
            replyTo: { phoneNumberId: value.metadata?.phone_number_id },
          };
          switch (m.type) {
            case 'text': msg.text = m.text?.body ?? ''; break;
            case 'image': case 'video': case 'audio': case 'document': case 'sticker':
              msg.text = m[m.type]?.caption ?? '';
              msg.attachments.push({ type: m.type, mediaId: m[m.type]?.id });
              break;
            case 'location':
              msg.location = {
                latitude: m.location?.latitude, longitude: m.location?.longitude,
                address: [m.location?.name, m.location?.address].filter(Boolean).join(', ') || null,
              };
              break;
            case 'button': msg.text = m.button?.text ?? ''; break;
            case 'interactive':
              msg.text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
              break;
            default: continue; // reacciones, mensajes del sistema, etc.
          }
          out.push(msg);
        }
      }
    }
    return out;
  }

  if (body.object === 'page' || body.object === 'instagram') {
    const channel = body.object === 'page' ? 'messenger' : 'instagram';
    for (const entry of body.entry) {
      for (const ev of entry.messaging ?? []) {
        const m = ev.message;
        if (!m || m.is_echo || !ev.sender?.id) continue;
        const msg = {
          channel,
          contactId: ev.sender.id,
          contactName: null,
          externalId: m.mid,
          text: m.text ?? '',
          attachments: [],
          location: null,
          replyTo: {},
        };
        for (const a of m.attachments ?? []) {
          if (a.type === 'location' && a.payload?.coordinates) {
            msg.location = { latitude: a.payload.coordinates.lat, longitude: a.payload.coordinates.long, address: a.title ?? null };
          } else {
            msg.attachments.push({ type: a.type, url: a.payload?.url });
          }
        }
        out.push(msg);
      }
    }
  }
  return out;
}

/** Crea el cliente que envía respuestas por cada canal. */
function createSender(metaConfig, { fetchImpl = globalThis.fetch, logger = console } = {}) {
  const base = `https://graph.facebook.com/${metaConfig.graphVersion}`;

  async function post(url, token, payload) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Meta respondió ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json().catch(() => ({}));
  }

  /** Envía un texto al vecino. Lanza error si Meta lo rechaza. */
  return async function send({ channel, contactId, replyTo = {} }, text) {
    if (channel === 'simulador') return { simulated: true };
    if (channel === 'whatsapp') {
      if (!metaConfig.whatsappToken || !replyTo.phoneNumberId) {
        logger.info(`[sin credenciales] WhatsApp → ${contactId}: ${text}`);
        return { dryRun: true };
      }
      return post(`${base}/${replyTo.phoneNumberId}/messages`, metaConfig.whatsappToken, {
        messaging_product: 'whatsapp', to: contactId, type: 'text', text: { body: text },
      });
    }
    const token = channel === 'instagram' ? metaConfig.instagramAccessToken : metaConfig.pageAccessToken;
    if (!token) {
      logger.info(`[sin credenciales] ${channel} → ${contactId}: ${text}`);
      return { dryRun: true };
    }
    return post(`${base}/me/messages`, token, {
      recipient: { id: contactId }, messaging_type: 'RESPONSE', message: { text },
    });
  };
}

module.exports = { verifySignature, parseWebhook, createSender };
