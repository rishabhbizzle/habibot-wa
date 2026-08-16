import type { ButtonSpec, SendResult, Sender } from './sender';

export interface GraphConfig {
  token: string;
  phoneId: string;
  version: string; // e.g. 'v23.0'
  templateLang: string; // must match the template's language in WhatsApp Manager ('en' vs 'en_US')
}

/** Real Meta Graph API sender. One retry on 429/5xx/network. */
export function graphSender(cfg: GraphConfig): Sender {
  const url = `https://graph.facebook.com/${cfg.version}/${cfg.phoneId}/messages`;

  async function post(payload: Record<string, unknown>): Promise<SendResult> {
    let lastErr = 'unreachable';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { messages?: { id: string }[] };
          return { ok: true, waMessageId: data.messages?.[0]?.id ?? null };
        }
        const body = await resp.text();
        lastErr = `HTTP ${resp.status}: ${body.slice(0, 300)}`;
        if (resp.status !== 429 && resp.status < 500) return { ok: false, error: lastErr };
      } catch (e) {
        lastErr = String(e);
      }
    }
    return { ok: false, error: lastErr };
  }

  return {
    text: (to, body) => post({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),

    buttons: (to, body, buttons: ButtonSpec[]) =>
      post({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })),
          },
        },
      }),

    template: (to, name, opts) => {
      const components: unknown[] = [];
      // hello_world takes no params; the custom morning_checkin template has a
      // {{1}} name in the body and one quick-reply button.
      if (name !== 'hello_world') {
        if (opts.name) components.push({ type: 'body', parameters: [{ type: 'text', text: opts.name }] });
        if (opts.buttonPayload) {
          components.push({
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: opts.buttonPayload }],
          });
        }
      }
      return post({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name,
          language: { code: name === 'hello_world' ? 'en_US' : cfg.templateLang },
          ...(components.length ? { components } : {}),
        },
      });
    },

    audio: (to, link, asVoice) =>
      post({
        messaging_product: 'whatsapp',
        to,
        type: 'audio',
        audio: asVoice ? { link, voice: true } : { link },
      }),
  };
}

export interface WrapOpts {
  dryRun: boolean;
  testMode: boolean;
  playerWaId: string | null;
  adminWaId: string | null;
}

/**
 * TEST_MODE: everything addressed to the player is rerouted to the admin with
 * a [to:gf] prefix — full real pipeline, zero spam to her.
 * DRY_RUN: skip the network entirely.
 */
export function wrapSender(inner: Sender, o: WrapOpts): Sender {
  const dry = (): Promise<SendResult> => Promise.resolve({ ok: true, waMessageId: null, skipped: 'dryrun' });
  const route = (to: string): string =>
    o.testMode && o.playerWaId && o.adminWaId && to === o.playerWaId ? o.adminWaId : to;
  const prefix = (to: string, body: string): string =>
    o.testMode && o.playerWaId && to === o.playerWaId ? `[to:gf] ${body}` : body;

  return {
    text: (to, body) => (o.dryRun ? dry() : inner.text(route(to), prefix(to, body))),
    buttons: (to, body, buttons) => (o.dryRun ? dry() : inner.buttons(route(to), prefix(to, body), buttons)),
    template: (to, name, opts) => (o.dryRun ? dry() : inner.template(route(to), name, opts)),
    audio: (to, link, asVoice) => (o.dryRun ? dry() : inner.audio(route(to), link, asVoice)),
  };
}
