import { describe, expect, it } from 'vitest';
import { waterDecision, type PacingInput } from '../../src/engine/pacing';

function input(over: Partial<PacingInput> = {}): PacingInput {
  return {
    target: 8,
    done: 0,
    nowMin: 870, // 14:30
    startMin: 540, // 09:00
    endMin: 1260, // 21:00
    minutesSinceLastNudge: null,
    nudgesToday: 0,
    nagMax: 5,
    snoozed: false,
    catchupSentToday: false,
    ...over,
  };
}

describe('water pacing', () => {
  it('suppresses when on pace (the anti-fatigue core)', () => {
    // 14:30 → 45.8% elapsed → expected 3.67; done 4 ≥ 3.17 → quiet
    expect(waterDecision(input({ done: 4 }))).toEqual({ action: 'suppress', reason: 'on_pace' });
  });

  it('fires when behind', () => {
    // 17:30 → expected 5.67; done 4 < 5.17 → fire
    expect(waterDecision(input({ done: 4, nowMin: 1050 }))).toEqual({ action: 'fire', kind: 'reminder' });
  });

  it('unprompted logs silently absorb into the pace check', () => {
    expect(waterDecision(input({ done: 6, nowMin: 1050 }))).toEqual({ action: 'suppress', reason: 'on_pace' });
  });

  it('respects the adaptive gap since the last nudge', () => {
    // 17:30, behind, gap = clamp(210/5, 60, 180) = 60
    expect(waterDecision(input({ done: 4, nowMin: 1050, minutesSinceLastNudge: 30 }))).toEqual({
      action: 'suppress',
      reason: 'gap',
    });
    expect(waterDecision(input({ done: 4, nowMin: 1050, minutesSinceLastNudge: 208 }))).toEqual({
      action: 'fire',
      kind: 'reminder',
    });
  });

  it('switches to catch-up mode near the end of the window', () => {
    // 19:30 → 90 min left, 4 remaining ≥ 3
    expect(waterDecision(input({ done: 4, nowMin: 1170, minutesSinceLastNudge: 120 }))).toEqual({
      action: 'fire',
      kind: 'catchup',
    });
    expect(
      waterDecision(input({ done: 4, nowMin: 1170, minutesSinceLastNudge: 120, catchupSentToday: true })),
    ).toEqual({ action: 'fire', kind: 'reminder' });
  });

  it('suppresses when complete, snoozed, capped, or outside the window', () => {
    expect(waterDecision(input({ done: 8 }))).toEqual({ action: 'suppress', reason: 'complete' });
    expect(waterDecision(input({ done: 1, snoozed: true, nowMin: 1050 }))).toEqual({ action: 'suppress', reason: 'snoozed' });
    expect(waterDecision(input({ done: 1, nowMin: 1050, nudgesToday: 5 }))).toEqual({ action: 'suppress', reason: 'capped' });
    expect(waterDecision(input({ nowMin: 500 }))).toEqual({ action: 'suppress', reason: 'before_window' });
    expect(waterDecision(input({ nowMin: 1300 }))).toEqual({ action: 'suppress', reason: 'after_window' });
  });
});
