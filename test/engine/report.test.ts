import { describe, expect, it } from 'vitest';
import { weeklyReport } from '../../src/engine/report';
import type { HabitLog } from '../../src/core/types';
import { mkVitamin, mkWater } from '../helpers/snapshots';

const WEEK = '2026-08-17'; // Mon
const DAYS = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
// vitamin (anchor 08-15, every 2) due on 17, 19, 21, 23 within this week

function wlog(day: string, habit: string, count: number, status: 'done' | 'skipped' = 'done'): HabitLog {
  return { habit_id: habit, user_id: 'gf', local_day: day, count, status, source: 'text', logged_at: 0 };
}

describe('weekly report', () => {
  it('computes percentages, grade, perfect days, best day', () => {
    const logs: HabitLog[] = [];
    for (const d of DAYS) logs.push(wlog(d, 'water', 7)); // 49/56 = 87.5 -> 88%
    for (const d of ['2026-08-17', '2026-08-19', '2026-08-21', '2026-08-23']) logs.push(wlog(d, 'multivitamin', 1)); // 100%

    const rep = weeklyReport({
      weekStart: WEEK,
      days: DAYS,
      habits: [mkWater(), mkVitamin()],
      logs,
      streaks: {},
      pointsEarned: 123,
      challenge: null,
    });
    expect(rep.perHabit.find((h) => h.id === 'water')?.pct).toBe(88);
    expect(rep.perHabit.find((h) => h.id === 'multivitamin')?.pct).toBe(100);
    expect(rep.overallPct).toBe(94);
    expect(rep.grade).toBe('A');
    expect(rep.perfectDays).toBe(0); // water never hit 8
    expect(rep.bestDay).not.toBeNull();
    expect(rep.nextChallenge.title.length).toBeGreaterThan(0);
  });

  it('excludes skipped days from the denominator', () => {
    const logs: HabitLog[] = [
      wlog('2026-08-17', 'water', 8),
      ...DAYS.slice(1).map((d) => wlog(d, 'water', 0, 'skipped')),
      ...['2026-08-17', '2026-08-19', '2026-08-21', '2026-08-23'].map((d) => wlog(d, 'multivitamin', 0, 'skipped')),
    ];
    const rep = weeklyReport({
      weekStart: WEEK,
      days: DAYS,
      habits: [mkWater(), mkVitamin()],
      logs,
      streaks: {},
      pointsEarned: 0,
      challenge: null,
    });
    expect(rep.perHabit.find((h) => h.id === 'water')?.pct).toBe(100); // 8/8 on the only graded day
    expect(rep.perHabit.find((h) => h.id === 'multivitamin')?.pct).toBe(100); // no graded days
    expect(rep.perfectDays).toBe(1);
  });

  it('grades the weekly challenge', () => {
    const logs = DAYS.slice(0, 5).map((d) => wlog(d, 'water', 8));
    const rep = weeklyReport({
      weekStart: WEEK,
      days: DAYS,
      habits: [mkWater()],
      logs,
      streaks: {},
      pointsEarned: 0,
      challenge: { title: '5 full days', rule: { type: 'habit_days', habit_id: 'water', days: 5 }, reward_points: 30 },
    });
    expect(rep.challengeResult).toBe('completed');

    const rep2 = weeklyReport({
      weekStart: WEEK,
      days: DAYS,
      habits: [mkWater()],
      logs: logs.slice(0, 3),
      streaks: {},
      pointsEarned: 0,
      challenge: { title: '5 full days', rule: { type: 'habit_days', habit_id: 'water', days: 5 }, reward_points: 30 },
    });
    expect(rep2.challengeResult).toBe('failed');
  });
});
