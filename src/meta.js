// Integración con la plataforma de Meta: WhatsApp Cloud API, Messenger e Instagram.
const crypto = require('node:crypto');

/**
 * Verifica la firma X-Hub-Signature-256 que Meta envía en cada webhook. Acepta uno o
 * varios secretos: con "inicio de sesión de Instagram" los webhooks de Instagram se
 * firman con la clave secreta de la app de Instagram, distinta de la de Meta.
 */
function verifySignature(rawBody, signatureHeader, secrets) {
  const list = [secrets].flat().filter(Boolean);
  if (!list.length) return true; // sin secreto configurado (desarrollo) no se valida
  if (!rawBody || !signatureHeader?.startsWith('sha256=')) return false;
  const received = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  return list.some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  });
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
      // Instagram entrega los eventos en entry.messaging; el botón "Probar" del panel
      // de Meta (y algunas suscripciones) los envía como entry.changes[field=messages].
      const events = [
        ...(entry.messaging ?? []),
        ...(entry.changes ?? []).filter((c) => c.field === 'messages' && c.value).map((c) => c.value),
      ];
      for (const ev of events) {
        const msg = parseMessagingEvent(ev, channel, entry.id);
        if (msg) out.push(msg);
      }
    }
  }
  return out;
}

const ATTACHMENT_LABELS = {
  story_mention: 'Mención en historia', share: 'Publicación compartida', ig_reel: 'Reel', reel: 'Reel',
};

/** Convierte un evento de Messenger / Instagram en un mensaje normalizado (o null si se ignora). */
function parseMessagingEvent(ev, channel, accountId) {
  const senderId = ev.sender?.id;
  // Se ignoran los mensajes que envía la propia cuenta municipal (ecos).
  if (!senderId || (accountId && String(senderId) === String(accountId))) return null;
  const base = { channel, contactId: String(senderId), contactName: null, attachments: [], location: null, replyTo: {} };

  // Botones de inicio ("rompehielos") y menús: se tratan como texto.
  if (ev.postback) {
    return { ...base, externalId: ev.postback.mid ?? null, postback: true, text: ev.postback.payload || ev.postback.title || '' };
  }

  const m = ev.message;
  if (!m || m.is_echo || m.is_deleted) return null;
  const msg = { ...base, externalId: m.mid, text: m.quick_reply?.payload && !m.text ? m.quick_reply.payload : (m.text ?? '') };
  for (const a of m.attachments ?? []) {
    if (a.type === 'location' && a.payload?.coordinates) {
      msg.location = { latitude: a.payload.coordinates.lat, longitude: a.payload.coordinates.long, address: a.title ?? null };
    } else {
      msg.attachments.push({ type: ATTACHMENT_LABELS[a.type] ?? a.type, url: a.payload?.url });
    }
  }
  if (m.reply_to?.story?.url) msg.attachments.push({ type: 'Respuesta a historia', url: m.reply_to.story.url });
  if (m.is_unsupported && !msg.text && !msg.attachments.length) msg.attachments.push({ type: 'contenido no soportado' });
  if (!msg.text && !msg.attachments.length && !msg.location) return null;
  return msg;
}

/**
 * Instagram admite dos formas de conexión:
 *  - "instagram": API de Instagram con inicio de sesión de Instagram (token IGAA…, graph.instagram.com).
 *  - "facebook":  API de Instagram vía página de Facebook (token de página, graph.facebook.com).
 */
function instagramApi(metaConfig) {
  if (metaConfig.instagramApi === 'instagram' || metaConfig.instagramApi === 'facebook') return metaConfig.instagramApi;
  return /^IG/.test(metaConfig.instagramAccessToken ?? '') ? 'instagram' : 'facebook';
}

function graphBase(metaConfig, channel) {
  const host = channel === 'instagram' && instagramApi(metaConfig) === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  return `https://${host}/${metaConfig.graphVersion}`;
}

/** Crea el cliente que envía respuestas por cada canal. */
function createSender(metaConfig, { fetchImpl = globalThis.fetch, logger = console } = {}) {
  const waBase = `https://graph.facebook.com/${metaConfig.graphVersion}`;

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
      return post(`${waBase}/${replyTo.phoneNumberId}/messages`, metaConfig.whatsappToken, {
        messaging_product: 'whatsapp', to: contactId, type: 'text', text: { body: text },
      });
    }
    const token = channel === 'instagram' ? metaConfig.instagramAccessToken : metaConfig.pageAccessToken;
    if (!token) {
      logger.info(`[sin credenciales] ${channel} → ${contactId}: ${text}`);
      return { dryRun: true };
    }
    // Messenger e Instagram limitan el largo de cada mensaje (1000 caracteres en Instagram).
    return post(`${graphBase(metaConfig, channel)}/me/messages`, token, {
      recipient: { id: contactId }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 1000) },
    });
  };
}

/**
 * Obtiene el nombre / @usuario de quien escribe por Messenger o Instagram, para
 * mostrarlo en el panel. Si falla (permisos, usuario sin perfil) devuelve null.
 */
function createProfileFetcher(metaConfig, { fetchImpl = globalThis.fetch } = {}) {
  return async function fetchProfile({ channel, contactId }) {
    const token = channel === 'instagram' ? metaConfig.instagramAccessToken
      : channel === 'messenger' ? metaConfig.pageAccessToken : null;
    if (!token) return null;
    const fields = channel === 'instagram' ? 'name,username' : 'first_name,last_name';
    try {
      const res = await fetchImpl(`${graphBase(metaConfig, channel)}/${encodeURIComponent(contactId)}?fields=${fields}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const p = await res.json();
      if (channel === 'instagram') {
        if (p.name && p.username) return `${p.name} (@${p.username})`;
        return p.username ? `@${p.username}` : (p.name || null);
      }
      return [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
    } catch {
      return null;
    }
  };
}

module.exports = { verifySignature, parseWebhook, createSender, createProfileFetcher, instagramApi, graphBase };
