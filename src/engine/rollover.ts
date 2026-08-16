import { CONFIG } from '../env';
import type { Habit, HabitLog, Milestone, Streak } from '../core/types';
import { isDueOn } from './schedule';
import { isComplete, isSkipped } from './game';

export interface RolloverInput {
  day: string; // the local day being closed (yesterday)
  userId: string;
  habits: Habit[];
  logs: HabitLog[]; // logs for that day
  streaks: Record<string, Streak>;
  softDay: boolean;
}

export interface RolloverResult {
  streakUpdates: Streak[];
  perfectDay: boolean | null; // null = nothing was due
  milestones: Milestone[];
  ledger: { delta: number; reason: 'perfect_day'; ref: string }[];
}

/**
 * Close out a day: extend/freeze/reset streaks, detect milestones, award
 * perfect-day points. Rules: complete -> +1; skipped or soft day -> freeze;
 * otherwise -> reset. Non-due days never touch a habit's streak.
 */
export function rolloverDay(input: RolloverInput): RolloverResult {
  const { day, userId, habits, logs, streaks, softDay } = input;
  const updates: Streak[] = [];
  const milestones: Milestone[] = [];
  const ledger: RolloverResult['ledger'] = [];

  const due = habits.filter((h) => h.active && isDueOn(h, day));
  let allComplete = due.length > 0;
  let anyGraded = false;

  for (const h of due) {
    const complete = isComplete(h, logs.filter((l) => l.habit_id === h.id));
    const skipped = isSkipped(h.id, logs);
    if (!skipped) {
      anyGraded = true;
      if (!complete) allComplete = false;
    }
    if (!h.streak_enabled) continue;

    const s: Streak = streaks[h.id] ?? { key: h.id, user_id: userId, current: 0, best: 0, last_counted_day: null };
    if (s.last_counted_day === day) continue; // already processed
    let next = s.current;
    if (complete) next = s.current + 1;
    else if (skipped || softDay) next = s.current; // freeze
    else next = 0;

    const updated: Streak = {
      ...s,
      current: next,
      best: Math.max(s.best, next),
      last_counted_day: day,
    };
    updates.push(updated);

    if (complete && CONFIG.STREAK_THRESHOLDS.includes(next as (typeof CONFIG.STREAK_THRESHOLDS)[number])) {
      milestones.push({
        key: `${h.id}:streak:${next}`,
        trigger_type: 'streak_milestone',
        habit_id: h.id,
        value: next,
        label: `${next}-day ${h.name} streak`,
      });
    }
  }

  let perfectDay: boolean | null = null;
  if (due.length > 0 && anyGraded) {
    perfectDay = allComplete;
    const ps: Streak = streaks['perfect_day'] ?? {
      key: 'perfect_day',
      user_id: userId,
      current: 0,
      best: 0,
      last_counted_day: null,
    };
    if (ps.last_counted_day !== day) {
      const next = perfectDay ? ps.current + 1 : softDay ? ps.current : 0;
      updates.push({ ...ps, current: next, best: Math.max(ps.best, next), last_counted_day: day });
      if (perfectDay) {
        ledger.push({ delta: CONFIG.PERFECT_DAY_POINTS, reason: 'perfect_day', ref: day });
        if (next === CONFIG.PERFECT_WEEK) {
          milestones.push({
            key: `perfect:streak:${next}`,
            trigger_type: 'perfect_week',
            habit_id: null,
            value: next,
            label: `${next} perfect days in a row`,
          });
        }
      }
    }
  }

  return { streakUpdates: updates, perfectDay, milestones, ledger };
}

/** Repair tool: recompute one habit's streak purely from logs (admin /recount). */
export function recomputeStreak(
  habit: Habit,
  userId: string,
  logsByDay: Map<string, HabitLog[]>,
  daysDescFromYesterday: string[],
): Streak {
  let current = 0;
  let counting = true;
  let best = 0;
  let run = 0;
  // Walk from yesterday backwards; days are due-days only, newest first.
  for (const day of daysDescFromYesterday) {
    if (!isDueOn(habit, day)) continue;
    const logs = logsByDay.get(day) ?? [];
    const complete = isComplete(habit, logs.filter((l) => l.habit_id === habit.id));
    const skipped = isSkipped(habit.id, logs);
    if (complete) {
      run += 1;
      if (counting) current = run;
    } else if (skipped) {
      // freeze: does not extend, does not break
      continue;
    } else {
      counting = false;
      best = Math.max(best, run);
      run = 0;
    }
  }
  best = Math.max(best, run, current);
  return { key: habit.id, user_id: userId, current, best, last_counted_day: daysDescFromYesterday[0] ?? null };
}
