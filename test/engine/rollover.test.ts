import { describe, expect, it } from 'vitest';
import { rolloverDay } from '../../src/engine/rollover';
import { pickCoupon } from '../../src/engine/coupons';
import type { Coupon } from '../../src/core/types';
import { log, mkStreak, mkVitamin, mkWater } from '../helpers/snapshots';

const DAY = '2026-08-21'; // vitamin due

function run(overrides: Partial<Parameters<typeof rolloverDay>[0]> = {}) {
  return rolloverDay({
    day: DAY,
    userId: 'gf',
    habits: [mkWater(), mkVitamin()],
    logs: [],
    streaks: {},
    softDay: false,
    ...overrides,
  });
}

describe('rollover', () => {
  it('extends streaks on completion and detects milestones', () => {
    const res = run({
      logs: [log('water', 8, '20:00'), log('multivitamin', 1, '09:40')],
      streaks: { water: mkStreak('water', 2), multivitamin: mkStreak('multivitamin', 0) },
    });
    const water = res.streakUpdates.find((s) => s.key === 'water');
    expect(water?.current).toBe(3);
    expect(res.milestones.map((m) => m.key)).toContain('water:streak:3');
    expect(res.perfectDay).toBe(true);
    expect(res.ledger).toEqual([{ delta: 20, reason: 'perfect_day', ref: DAY }]);
  });

  it('resets a missed habit, freezes a skipped one', () => {
    const res = run({
      logs: [log('multivitamin', 0, '10:00', 'skipped')],
      streaks: { water: mkStreak('water', 5), multivitamin: mkStreak('multivitamin', 4) },
    });
    expect(res.streakUpdates.find((s) => s.key === 'water')?.current).toBe(0);
    expect(res.streakUpdates.find((s) => s.key === 'multivitamin')?.current).toBe(4); // frozen
    expect(res.perfectDay).toBe(false);
  });

  it('soft day freezes everything', () => {
    const res = run({
      softDay: true,
      streaks: { water: mkStreak('water', 5), multivitamin: mkStreak('multivitamin', 2), perfect_day: mkStreak('perfect_day', 3) },
    });
    expect(res.streakUpdates.find((s) => s.key === 'water')?.current).toBe(5);
    expect(res.streakUpdates.find((s) => s.key === 'perfect_day')?.current).toBe(3);
  });

  it('flags a perfect week', () => {
    const res = run({
      logs: [log('water', 8, '20:00'), log('multivitamin', 1, '09:40')],
      streaks: { perfect_day: mkStreak('perfect_day', 6) },
    });
    expect(res.milestones.map((m) => m.trigger_type)).toContain('perfect_week');
  });

  it('never double-processes a day', () => {
    const already = { ...mkStreak('water', 3), last_counted_day: DAY };
    const res = run({ logs: [log('water', 8, '20:00'), log('multivitamin', 1, '09:40')], streaks: { water: already } });
    expect(res.streakUpdates.find((s) => s.key === 'water')).toBeUndefined();
  });
});

describe('coupon picking', () => {
  const base: Omit<Coupon, 'id' | 'trigger_type' | 'trigger_value'> = {
    user_id: 'gf',
    title: 'x',
    description: null,
    status: 'stocked',
    media_ref: null,
    earned_at: null,
    earned_for: null,
    announced: 0,
    redeemed_at: null,
    created_at: 0,
  };
  const milestone = { key: 'water:streak:7', trigger_type: 'streak_milestone' as const, habit_id: 'water', value: 7, label: '' };

  it('prefers an exact trigger match, falls back to any, else none', () => {
    const exact: Coupon = { ...base, id: 1, trigger_type: 'streak_milestone', trigger_value: 7 };
    const generic: Coupon = { ...base, id: 2, trigger_type: 'any', trigger_value: null };
    const wrong: Coupon = { ...base, id: 3, trigger_type: 'streak_milestone', trigger_value: 30 };
    expect(pickCoupon([wrong, generic, exact], milestone)?.id).toBe(1);
    expect(pickCoupon([wrong, generic], milestone)?.id).toBe(2);
    expect(pickCoupon([wrong], milestone)).toBeNull();
    expect(pickCoupon([{ ...exact, status: 'earned' }], milestone)).toBeNull();
  });
});
