import { hmToMin } from '../../src/core/clock';
import type { Habit, HabitLog, Nudge, Snapshot, Streak, User } from '../../src/core/types';
import { istMs } from './fakes';

// Friday. Vitamin (anchor 2026-08-15, every 2 days) IS due: 15, 17, 19, 21.
export const DAY = '2026-08-21';
export const WEEK = '2026-08-17'; // that week's Monday

export function mkUser(over: Partial<User> = {}): User {
  return {
    id: 'gf',
    wa_id: '919900000001',
    role: 'player',
    display_name: 'Her',
    tz: 'Asia/Kolkata',
    persona: 'sassy',
    language: 'en',
    wake_start: '09:00',
    wake_end: '21:00',
    soft_until: null,
    paused_until: null,
    last_inbound_at: istMs(DAY, '08:00'),
    convo_state: null,
    about: null,
    created_at: 0,
    ...over,
  };
}

export function mkWater(over: Partial<Habit> = {}): Habit {
  return {
    id: 'water',
    user_id: 'gf',
    name: 'Water',
    emoji: '💧',
    active: 1,
    schedule_type: 'daily',
    interval_days: null,
    anchor_date: null,
    weekly_days: null,
    anchor_time: null,
    window_start: '09:00',
    window_end: '21:00',
    target_count: 8,
    unit: 'glass',
    pacing: 'spread',
    nag_max_per_day: 5,
    nag_min_gap_min: 45,
    points: 10,
    streak_enabled: 1,
    ...over,
  };
}

export function mkVitamin(over: Partial<Habit> = {}): Habit {
  return {
    ...mkWater(),
    id: 'multivitamin',
    name: 'Multivitamin',
    emoji: '💊',
    schedule_type: 'every_n_days',
    interval_days: 2,
    anchor_date: '2026-08-15',
    anchor_time: '09:30',
    window_start: null,
    window_end: null,
    target_count: 1,
    unit: 'dose',
    pacing: 'once',
    nag_max_per_day: 3,
    nag_min_gap_min: 90,
    ...over,
  };
}

export function mkStreak(key: string, current: number): Streak {
  return { key, user_id: 'gf', current, best: current, last_counted_day: null };
}

export function nudge(kind: Nudge['kind'], hm: string, over: Partial<Nudge> = {}): Nudge {
  return {
    user_id: 'gf',
    habit_id: null,
    kind,
    local_day: DAY,
    escalation: 0,
    sent_at: istMs(DAY, hm),
    status: 'sent',
    ...over,
  };
}

export function log(habitId: string, count: number, hm: string, status: 'done' | 'skipped' = 'done'): HabitLog {
  return {
    habit_id: habitId,
    user_id: 'gf',
    local_day: DAY,
    count,
    status,
    source: 'text',
    logged_at: istMs(DAY, hm),
  };
}

export function mkSnap(hm: string, over: Partial<Snapshot> = {}): Snapshot {
  return {
    now: istMs(DAY, hm),
    localDay: DAY,
    localMin: hmToMin(hm),
    weekKey: WEEK,
    isSunday: false,
    player: mkUser(),
    habits: [mkWater(), mkVitamin()],
    logsToday: [],
    nudgesToday: [],
    snoozesToday: [],
    streaks: {},
    windowOpen: true,
    lastReportWeek: '',
    unannouncedCoupons: [],
    ...over,
  };
}
