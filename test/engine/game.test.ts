import { describe, expect, it } from 'vitest';
import { applyLog } from '../../src/engine/game';
import { escalationLevel } from '../../src/engine/escalation';
import { isDueOn, dueWindow } from '../../src/engine/schedule';
import { log, mkUser, mkVitamin, mkWater, nudge } from '../helpers/snapshots';
import { istMs } from '../helpers/fakes';

describe('schedule', () => {
  it('daily is always due', () => {
    expect(isDueOn(mkWater(), '2026-08-21')).toBe(true);
  });

  it('every_n_days follows the anchor', () => {
    const v = mkVitamin(); // anchor 2026-08-15, every 2 days
    expect(isDueOn(v, '2026-08-15')).toBe(true);
    expect(isDueOn(v, '2026-08-16')).toBe(false);
    expect(isDueOn(v, '2026-08-17')).toBe(true);
    expect(isDueOn(v, '2026-08-21')).toBe(true);
    expect(isDueOn(v, '2026-08-14')).toBe(false); // before anchor
  });

  it('weekly matches slugs', () => {
    const h = mkWater({ schedule_type: 'weekly', weekly_days: 'mon,fri' });
    expect(isDueOn(h, '2026-08-21')).toBe(true); // Friday
    expect(isDueOn(h, '2026-08-22')).toBe(false); // Saturday
  });

  it('intersects habit window with wake window', () => {
    const u = mkUser({ wake_start: '10:00', wake_end: '20:00' });
    expect(dueWindow(mkWater(), u)).toEqual({ startMin: 600, endMin: 1200 });
    expect(dueWindow(mkVitamin(), u)).toEqual({ startMin: 600, endMin: 1200 }); // no habit window
  });
});

describe('applyLog', () => {
  const water = mkWater();
  const vitamin = mkVitamin();

  it('logs units and awards per-unit points', () => {
    const r = applyLog(water, [], 2);
    expect(r).toMatchObject({ accepted: true, cappedCount: 2, newDone: 2, completedNow: false });
    expect(r.ledger).toEqual([{ delta: 2, reason: 'habit_log', ref: 'water' }]);
  });

  it('detects completion and adds the bonus', () => {
    const r = applyLog(water, [log('water', 7, '10:00')], 1);
    expect(r.completedNow).toBe(true);
    expect(r.ledger).toEqual([
      { delta: 1, reason: 'habit_log', ref: 'water' },
      { delta: 10, reason: 'habit_complete', ref: 'water' },
    ]);
  });

  it('re-logging a complete once-habit is a no-op', () => {
    const r = applyLog(vitamin, [log('multivitamin', 1, '09:40')], 1);
    expect(r.accepted).toBe(false);
  });

  it('hard-caps water at target+2', () => {
    const r = applyLog(water, [log('water', 9, '10:00')], 5);
    expect(r.cappedCount).toBe(1);
    expect(r.newDone).toBe(10);
    expect(applyLog(water, [log('water', 10, '10:00')], 1).accepted).toBe(false);
  });
});

describe('escalation', () => {
  it('counts only reminder-ish nudges since the last inbound', () => {
    const inbound = istMs('2026-08-21', '09:05');
    const nudges = [
      nudge('morning', '09:00'), // before inbound AND not a reminder kind
      nudge('reminder', '11:15', { habit_id: 'multivitamin' }),
      nudge('reminder', '13:00', { habit_id: 'multivitamin', escalation: 1 }),
    ];
    expect(escalationLevel(nudges, inbound)).toBe(2);
  });

  it('resets on any inbound and caps at 3', () => {
    const nudges = ['10:00', '11:00', '12:00', '13:00', '14:00'].map((hm) => nudge('reminder', hm, { habit_id: 'water' }));
    expect(escalationLevel(nudges, istMs('2026-08-21', '09:00'))).toBe(3);
    expect(escalationLevel(nudges, istMs('2026-08-21', '14:30'))).toBe(0);
  });

  it('ignores failed sends', () => {
    const nudges = [nudge('reminder', '11:00', { habit_id: 'water', status: 'failed' })];
    expect(escalationLevel(nudges, istMs('2026-08-21', '09:00'))).toBe(0);
  });
});
