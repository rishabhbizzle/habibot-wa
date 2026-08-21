# habitbot 💧💊

A WhatsApp habit companion for your girlfriend: paced water reminders, alternate-day multivitamins, streaks, points, **real-life reward coupons**, Duolingo-style escalating drama, a Sunday report card — with a personality *she* picks on day 1 (sassy / sweet / virtual pet, English / Hinglish), a soft mode for rough days, and heavy anti-nag machinery so she never wants to mute it.

```
Meta Cloud API ── POST /webhook ──> Worker ──> intent ──> game engine ──> in-persona reply
Cron */15 ──> snapshot ──> decide() ──> compose (Claude) ──> send        (canned fallback if LLM down)
                       Cloudflare D1 (SQLite)
```

- **Deterministic core, LLM at the edges.** A pure `decide()` owns all scheduling; Claude only *phrases* messages and *classifies* her texts. Reminders never silently drop.
- **Free hosting**: Cloudflare Workers + Cron Triggers + D1 (no card needed). **Free messaging**: Meta's dev *test number* (up to 5 recipients — you two).
- Runs at `$0/mo` + LLM cost (`claude-opus-5` ≈ $10–15/mo for the best wit, or set `LLM_MODEL=claude-haiku-4-5` ≈ $2–3/mo).

Everything below is the one-time setup, in order. **Steps you must do in a browser are marked 🖐️.**

---

## 0. Prerequisites

- Node 20+, `npm install` in this repo.
- A Cloudflare account (free) — `npx wrangler login`.
- A Meta (Facebook) account for [developers.facebook.com](https://developers.facebook.com).
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com) (prepaid credits).
- Both phone numbers (yours + hers) with WhatsApp installed.

## 1. Meta app + test number 🖐️

1. [developers.facebook.com](https://developers.facebook.com) → **Create App** → type **Business** → add the **WhatsApp** product. This auto-creates a **test WhatsApp Business Account with a free test phone number**.
2. **WhatsApp → API Setup**: note the **Phone number ID** (→ secret `WA_PHONE_ID`).
3. In the **To** dropdown → **Manage phone number list** → add BOTH your number and hers (international format). Each phone receives a **verification code in WhatsApp** — enter it. (Tell her it's a surprise 🙂 or just add yours first and hers at go-live.)
4. **⚠️ The token shown on this page dies after ~23 hours.** Mint a permanent one:
   - [business.facebook.com](https://business.facebook.com) → Settings → **Users → System users** → Add (name: `habitbot`, role: Admin).
   - **Add assets** → your app → full control.
   - **Generate new token** → select your app → tick permissions `whatsapp_business_messaging` + `whatsapp_business_management` → expiry **Never** → copy (→ secret `WA_TOKEN`).
5. App Dashboard → **App settings → Basic** → copy **App secret** (→ secret `WA_APP_SECRET`).
6. Invent a random string for the webhook handshake (→ secret `WA_VERIFY_TOKEN`).
7. **Submit the reminder template now** (approval: minutes to ~48h — longest lead time in this whole setup): WhatsApp → **Manage templates** (WhatsApp Manager) → Create:
   - Name: `morning_checkin` · **Category: UTILITY** (⚠️ not Marketing — avoids India's marketing pacing) · Language: English
   - Body: `Good morning {{1}}! Your habit buddy is up — ready for today? 💪`  (sample value: `Priya`)
   - Buttons → Quick reply: `I'm up!`
   - Until it's approved the bot uses the pre-approved `hello_world` (already set in `wrangler.toml`); after approval set `TEMPLATE_NAME = "morning_checkin"` and redeploy.

## 2. Cloudflare 🖐️ + deploy

```sh
npx wrangler login
npx wrangler d1 create habitbot          # copy database_id into wrangler.toml
npm run db:migrate:remote

# EDIT seed/seed.sql first: put both real numbers (digits only, e.g. 9198xxxxxxx)
npm run db:seed:remote

npx wrangler secret put WA_TOKEN
npx wrangler secret put WA_PHONE_ID
npx wrangler secret put WA_APP_SECRET
npx wrangler secret put WA_VERIFY_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY

npm run deploy                            # note the URL: https://habitbot.<acct>.workers.dev
```

Then set `PUBLIC_BASE_URL = "https://habitbot.<acct>.workers.dev"` in `wrangler.toml` and `npm run deploy` again (it's used for voice-note links).

**Wire the webhook** 🖐️: App Dashboard → WhatsApp → **Configuration** → Edit webhook →
Callback URL `https://habitbot.<acct>.workers.dev/webhook`, Verify token = your `WA_VERIFY_TOKEN` → Verify and save → under **Webhook fields**, subscribe to **messages**.

## 3. Test drive (safe: `TEST_MODE = "1"`)

While `TEST_MODE=1`, **every message meant for her is rerouted to YOUR WhatsApp** with a `[to:gf]` prefix — full real pipeline, zero spam to her.

From your WhatsApp, text the test number:

```
/help            ← command list
/status          ← her day at a glance
/test water      ← sample persona message (checks the Claude key works)
/test escalate   ← level-3 drama preview
/test report     ← Sunday report card preview
/tick            ← force a scheduler tick right now
```

Then live a fake "her day" yourself: `/onboard`, pick a persona, tap the buttons, text `2`, `done`, `snooze`, `rough day`, `redeem`. Let a morning pass without replying >24h to see the template path.

Local dev without touching Meta: `cp .dev.vars.example .dev.vars`, `npm run db:migrate:local && npm run db:seed:local`, `npx wrangler dev`, then curl a fixture at `localhost:8787/webhook` (with `DEV_SKIP_SIGNATURE=1`), and trigger crons via `npx wrangler dev --test-scheduled` + `curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"`.

### Switching the player (trial number → her real number)

If you dogfooded on a spare number first, hand over cleanly (replace the number):

```sh
npx wrangler d1 execute habitbot --remote --command "
  DELETE FROM habit_logs; DELETE FROM nudges; DELETE FROM messages;
  DELETE FROM points_ledger; DELETE FROM reminders; DELETE FROM snoozes; DELETE FROM challenges;
  UPDATE coupons SET status='stocked', earned_at=NULL, earned_for=NULL, announced=0, redeemed_at=NULL WHERE status='earned';
  UPDATE streaks SET current=0, best=0, last_counted_day=NULL;
  UPDATE users SET wa_id='HER_NUMBER', persona=NULL, convo_state=NULL, last_inbound_at=NULL,
    soft_until=NULL, paused_until=NULL WHERE id='gf';
  UPDATE system_state SET value='' WHERE key='last_rollover_day';"
```

Her number must already be a **code-verified test recipient** in Meta's dashboard. Keep your `/note`s — the about-her memory survives the wipe on purpose (it's about her, not the trial).

## 4. Go live 🚀

1. Template approved → `TEMPLATE_NAME = "morning_checkin"` in `wrangler.toml`.
2. Her number added + verified as a test recipient (step 1.3).
3. (Optional but devastatingly effective) record 2–3 voice notes, convert, drop into `public/media/`, attach to coupons:
   ```sh
   ffmpeg -i proud_of_you.m4a -c:a libopus -ac 1 note1.ogg   # OGG-Opus mono = real voice-note bubble
   mv note1.ogg public/media/ && npm run deploy
   # then over WhatsApp: /coupon add "1x back massage" trigger=streak:7 media=note1.ogg
   ```
4. Flip `TEST_MODE = "0"` → `npm run deploy`.
5. Text `/onboard` — she gets the intro and picks her bot's personality. Done.

## Day-2 operations (all over WhatsApp, from your number)

`/status` · `/soft on|off` · `/pause 4h` · `/resume` · `/log water 2` · `/habit list|pause|resume` · `/coupon add "..." trigger=streak:7|perfect_week:7|any [media=x.ogg]` · `/coupon list` · `/gift "..." | note` (unlock a reward instantly, no milestone needed) · `/gift 7 | note` (gift a stocked one early) · `/recount` · `/export` · `/tick` · `/test …`

She can text the bot naturally: `done`, `ho gaya`, `2`, `had 2 glasses`, `snooze`, `skip`, `status`, `redeem`, `be nicer`, `roast me`, `not today please` (instant soft mode) — buttons always work even if the LLM is down.

**Her own reminders:** `remind me to call mom at 5`, `kal subah remind me about the parcel` → confirmed, then fired at the next 15-min tick after the time (her reminders bypass soft mode, pause, and message caps). `reminders` lists them; `cancel reminder 3` cancels. **Weather mornings:** the morning brief opens with today's forecast (Open-Meteo, free) and suggests bonus glasses on 33°C+ days — set her city via `WEATHER_LAT`/`WEATHER_LON` in `wrangler.toml` (default: New Delhi; empty = feature off).

## How it stays un-annoying (by design)

On-pace suppression (ahead of schedule ⇒ silence) · 1-glass tolerance · ≥60 min between nudges per habit · per-habit daily caps · escalation maxes at level 3 then goes silent on that habit for the day · hard quiet hours (her chosen window) · soft mode (auto-expires next morning) · global cap 10 proactive messages/day (2 in soft mode) · replies to her never count against caps. Preview any day's message load: `npm run simulate` (also `simulate ignores` / `simulate perfect`).

## Costs & gotchas

- **Test number**: free, no payment method exists to bill. Templates made on the test WABA don't port to a future real number. Unverified reports suggest test numbers may need a dashboard re-activation after ~90 days of disuse — daily traffic makes this moot, but if sends ever 4xx, check API Setup in the dashboard.
- **24h window**: any message/button-tap from her re-opens it for 24h; the bot only needs the template when she's been silent >24h (max 1/day).
- **If you outgrow the sandbox**: a real number on an unverified Meta Business portfolio allows 250 business-initiated convos/day (125× this bot's needs); from Oct 1 2026 Meta bills in-window messages ~₹0.14 each ⇒ roughly ₹100–200/mo at this volume.
- **Claude spend**: ~30–60 short calls/day. `claude-opus-5` ≈ $10–15/mo, `claude-haiku-4-5` ≈ $2–3/mo (`LLM_MODEL` in wrangler.toml). If the key dies, canned fallbacks keep every reminder flowing.

## Development

```sh
npm test              # 68 tests: engine, golden-day decisions, webhook, e2e vs in-memory sqlite
npm run simulate      # full simulated day, printed as a message timeline
npm run typecheck
```

Layout: `src/engine` + `src/scheduler/decisions.ts` are pure (no I/O — this is where behavior lives); `src/composer` turns decision briefs into persona text (Claude, with canned fallbacks); `src/flows` = onboarding/logging/redeem/admin/report; `src/wa` + `src/webhook` = Graph API + webhook plumbing; `test/helpers/sqlite.ts` runs the identical SQL on better-sqlite3.

v2 ideas the schema already supports: couple mode (you as second player), photo proof logging, natural-language one-off reminders, mood check-ins.
