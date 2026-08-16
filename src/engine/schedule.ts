import { daysBetween, hmToMin, weekdaySlug } from '../core/clock';
import type { Habit, User } from '../core/types';

export function isDueOn(habit: Habit, day: string): boolean {
  switch (habit.schedule_type) {
    case 'daily':
      return true;
    case 'every_n_days': {
      if (!habit.anchor_date || !habit.interval_days) return true;
      const d = daysBetween(habit.anchor_date, day);
      return d >= 0 && d % habit.interval_days === 0;
    }
    case 'weekly': {
      if (!habit.weekly_days) return false;
      return habit.weekly_days.split(',').map((s) => s.trim()).includes(weekdaySlug(day));
    }
  }
}

/** Habit window intersected with the user's wake window, in minutes-into-day. */
export function dueWindow(habit: Habit, user: User): { startMin: number; endMin: number } {
  const wakeStart = hmToMin(user.wake_start);
  const wakeEnd = hmToMin(user.wake_end);
  const start = Math.max(habit.window_start ? hmToMin(habit.window_start) : wakeStart, wakeStart);
  const end = Math.min(habit.window_end ? hmToMin(habit.window_end) : wakeEnd, wakeEnd);
  if (end <= start) return { startMin: wakeStart, endMin: wakeEnd };
  return { startMin: start, endMin: end };
}
