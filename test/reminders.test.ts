import { describe, expect, it } from 'vitest';
import type { Reminder } from '../src/core/types';
import { repo } from '../src/db/repo';
import { applyIntent } from '../src/flows/logging';
import { keywordIntent } from '../src/intents/keywords';
import { runTick, type TickDeps } from '../src/scheduler/tick';
import { buildWeatherFacts, weatherLabel } from '../src/weather';
import { fakeClock, fakeSender, istMs } from './helpers/fakes';
import { mkVitamin, mkWater } from './helpers/snapshots';
import { memoryDb, seedBasics } from './helpers/sqlite';

const DAY = '2026-08-21';

function setup() {
  const { db, raw } = memoryDb();
  seedBasics(raw);
  raw.prepare('UPDATE users SET last_inbound_at = ? WHERE id = ?').run(istMs(DAY, '09:30'), 'gf');
  const clock = fakeClock(istMs(DAY, '10:00'));
  const send = fakeSender(clock);
  const deps: TickDeps = { db, send, llm: null, clock, templateName: 'hello_world', publicBaseUrl: '' };
  return { db, raw, clock, send, deps };
}

describe('her own reminders', () => {
  it('keyword shortcuts work; "remind me..." defers to the LLM', () => {
    const habits = [mkWater(), mkVitamin()];
    expect(keywordIntent('reminders', habits, [])).toEqual({ type: 'list_reminders' });
    expect(keywordIntent('cancel reminder 3', habits, [])).toEqual({ type: 'cancel_reminder', id: 3 });
    expect(keywordIntent('remind me to call mom at 5', habits, [])).toBeNull();
  });

  it('sets, lists, fires exactly once, and never double-fires', async () => {
    const { deps, raw, clock, send, db } = setup();
    const player = (await repo.getPlayer(db))!;

    await applyIntent(deps, player, { type: 'set_reminder', text: 'call mom', dueLocal: `${DAY} 17:00` }, clock.now());
    const row = raw.prepare('SELECT * FROM reminders').get() as Reminder;
    expect(row.status).toBe('pending');
    expect(row.due_at).toBe(istMs(DAY, '17:00'));
    expect(send.sent.at(-1)?.body).toContain('call mom'); // confirmation

    await applyIntent(deps, player, { type: 'list_reminders' }, clock.now());
    expect(send.sent.at(-1)?.body).toContain(`#${row.id}`);

    clock.set(istMs(DAY, '16:45'));
    await runTick(deps, { force: true });
    expect((raw.prepare('SELECT status FROM reminders').get() as Reminder).status).toBe('pending');

    clock.set(istMs(DAY, '17:00'));
    const r = await runTick(deps, { force: true });
    expect(r.remindersFired).toBe(1);
    expect((raw.prepare('SELECT status FROM reminders').get() as Reminder).status).toBe('sent');
    const fires = send.sent.filter((s) => s.body.includes('call mom') && s.at >= istMs(DAY, '17:00'));
    expect(fires).toHaveLength(1);

    clock.set(istMs(DAY, '17:15'));
    const r2 = await runTick(deps, { force: true });
    expect(r2.remindersFired).toBe(0);
  });

  it('bumps a just-passed time to tomorrow', async () => {
    const { deps, raw, clock, db } = setup();
    const player = (await repo.getPlayer(db))!;
    await applyIntent(deps, player, { type: 'set_reminder', text: 'stretch', dueLocal: `${DAY} 09:00` }, clock.now());
    const row = raw.prepare('SELECT due_at FROM reminders').get() as { due_at: number };
    expect(row.due_at).toBe(istMs('2026-08-22', '09:00'));
  });

  it('fires even while paused / in soft mode (they are HER reminders)', async () => {
    const { deps, raw, clock, db } = setup();
    const player = (await repo.getPlayer(db))!;
    raw.prepare('UPDATE users SET paused_until = ?, soft_until = ? WHERE id = ?')
      .run(istMs(DAY, '23:00'), istMs(DAY, '23:00'), 'gf');
    await applyIntent(deps, player, { type: 'set_reminder', text: 'parcel pickup', dueLocal: `${DAY} 12:00` }, clock.now());
    clock.set(istMs(DAY, '12:00'));
    const r = await runTick(deps, { force: true });
    expect(r.sent).toHaveLength(0); // paused: no nudges
    expect(r.remindersFired).toBe(1); // ...but her reminder still lands
  });

  it('holds delivery while the 24h window is closed, fires when it reopens', async () => {
    const { deps, raw, clock, db } = setup();
    const player = (await repo.getPlayer(db))!;
    await applyIntent(deps, player, { type: 'set_reminder', text: 'water the plants', dueLocal: `${DAY} 15:00` }, clock.now());
    raw.prepare('UPDATE users SET last_inbound_at = ? WHERE id = ?').run(istMs('2026-08-19', '10:00'), 'gf');

    clock.set(istMs(DAY, '15:00'));
    const r1 = await runTick(deps, { force: true });
    expect(r1.remindersFired).toBe(0); // window closed — held

    raw.prepare('UPDATE users SET last_inbound_at = ? WHERE id = ?').run(istMs(DAY, '15:20'), 'gf');
    clock.set(istMs(DAY, '15:30'));
    const r2 = await runTick(deps, { force: true });
    expect(r2.remindersFired).toBe(1);
  });

  it('cancels by id', async () => {
    const { deps, raw, clock, send, db } = setup();
    const player = (await repo.getPlayer(db))!;
    await applyIntent(deps, player, { type: 'set_reminder', text: 'x', dueLocal: `${DAY} 18:00` }, clock.now());
    const id = (raw.prepare('SELECT id FROM reminders').get() as { id: number }).id;
    await applyIntent(deps, player, { type: 'cancel_reminder', id }, clock.now());
    expect((raw.prepare('SELECT status FROM reminders').get() as Reminder).status).toBe('cancelled');
    expect(send.sent.at(-1)?.body).toContain('Cancelled');
    clock.set(istMs(DAY, '18:00'));
    expect((await runTick(deps, { force: true })).remindersFired).toBe(0);
  });
});

describe('weather facts', () => {
  it('maps codes and builds the morning line', () => {
    expect(weatherLabel(0)).toBe('clear skies');
    expect(weatherLabel(63)).toBe('rainy');
    expect(weatherLabel(95)).toBe('thundery');
    expect(buildWeatherFacts(34.4, 20, 1)).toEqual({
      weatherLine: 'Today: partly cloudy, high 34°C.',
      hotDaySuggestion: 'hot day — suggest 1 bonus glass beyond the target',
    });
    const scorcher = buildWeatherFacts(41, 70, 95);
    expect(scorcher.weatherLine).toBe('Today: thundery, high 41°C, 70% chance of rain.');
    expect(String(scorcher.hotDaySuggestion)).toContain('2 bonus glasses');
    expect(buildWeatherFacts(28, 10, 3)).toEqual({ weatherLine: 'Today: overcast, high 28°C.' });
  });
});
