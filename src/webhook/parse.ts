export interface InboundMessage {
  waId: string;
  wamid: string;
  kind: 'text' | 'button' | 'audio' | 'image' | 'other';
  text?: string;
  buttonId?: string;
  buttonTitle?: string;
  profileName?: string;
}

interface MetaMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  button?: { payload?: string; text?: string };
  audio?: { id?: string };
  image?: { id?: string; caption?: string };
}

interface MetaValue {
  messages?: MetaMessage[];
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  statuses?: unknown[];
}

/**
 * Meta webhook envelope -> inbound messages. Delivery/read statuses are
 * deliberately ignored (they must never bump last_inbound_at).
 */
export function parseWebhook(payload: unknown): { messages: InboundMessage[] } {
  const messages: InboundMessage[] = [];
  const p = payload as { object?: string; entry?: { changes?: { field?: string; value?: MetaValue }[] }[] };
  if (!p || p.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return { messages };

  for (const entry of p.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value ?? {};
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const m of value.messages ?? []) {
        if (!m.from || !m.id) continue;
        const base = { waId: m.from, wamid: m.id, profileName };
        switch (m.type) {
          case 'text':
            messages.push({ ...base, kind: 'text', text: m.text?.body ?? '' });
            break;
          case 'interactive': {
            const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
            messages.push({ ...base, kind: 'button', buttonId: r?.id ?? '', buttonTitle: r?.title });
            break;
          }
          case 'button': // template quick-reply tap
            messages.push({ ...base, kind: 'button', buttonId: m.button?.payload ?? m.button?.text ?? '', buttonTitle: m.button?.text });
            break;
          case 'audio':
            messages.push({ ...base, kind: 'audio' });
            break;
          case 'image':
            messages.push({ ...base, kind: 'image', text: m.image?.caption });
            break;
          default:
            messages.push({ ...base, kind: 'other' });
        }
      }
    }
  }
  return { messages };
}
