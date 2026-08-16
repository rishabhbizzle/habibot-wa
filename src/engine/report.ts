import { addDays, daysBetween, dayOfWeekMon0 } from '../core/clock';
import { pluralize } from '../core/text';
import type { ChallengeRule, Habit, HabitLog, Streak } from '../core/types';
import { isDueOn } from './schedule';
import { doneUnits, isComplete, isSkipped } from './game';

export interface WeeklyInput {
  weekStart: string; // Monday
  days: string[]; // the 7 local days, Mon..Sun
  habits: Habit[];
  logs: HabitLog[];
  streaks: Record<string, Streak>;
  pointsEarned: number;
  challenge: { title: string; rule: ChallengeRule; reward_points: number } | null;
}

export interface WeeklyReport {
  grade: string;
  overallPct: number;
  perHabit: { id: string; name: string; emoji: string; pct: number; detail: string }[];
  perfectDays: number;
  bestDay: string | null;
  pointsEarned: number;
  challengeResult: 'completed' | 'failed' | null;
  challengeTitle: string | null;
  nextChallenge: { title: string; rule: ChallengeRule; reward_points: number };
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function grade(pct: number): string {
  if (pct >= 95) return 'A+';
  if (pct >= 90) return 'A';
  if (pct >= 82) return 'B+';
  if (pct >= 75) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 40) return 'D';
  return 'F';
}

export function weeklyReport(input: WeeklyInput): WeeklyReport {
  const { days, habits, logs, challenge } = input;
  const byDay = new Map<string, HabitLog[]>();
  for (const d of days) byDay.set(d, []);
  for (const l of logs) byDay.get(l.local_day)?.push(l);

  const perHabit: WeeklyReport['perHabit'] = [];
  for (const h of habits.filter((x) => x.active)) {
    let dueDays = 0;
    let unitsDone = 0;
    let unitsTarget = 0;
    let completedDays = 0;
    for (const d of days) {
      if (!isDueOn(h, d)) continue;
      const dayLogs = byDay.get(d) ?? [];
      if (isSkipped(h.id, dayLogs)) continue; // skips leave the denominator
      dueDays += 1;
      unitsTarget += h.target_count;
      unitsDone += Math.min(doneUnits(h.id, dayLogs), h.target_count);
      if (isComplete(h, dayLogs.filter((l) => l.habit_id === h.id))) completedDays += 1;
    }
    const pct =
      dueDays === 0
        ? 100
        : h.pacing === 'spread'
          ? Math.round((unitsDone / Math.max(unitsTarget, 1)) * 100)
          : Math.round((completedDays / dueDays) * 100);
    const detail =
      h.pacing === 'spread'
        ? `${unitsDone}/${unitsTarget} ${pluralize(h.unit, unitsTarget)}`
        : `${completedDays}/${dueDays} days`;
    perHabit.push({ id: h.id, name: h.name, emoji: h.emoji, pct, detail });
  }

  const overallPct =
    perHabit.length === 0 ? 100 : Math.round(perHabit.reduce((s, h) => s + h.pct, 0) / perHabit.length);

  // Perfect days + best day
  let perfectDays = 0;
  let bestDay: string | null = null;
  let bestScore = -1;
  for (const d of days) {
    const dayLogs = byDay.get(d) ?? [];
    const due = habits.filter((h) => h.active && isDueOn(h, d) && !isSkipped(h.id, dayLogs));
    if (due.length === 0) continue;
    let score = 0;
    let all = true;
    for (const h of due) {
      const ratio = Math.min(doneUnits(h.id, dayLogs) / h.target_count, 1);
      score += ratio;
      if (ratio < 1) all = false;
    }
    score /= due.length;
    if (all) perfectDays += 1;
    if (score > bestScore) {
      bestScore = score;
      bestDay = WEEKDAY_LABELS[dayOfWeekMon0(d)];
    }
  }

  // Challenge grading
  let challengeResult: WeeklyReport['challengeResult'] = null;
  if (challenge) {
    const r = challenge.rule;
    if (r.type === 'habit_days') {
      const h = habits.find((x) => x.id === r.habit_id);
      let daysHit = 0;
      if (h) {
        for (const d of days) {
          const dayLogs = byDay.get(d) ?? [];
          if (isDueOn(h, d) && isComplete(h, dayLogs.filter((l) => l.habit_id === h.id))) daysHit += 1;
        }
      }
      challengeResult = daysHit >= r.days ? 'completed' : 'failed';
    }
  }

  return {
    grade: grade(overallPct),
    overallPct,
    perHabit,
    perfectDays,
    bestDay,
    pointsEarned: input.pointsEarned,
    challengeResult,
    challengeTitle: challenge?.title ?? null,
    nextChallenge: nextChallenge(input.weekStart, habits),
  };
}

/** Deterministic rotation of weekly mini-challenges (keyed off the week index). */
export function nextChallenge(
  weekStart: string,
  habits: Habit[],
): { title: string; rule: ChallengeRule; reward_points: number } {
  const spread = habits.find((h) => h.active && h.pacing === 'spread');
  const once = habits.find((h) => h.active && h.pacing === 'once');
  const list: { title: string; rule: ChallengeRule; reward_points: number }[] = [];
  if (spread) {
    list.push(
      {
        title: `Hit your full ${spread.name.toLowerCase()} goal on 5 days this week`,
        rule: { type: 'habit_days', habit_id: spread.id, days: 5 },
        reward_points: 30,
      },
      {
        title: `Full ${spread.name.toLowerCase()} goal on 6 days — one rest day allowed`,
        rule: { type: 'habit_days', habit_id: spread.id, days: 6 },
        reward_points: 40,
      },
    );
  }
  if (once) {
    // "Don't miss a day" must grade against the actual due days NEXT week.
    const nextWeek = Array.from({ length: 7 }, (_, i) => addDays(weekStart, 7 + i));
    const dueDays = nextWeek.filter((d) => isDueOn(once, d)).length;
    if (dueDays > 0) {
      list.push({
        title: `Don't miss a single ${once.name.toLowerCase()} day this week (${dueDays} due)`,
        rule: { type: 'habit_days', habit_id: once.id, days: dueDays },
        reward_points: 25,
      });
    }
  }
  if (list.length === 0) {
    list.push({
      title: 'Log something every day this week',
      rule: { type: 'habit_days', habit_id: habits[0]?.id ?? 'water', days: 5 },
      reward_points: 25,
    });
  }
  const weekIndex = Math.floor(daysBetween('2026-01-05', weekStart) / 7); // 2026-01-05 is a Monday
  return list[((weekIndex % list.length) + list.length) % list.length];
}
