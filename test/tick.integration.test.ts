import { describe, expect, it } from 'vitest';
import type { Nudge, Streak } from '../src/core/types';
import { runTick, type TickDeps } from '../src/scheduler/tick';
import { handleInbound } from '../src/webhook/handle';
import { fakeClock, fakeSender, istMs } from './helpers/fakes';
import { memoryDb, seedBasics } from './helpers/sqlite';

const DAY = '2026-08-21';

function setup(opts: { persona?: string | null; lastInbound?: number | null } = {}) {
  const { db, raw } = memoryDb();
  seedBasics(raw, { persona: opts.persona });
  const clock = fakeClock(istMs(DAY, '09:00'));
  if (opts.lastInbound !== null) {
    raw.prepare('UPDATE users SET last_inbound_at = ? WHERE id = ?').run(opts.lastInbound ?? istMs(DAY, '08:30'), 'gf');
  }
  const send = fakeSender(clock);
  const deps: TickDeps = { db, send, llm: null, clock, templateName: 'hello_world', publicBaseUrl: '' };
  return { db, raw, clock, send, deps };
}

describe('tick end-to-end (canned strings, in-memory sqlite)', () => {
  it('sends the morning kickoff with buttons and never duplicates it', async () => {
    const { deps, send, raw } = setup();
    const r1 = await runTick(deps);
    expect(r1.ran).toBe(true);
    expect(r1.sent).toHaveLength(1);
    expect(r1.sent[0].kind).toBe('morning');
    expect(send.sent[0].kind).toBe('buttons');
    expect(send.sent[0].buttons?.map((b) => b.id)).toContain(`done:water:${DAY}`);

    const r2 = await runTick(deps, { force: true });
    expect(r2.sent).toHaveLength(0);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM nudges WHERE kind = 'morning'").get()).toEqual({ n: 1 });
  });

  it('skips ticks under the CAS lock unless forced', async () => {
    const { deps, clock } = setup();
    await runTick(deps);
    clock.advance(60_000); // 1 min later — lock still fresh
    const r = await runTick(deps);
    expect(r).toMatchObject({ ran: false, reason: 'locked' });
    clock.advance(15 * 60_000);
    expect((await runTick(deps)).ran).toBe(true);
  });

  it('rolls over yesterday: streaks, perfect day, coupon earning, morning announcement', async () => {
    const { deps, raw, send } = setup();
    // Yesterday (2026-08-20): water complete (vitamin not due on the 20th).
    raw.prepare(
      `INSERT INTO habit_logs (habit_id, user_id, local_day, count, status, source, logged_at)
       VALUES ('water', 'gf', '2026-08-20', 8, 'done', 'text', ?)`,
    ).run(istMs('2026-08-20', '20:00'));
    raw.prepare("UPDATE streaks SET current = 2, best = 2 WHERE key = 'water'").run();
    raw.prepare(
      `INSERT INTO coupons (user_id, title, status, trigger_type, trigger_value, created_at)
       VALUES ('gf', 'You pick dinner', 'stocked', 'streak_milestone', 3, 0)`,
    ).run();

    await runTick(deps);

    const water = raw.prepare("SELECT * FROM streaks WHERE key = 'water'").get() as Streak;
    expect(water.current).toBe(3);
    const perfect = raw.prepare("SELECT * FROM streaks WHERE key = 'perfect_day'").get() as Streak;
    expect(perfect.current).toBe(1);
    const coupon = raw.prepare('SELECT status, announced, earned_for FROM coupons').get() as {
      status: string;
      announced: number;
      earned_for: string;
    };
    expect(coupon.status).toBe('earned');
    expect(coupon.earned_for).toBe('water:streak:3');
    expect(coupon.announced).toBe(1); // announced inside the morning brief
    expect(send.sent[0].body).toContain('You pick dinner');
    const pd = raw.prepare("SELECT delta FROM points_ledger WHERE reason = 'perfect_day'").get() as { delta: number };
    expect(pd.delta).toBe(20);
  });

  it('uses the reopen template when the window is closed', async () => {
    const { deps, send } = setup({ lastInbound: istMs('2026-08-19', '10:00') });
    const r = await runTick(deps);
    expect(r.sent[0].kind).toBe('template_reopen');
    expect(send.sent[0].kind).toBe('template');
  });

  it('records failed sends without satisfying the once-per-day check', async () => {
    const { db, raw, clock } = setup();
    let failing = true;
    const send = fakeSender(clock, { fail: () => failing });
    const deps: TickDeps = { db, send, llm: null, clock, templateName: 'hello_world', publicBaseUrl: '' };

    const r1 = await runTick(deps);
    expect(r1.sent[0].ok).toBe(false);
    const failedRow = raw.prepare("SELECT status FROM nudges WHERE kind = 'morning'").get() as Nudge;
    expect(failedRow.status).toBe('failed');

    failing = false;
    clock.advance(15 * 60_000);
    const r2 = await runTick(deps);
    expect(r2.sent[0]).toMatchObject({ kind: 'morning', ok: true });
  });
});

describe('webhook end-to-end', () => {
  it('dedupes Meta retries on wamid', async () => {
    const { deps, raw } = setup();
    const msg = { waId: '919900000001', wamid: 'wamid.dup.1', kind: 'text' as const, text: 'status' };
    await handleInbound(deps, msg);
    await handleInbound(deps, msg); // retry
    expect(raw.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction = 'in'").get()).toEqual({ n: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction = 'out'").get()).toEqual({ n: 1 });
  });

  it('logs a Done button tap and replies with progress', async () => {
    const { deps, raw, send } = setup();
    await handleInbound(deps, { waId: '919900000001', wamid: 'wamid.b1', kind: 'button', buttonId: `done:water:${DAY}` });
    const row = raw.prepare("SELECT count, source FROM habit_logs WHERE habit_id = 'water'").get() as {
      count: number;
      source: string;
    };
    expect(row).toEqual({ count: 1, source: 'button' });
    expect(send.sent.at(-1)?.body).toContain('1/8');
  });

  it('rejects stale taps from yesterday’s card', async () => {
    const { deps, raw } = setup();
    await handleInbound(deps, { waId: '919900000001', wamid: 'wamid.b2', kind: 'button', buttonId: 'done:water:2026-08-20' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM habit_logs').get()).toEqual({ n: 0 });
  });

  it('completing the vitamin via text awards points and stops at target', async () => {
    const { deps, raw, send } = setup();
    await handleInbound(deps, { waId: '919900000001', wamid: 'wamid.t1', kind: 'text', text: 'done' });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM habit_logs WHERE habit_id = 'multivitamin'").get()).toEqual({ n: 1 });
    const pts = raw.prepare("SELECT SUM(delta) AS s FROM points_ledger").get() as { s: number };
    expect(pts.s).toBe(10);

    await handleInbound(deps, { waId: '919900000001', wamid: 'wamid.t2', kind: 'text', text: 'done' });
    // second "done" resolves to water now (vitamin complete)
    expect(raw.prepare("SELECT COUNT(*) AS n FROM habit_logs WHERE habit_id = 'water'").get()).toEqual({ n: 1 });
    expect(send.sent.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores unknown senders entirely', async () => {
    const { deps, raw, send } = setup();
    await handleInbound(deps, { waId: '918888888888', wamid: 'wamid.x1', kind: 'text', text: 'hello' });
    expect(raw.prepare("SELECT user_id FROM messages WHERE wa_message_id = 'wamid.x1'").get()).toEqual({ user_id: null });
    expect(send.sent).toHaveLength(0);
  });

  it('runs onboarding for a fresh player and lands in her chosen persona', async () => {
    const { deps, raw, send } = setup({ persona: null });
    const her = '919900000001';
    await handleInbound(deps, { waId: her, wamid: 'ob.1', kind: 'text', text: 'hii' });
    expect(send.sent.at(-1)?.buttons?.map((b) => b.id)).toContain('ob:persona:sassy');

    await handleInbound(deps, { waId: her, wamid: 'ob.2', kind: 'button', buttonId: 'ob:persona:pet' });
    await handleInbound(deps, { waId: her, wamid: 'ob.3', kind: 'button', buttonId: 'ob:lang:hinglish' });
    await handleInbound(deps, { waId: her, wamid: 'ob.4', kind: 'button', buttonId: 'ob:win:custom' });
    await handleInbound(deps, { waId: her, wamid: 'ob.5', kind: 'text', text: '10am to 11pm' });

    const u = raw.prepare("SELECT persona, language, wake_start, wake_end, convo_state FROM users WHERE id = 'gf'").get() as {
      persona: string;
      language: string;
      wake_start: string;
      wake_end: string;
      convo_state: string | null;
    };
    expect(u).toMatchObject({ persona: 'pet', language: 'hinglish', wake_start: '10:00', wake_end: '23:00', convo_state: null });
  });

  it('redeems an earned coupon and notifies the admin', async () => {
    const { deps, raw, send } = setup();
    raw.prepare(
      `INSERT INTO coupons (user_id, title, status, trigger_type, trigger_value, earned_at, announced, created_at)
       VALUES ('gf', '1x back massage', 'earned', 'streak_milestone', 7, 1, 1, 0)`,
    ).run();
    await handleInbound(deps, { waId: '919900000001', wamid: 'r.1', kind: 'text', text: 'redeem' });
    expect(raw.prepare('SELECT status FROM coupons').get()).toEqual({ status: 'redeemed' });
    const adminMsg = send.sent.find((s) => s.to === '919900000002');
    expect(adminMsg?.body).toContain('back massage');
  });

  it('admin /tick and /status work over WhatsApp', async () => {
    const { deps, send } = setup();
    await handleInbound(deps, { waId: '919900000002', wamid: 'a.1', kind: 'text', text: '/status' });
    expect(send.sent.at(-1)?.body).toContain('Water: 0/8');
    await handleInbound(deps, { waId: '919900000002', wamid: 'a.2', kind: 'text', text: '/tick' });
    expect(send.sent.at(-1)?.body).toContain('tick →');
  });
});
