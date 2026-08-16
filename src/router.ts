import { Hono } from 'hono';
import { adminApi } from './admin/api';
import { ADMIN_HTML } from './admin/ui';
import { buildDeps } from './deps';
import type { Env } from './env';
import { handleInbound } from './webhook/handle';
import { parseWebhook } from './webhook/parse';
import { handleVerify, verifySignature } from './webhook/verify';

export const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok'));

// Admin dashboard: the page carries no data; every API call needs ADMIN_KEY.
app.get('/admin', (c) => c.html(ADMIN_HTML));
app.route('/admin/api', adminApi);

app.get('/webhook', (c) => handleVerify(new URL(c.req.url), c.env.WA_VERIFY_TOKEN));

app.post('/webhook', async (c) => {
  const raw = await c.req.text();

  if (c.env.DEV_SKIP_SIGNATURE !== '1') {
    if (!c.env.WA_APP_SECRET) {
      console.error('WA_APP_SECRET secret is not set — rejecting all webhooks');
      return c.text('server not configured', 500);
    }
    const ok = await verifySignature(raw, c.req.header('x-hub-signature-256') ?? null, c.env.WA_APP_SECRET);
    if (!ok) return c.text('bad signature', 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.text('ok'); // malformed but signed — 200 so Meta doesn't retry-storm
  }
  const { messages } = parseWebhook(payload);
  if (messages.length > 0) {
    const env = c.env;
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const deps = await buildDeps(env);
          for (const m of messages) {
            try {
              await handleInbound(deps, m);
            } catch (e) {
              console.error('handleInbound failed', e);
            }
          }
        } catch (e) {
          console.error('webhook processing failed', e);
        }
      })(),
    );
  }
  return c.text('ok'); // always 200 fast — processing continues in waitUntil
});
