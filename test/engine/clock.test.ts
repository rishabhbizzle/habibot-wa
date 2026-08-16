import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  dayOfWeekMon0,
  epochFromLocal,
  hmToMin,
  localDay,
  localHM,
  minutesIntoDay,
  weekKey,
  weekdaySlug,
} from '../../src/core/clock';

const IST = 'Asia/Kolkata';

describe('clock', () => {
  it('converts UTC to IST local day and time', () => {
    const d = new Date('2026-08-15T10:00:00Z'); // 15:30 IST
    expect(localDay(d, IST)).toBe('2026-08-15');
    expect(localHM(d, IST)).toBe('15:30');
    expect(minutesIntoDay(d, IST)).toBe(15 * 60 + 30);
  });

  it('rolls the local day across midnight IST', () => {
    const d = new Date('2026-08-15T20:00:00Z'); // 01:30 IST next day
    expect(localDay(d, IST)).toBe('2026-08-16');
    expect(localHM(d, IST)).toBe('01:30');
  });

  it('does calendar arithmetic on day strings', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(daysBetween('2026-08-15', '2026-08-21')).toBe(6);
  });

  it('computes week keys (Monday) and weekday slugs', () => {
    expect(dayOfWeekMon0('2026-08-17')).toBe(0); // Monday
    expect(weekKey('2026-08-21')).toBe('2026-08-17');
    expect(weekKey('2026-08-17')).toBe('2026-08-17');
    expect(weekKey('2026-08-23')).toBe('2026-08-17'); // Sunday belongs to the same week
    expect(weekdaySlug('2026-08-21')).toBe('fri');
    expect(weekdaySlug('2026-08-15')).toBe('sat');
  });

  it('parses HH:MM', () => {
    expect(hmToMin('09:00')).toBe(540);
    expect(hmToMin('21:00')).toBe(1260);
  });

  it('inverts local wall-clock time to a UTC epoch', () => {
    // 17:00 IST = 11:30 UTC
    expect(epochFromLocal('2026-08-21', '17:00', IST)).toBe(Date.parse('2026-08-21T11:30:00Z'));
    // 01:00 IST = 19:30 UTC the previous day
    expect(epochFromLocal('2026-08-21', '01:00', IST)).toBe(Date.parse('2026-08-20T19:30:00Z'));
    // round-trips with localDay/localHM
    const e = epochFromLocal('2026-12-31', '23:45', IST);
    expect(localDay(new Date(e), IST)).toBe('2026-12-31');
    expect(localHM(new Date(e), IST)).toBe('23:45');
  });
});
