import { describe, expect, it } from 'vitest';
import type { Coupon, User } from '../src/core/types';
import { repo } from '../src/db/repo';
import { handleAdmin } from '../src/flows/admin';
import { runTick, type TickDeps } from '../src/scheduler/tick';
import { handleInbound } from '../src/webhook/handle';
import { fakeClock, fakeSender, istMs } from './helpers/fakes';
import { memoryDb, seedBasics } from './helpers/sqlite';

const DAY = '2026-08-21';
const HER = '919900000001';
const HIM = '919900000002';

function setup(opts: { lastInbound?: number } = {}) {
  const { db, raw } = memoryDb();
  seedBasics(raw);
  raw.prepare('UPDATE users SET last_inbound_at = ? WHERE id = ?').run(opts.lastInbound ?? istMs(DAY, '09:30'), 'gf');
  raw
    .prepare(
      `INSERT INTO coupons (user_id, title, status, trigger_type, trigger_value, created_at)
       VALUES ('gf', 'Back massage', 'stocked', 'streak_milestone', 7, 0)`,
    )
    .run();
  const clock = fakeClock(istMs(DAY, '14:00'));
  const send = fakeSender(clock);
  const deps: TickDeps = { db, send, llm: null, clock, templateName: 'hello_world', publicBaseUrl: '' };
  return { db, raw, clock, send, deps };
}

const adminMsg = (text: string) => ({ waId: HIM, wamid: `a.${text}.${Math.random()}`, kind: 'text' as const, text });

describe('gifting a coupon', () => {
  it('creates a brand-new unlocked reward and tells her immediately', async () => {
    const { deps, raw, send, db } = setup();
    const admin = (await repo.getAdmin(db)) as User;
    await handleAdmin(deps, admin, adminMsg('/gift "One free hug, on demand" | just because'), deps.clock.now());

    const c = raw.prepare("SELECT * FROM coupons WHERE title = 'One free hug, on demand'").get() as Coupon;
    expect(c.status).toBe('earned');
    expect(c.earned_for).toBe('gift');
    expect(c.announced).toBe(1);
    expect(c.trigger_type).toBe('any'); // never sits in the stocked pool

    const toHer = send.sent.filter((s) => s.to === HER);
    expect(toHer).toHaveLength(1);
    expect(toHer[0].body).toContain('One free hug');
    expect(toHer[0].body).toContain('just because');
    expect(send.sent.at(-1)?.to).toBe(HIM); // his confirmation
    expect(send.sent.at(-1)?.body).toContain('Gifted');
  });

  it('unlocks an existing stocked coupon early', async () => {
    const { deps, raw, send, db } = setup();
    const admin = (await repo.getAdmin(db)) as User;
    const id = (raw.prepare("SELECT id FROM coupons WHERE title = 'Back massage'").get() as { id: number }).id;

    await handleAdmin(deps, admin, adminMsg(`/gift ${id} | early, you deserve it`), deps.clock.now());
    const c = raw.prepare('SELECT * FROM coupons WHERE id = ?').get(id) as Coupon;
    expect(c).toMatchObject({ status: 'earned', earned_for: 'gift', announced: 1 });
    expect(send.sent.find((s) => s.to === HER)?.body).toContain('Back massage');
  });

  it('refuses to gift a coupon twice', async () => {
    const { deps, raw, send, db } = setup();
    const admin = (await repo.getAdmin(db)) as User;
    const id = (raw.prepare("SELECT id FROM coupons WHERE title = 'Back massage'").get() as { id: number }).id;
    await handleAdmin(deps, admin, adminMsg(`/gift ${id}`), deps.clock.now());
    await handleAdmin(deps, admin, adminMsg(`/gift ${id}`), deps.clock.now());
    expect(send.sent.at(-1)?.body).toContain('already earned');
  });

  it('defers the announcement to the morning brief when her window is closed', async () => {
    const { deps, raw, send, clock, db } = setup({ lastInbound: istMs('2026-08-19', '10:00') });
    const admin = (await repo.getAdmin(db)) as User;
    await handleAdmin(deps, admin, adminMsg('/gift "Surprise dinner" | tonight'), clock.now());

    let c = raw.prepare("SELECT * FROM coupons WHERE title = 'Surprise dinner'").get() as Coupon;
    expect(c.status).toBe('earned');
    expect(c.announced).toBe(0); // held, not lost
    expect(send.sent.some((s) => s.to === HER)).toBe(false);
    expect(send.sent.at(-1)?.body).toContain('tomorrow');

    // She replies (window reopens), next morning tick announces it.
    raw.prepare('UPDATE users SET last_inbound_at = ? WHERE id = ?').run(istMs('2026-08-22', '08:00'), 'gf');
    clock.set(istMs('2026-08-22', '09:00'));
    const r = await runTick(deps, { force: true });
    expect(r.sent[0].kind).toBe('morning');
    expect(r.sent[0].text).toContain('Surprise dinner');
    c = raw.prepare("SELECT * FROM coupons WHERE title = 'Surprise dinner'").get() as Coupon;
    expect(c.announced).toBe(1);
  });

  it('is redeemable like any earned reward', async () => {
    const { deps, raw, send, db } = setup();
    const admin = (await repo.getAdmin(db)) as User;
    await handleAdmin(deps, admin, adminMsg('"/gift" placeholder'), deps.clock.now()); // help path, no crash
    await handleAdmin(deps, admin, adminMsg('/gift "Ice cream run"'), deps.clock.now());

    await handleInbound(deps, { waId: HER, wamid: 'r.1', kind: 'text', text: 'redeem' });
    const c = raw.prepare("SELECT status FROM coupons WHERE title = 'Ice cream run'").get() as { status: string };
    expect(c.status).toBe('redeemed');
    expect(send.sent.at(-1)?.to).toBe(HIM);
    expect(send.sent.at(-1)?.body).toContain('Pay up');
  });
});
