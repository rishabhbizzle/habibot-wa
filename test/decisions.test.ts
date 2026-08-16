import { describe, expect, it } from 'vitest';
import { decide } from '../src/scheduler/decisions';
import { istMs } from './helpers/fakes';
import { DAY, log, mkSnap, mkStreak, mkUser, nudge } from './helpers/snapshots';

const vitaminDone = log('multivitamin', 1, '09:40');

describe('decide() — golden day', () => {
  it('does nothing before onboarding, while paused, or outside the wake window', () => {
    expect(decide(mkSnap('14:00', { player: mkUser({ persona: null }) }))).toEqual([]);
    expect(decide(mkSnap('14:00', { player: mkUser({ paused_until: istMs(DAY, '18:00') }) }))).toEqual([]);
    expect(decide(mkSnap('08:00'))).toEqual([]);
    expect(decide(mkSnap('21:00'))).toEqual([]);
  });

  it('sends the morning kickoff first, once', () => {
    const d = decide(mkSnap('09:00'));
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('morning');
    expect(decide(mkSnap('09:15', { nudgesToday: [nudge('morning', '09:00')] }))[0]?.kind).not.toBe('morning');
  });

  it('falls back to the reopen template when the 24h window is closed — once per day', () => {
    const closed = mkSnap('09:00', { windowOpen: false });
    expect(decide(closed)[0].kind).toBe('template_reopen');
    expect(decide(mkSnap('12:00', { windowOpen: false, nudgesToday: [nudge('template_reopen', '09:00')] }))).toEqual([]);
  });

  it('stays quiet when she is on pace (the 14:30 case)', () => {
    const s = mkSnap('14:30', {
      nudgesToday: [nudge('morning', '09:00')],
      logsToday: [vitaminDone, log('water', 4, '13:00')],
    });
    expect(decide(s)).toEqual([]);
  });

  it('fires a water reminder when behind (the 17:30 case), escalation 0 after recent inbound', () => {
    const s = mkSnap('17:30', {
      player: mkUser({ last_inbound_at: istMs(DAY, '15:10') }),
      nudgesToday: [nudge('morning', '09:00'), nudge('reminder', '14:02', { habit_id: 'water' })],
      logsToday: [vitaminDone, log('water', 4, '13:00')],
    });
    const d = decide(s);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: 'reminder', habitId: 'water', escalation: 0 });
    expect(d[0].facts).toMatchObject({ done: 4, target: 8 });
  });

  it('escalates when she ignores nudges', () => {
    const s = mkSnap('13:10', {
      player: mkUser({ last_inbound_at: istMs(DAY, '09:05') }),
      nudgesToday: [
        nudge('morning', '09:00'),
        nudge('reminder', '09:35', { habit_id: 'multivitamin' }),
        nudge('reminder', '11:15', { habit_id: 'multivitamin', escalation: 1 }),
      ],
      logsToday: [log('water', 3, '12:00')], // water on pace, so the vitamin path is isolated
    });
    const d = decide(s);
    expect(d[0]).toMatchObject({ kind: 'reminder', habitId: 'multivitamin', escalation: 2 });
  });

  it('goes silent on a habit after the level-3 final word', () => {
    const s = mkSnap('16:00', {
      player: mkUser({ last_inbound_at: istMs(DAY, '08:00') }),
      nudgesToday: [
        nudge('morning', '09:00'),
        nudge('reminder', '09:35', { habit_id: 'multivitamin' }),
        nudge('reminder', '11:15', { habit_id: 'multivitamin', escalation: 1 }),
        nudge('reminder', '13:00', { habit_id: 'multivitamin', escalation: 3 }),
      ],
      logsToday: [log('water', 5, '14:00')], // water on pace at 16:00 (expected 4.67)
    });
    expect(decide(s)).toEqual([]);
  });

  it('respects the vitamin anchor time and min gap', () => {
    const before = mkSnap('09:15', { nudgesToday: [nudge('morning', '09:00')] });
    expect(decide(before)).toEqual([]); // 09:15 < anchor 09:30 and water on pace

    const after = mkSnap('09:45', { nudgesToday: [nudge('morning', '09:00')] });
    expect(decide(after)[0]).toMatchObject({ kind: 'reminder', habitId: 'multivitamin' });

    const tooSoon = mkSnap('10:30', {
      nudgesToday: [nudge('morning', '09:00'), nudge('reminder', '09:45', { habit_id: 'multivitamin' })],
      logsToday: [log('water', 1, '10:00')], // keep water on pace
    });
    expect(decide(tooSoon)).toEqual([]); // 45 min < 90 min gap
  });

  it('sends the streak-save before a generic reminder in the endgame', () => {
    const s = mkSnap('19:30', {
      nudgesToday: [nudge('morning', '09:00')],
      logsToday: [vitaminDone, log('water', 4, '15:00')],
      streaks: { water: mkStreak('water', 5) },
    });
    const d = decide(s);
    expect(d[0]).toMatchObject({ kind: 'streak_save', habitId: 'water' });
    expect(d[0].facts).toMatchObject({ streak: 5, minutesLeft: 90 });
  });

  it('switches to catch-up mode late in the day when no streak is at risk', () => {
    const s = mkSnap('19:30', {
      nudgesToday: [nudge('morning', '09:00'), nudge('reminder', '17:30', { habit_id: 'water' })],
      logsToday: [vitaminDone, log('water', 4, '15:00')],
    });
    expect(decide(s)[0]).toMatchObject({ kind: 'catchup', habitId: 'water' });
  });

  it('honors snoozes', () => {
    const s = mkSnap('17:30', {
      nudgesToday: [nudge('morning', '09:00')],
      logsToday: [vitaminDone, log('water', 2, '11:00')],
      snoozesToday: [{ habit_id: 'water', local_day: DAY, until: istMs(DAY, '18:30') }],
    });
    expect(decide(s)).toEqual([]);
  });

  it('soft mode: escalation pinned to 0, one gentle reminder per habit, low daily cap', () => {
    const soft = mkUser({ soft_until: istMs(DAY, '23:00'), last_inbound_at: istMs(DAY, '08:00') });
    const first = mkSnap('12:00', { player: soft, nudgesToday: [nudge('morning', '09:00')] });
    const d = decide(first);
    expect(d[0]).toMatchObject({ kind: 'reminder', escalation: 0 });

    const second = mkSnap('15:00', {
      player: soft,
      nudgesToday: [nudge('morning', '09:00'), nudge('reminder', '12:00', { habit_id: d[0].habitId })],
    });
    expect(decide(second)).toEqual([]); // SOFT_MAX_NUDGES = 2 reached
  });

  it('fires the Sunday report at 20:00, once per week', () => {
    const sunday = mkSnap('20:00', {
      isSunday: true,
      nudgesToday: [nudge('morning', '09:00')],
      logsToday: [vitaminDone, log('water', 8, '19:00')],
    });
    expect(decide(sunday)[0]).toMatchObject({ kind: 'report' });

    const already = mkSnap('20:15', {
      isSunday: true,
      lastReportWeek: sunday.weekKey,
      nudgesToday: [nudge('morning', '09:00')],
      logsToday: [vitaminDone, log('water', 8, '19:00')],
    });
    expect(decide(already)).toEqual([]);
  });

  it('stops at the daily proactive cap', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      nudge('reminder', `1${i % 10}:0${i % 6}`, { habit_id: 'water' }),
    );
    expect(decide(mkSnap('18:00', { nudgesToday: many }))).toEqual([]);
  });
});
