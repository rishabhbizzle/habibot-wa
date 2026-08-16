import { CONFIG } from '../env';
import type { Habit, HabitLog } from '../core/types';

export function doneUnits(habitId: string, logs: HabitLog[]): number {
  return logs
    .filter((l) => l.habit_id === habitId && l.status === 'done')
    .reduce((s, l) => s + l.count, 0);
}

export function isSkipped(habitId: string, logs: HabitLog[]): boolean {
  return logs.some((l) => l.habit_id === habitId && l.status === 'skipped');
}

export function isComplete(habit: Habit, logs: HabitLog[]): boolean {
  return doneUnits(habit.id, logs) >= habit.target_count;
}

export interface ApplyLogResult {
  accepted: boolean;
  cappedCount: number;
  newDone: number;
  completedNow: boolean;
  ledger: { delta: number; reason: 'habit_log' | 'habit_complete'; ref: string }[];
}

/** Pure state transition for one "done" log. Idempotence guards live here. */
export function applyLog(habit: Habit, logsToday: HabitLog[], count: number): ApplyLogResult {
  const before = doneUnits(habit.id, logsToday);
  const hardCap = habit.pacing === 'spread' ? habit.target_count + 2 : habit.target_count;
  if (before >= hardCap) {
    return { accepted: false, cappedCount: 0, newDone: before, completedNow: false, ledger: [] };
  }
  const capped = Math.max(1, Math.min(count, hardCap - before));
  const newDone = before + capped;
  const completedNow = before < habit.target_count && newDone >= habit.target_count;
  const ledger: ApplyLogResult['ledger'] = [];
  if (habit.pacing === 'spread') {
    ledger.push({ delta: CONFIG.POINT_PER_UNIT * capped, reason: 'habit_log', ref: habit.id });
  }
  if (completedNow) {
    ledger.push({ delta: habit.points, reason: 'habit_complete', ref: habit.id });
  }
  return { accepted: true, cappedCount: capped, newDone, completedNow, ledger };
}
