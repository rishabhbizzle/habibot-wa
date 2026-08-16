import { hmToMin } from '../core/clock';
import { pluralize } from '../core/text';
import type { Facts, Habit, Snapshot, TickDecision, User } from '../core/types';
import { CONFIG } from '../env';
import { escalationLevel } from '../engine/escalation';
import { doneUnits, isComplete, isSkipped } from '../engine/game';
import { waterDecision } from '../engine/pacing';
import { dueWindow, isDueOn } from '../engine/schedule';

export function isSoft(user: User, nowMs: number): boolean {
  return user.soft_until !== null && user.soft_until > nowMs;
}

/**
 * THE brain. Pure: (snapshot) -> at most one proactive decision per tick.
 * Every suppression rule lives here so `simulate.ts` and the golden-day tests
 * exercise production behavior byte-for-byte.
 */
export function decide(s: Snapshot): TickDecision[] {
  const u = s.player;
  if (!u.persona) return [];
  if (u.paused_until !== null && u.paused_until > s.now) return [];

  const wakeStart = hmToMin(u.wake_start);
  const wakeEnd = hmToMin(u.wake_end);
  if (s.localMin < wakeStart || s.localMin >= wakeEnd) return [];

  const soft = isSoft(u, s.now);
  const sent = s.nudgesToday.filter((n) => n.status === 'sent');
  const cap = soft ? CONFIG.SOFT_MAX_NUDGES : CONFIG.MAX_NUDGES_PER_DAY;
  if (sent.length >= cap) return [];

  const level = soft ? 0 : escalationLevel(s.nudgesToday, u.last_inbound_at);
  const due = s.habits.filter((h) => h.active === 1 && isDueOn(h, s.localDay));
  const logsFor = (id: string) => s.logsToday.filter((l) => l.habit_id === id);
  const snoozedNow = (id: string) => s.snoozesToday.some((z) => z.habit_id === id && z.until > s.now);

  // 1. Morning kickoff — the only thing allowed through a closed window (as a template).
  const morningDone = sent.some((n) => n.kind === 'morning' || n.kind === 'template_reopen');
  if (!morningDone) {
    if (!s.windowOpen) return [{ kind: 'template_reopen', habitId: null, escalation: 0, facts: {} }];
    return [morningDecision(s)];
  }
  if (!s.windowOpen) return [];

  // 2. Sunday report card (an hour before window close for early sleepers,
  //    so it stays reachable inside the quiet-hours guard).
  const reportMin = Math.min(CONFIG.REPORT_HOUR_MIN, wakeEnd - 60);
  if (
    s.isSunday &&
    s.localMin >= reportMin &&
    s.lastReportWeek !== s.weekKey &&
    !sent.some((n) => n.kind === 'report')
  ) {
    return [{ kind: 'report', habitId: null, escalation: 0, facts: {} }];
  }

  const habitNudgesFor = (id: string) =>
    sent.filter((n) => n.habit_id === id && (n.kind === 'reminder' || n.kind === 'catchup' || n.kind === 'streak_save'));
  const minutesSinceNudge = (id: string): number | null => {
    const list = habitNudgesFor(id);
    return list.length ? (s.now - Math.max(...list.map((n) => n.sent_at))) / 60000 : null;
  };

  // 3. Streak-save (never in soft mode; keeps the per-habit gap).
  if (!soft && s.localMin >= wakeEnd - CONFIG.STREAK_SAVE_WINDOW_MIN) {
    for (const h of due) {
      if (isComplete(h, logsFor(h.id)) || isSkipped(h.id, s.logsToday) || snoozedNow(h.id)) continue;
      // A fixed-time habit isn't "at risk" before its own hour arrives.
      if (h.pacing === 'once' && h.anchor_time && s.localMin < hmToMin(h.anchor_time)) continue;
      const streak = s.streaks[h.id]?.current ?? 0;
      if (streak < CONFIG.STREAK_SAVE_MIN_STREAK) continue;
      if (sent.some((n) => n.kind === 'streak_save' && n.habit_id === h.id)) continue;
      const since = minutesSinceNudge(h.id);
      if (since !== null && since < CONFIG.PACING_GAP_MIN) continue;
      return [
        {
          kind: 'streak_save',
          habitId: h.id,
          escalation: 0,
          facts: {
            habit: h.name,
            emoji: h.emoji,
            streak,
            done: doneUnits(h.id, s.logsToday),
            target: h.target_count,
            minutesLeft: wakeEnd - s.localMin,
          },
        },
      ];
    }
  }

  // 4/5/6. Per-habit reminders: fixed-time, water pacing, evening catch-up.
  for (const h of due) {
    if (isComplete(h, logsFor(h.id))) continue;
    if (isSkipped(h.id, s.logsToday)) continue;
    if (snoozedNow(h.id)) continue;

    const habNudges = habitNudgesFor(h.id);
    if (habNudges.length >= h.nag_max_per_day) continue;
    if (!soft && habNudges.some((n) => n.escalation >= CONFIG.MAX_ESCALATION)) continue; // final word delivered
    if (soft && habNudges.length >= 1) continue; // one gentle reminder per habit in soft mode

    const minutesSince = minutesSinceNudge(h.id);

    if (h.pacing === 'once') {
      const anchorMin = h.anchor_time ? hmToMin(h.anchor_time) : wakeStart;
      if (s.localMin < anchorMin) continue;
      if (minutesSince !== null && minutesSince < h.nag_min_gap_min) continue;
      return [
        {
          kind: 'reminder',
          habitId: h.id,
          // Global unresponsiveness drives drama, but a habit's own nudge count
          // caps it — its first reminder of the day is never the theatrical one.
          escalation: Math.min(level, habNudges.length),
          facts: { habit: h.name, emoji: h.emoji, unit: h.unit, streak: s.streaks[h.id]?.current ?? 0 },
        },
      ];
    }

    const win = dueWindow(h, u);
    if (!win) continue; // habit window doesn't overlap her wake window
    const done = doneUnits(h.id, s.logsToday);
    const r = waterDecision({
      target: h.target_count,
      done,
      nowMin: s.localMin,
      startMin: win.startMin,
      endMin: win.endMin,
      minutesSinceLastNudge: minutesSince,
      nudgesToday: habNudges.length,
      nagMax: h.nag_max_per_day,
      snoozed: false, // handled above
      catchupSentToday: sent.some((n) => n.kind === 'catchup' && n.habit_id === h.id),
    });
    if (r.action === 'fire') {
      const minutesLeft = win.endMin - s.localMin;
      return [
        {
          kind: r.kind,
          habitId: h.id,
          escalation: Math.min(level, habNudges.length, r.kind === 'catchup' ? 1 : 3),
          facts: {
            habit: h.name,
            emoji: h.emoji,
            done,
            target: h.target_count,
            remaining: h.target_count - done,
            hoursLeft: Math.round(minutesLeft / 6) / 10,
            streak: s.streaks[h.id]?.current ?? 0,
          },
        },
      ];
    }
  }

  return [];
}

/** Also used by the webhook when a template "I'm up!" tap opens the window. */
export function morningDecision(s: Snapshot): TickDecision {
  const due = s.habits.filter((h) => h.active === 1 && isDueOn(h, s.localDay));
  return { kind: 'morning', habitId: null, escalation: 0, facts: morningFacts(s, due) };
}

function morningFacts(s: Snapshot, due: Habit[]): Facts {
  const facts: Facts = {
    name: s.player.display_name,
    dueToday:
      due
        .map((h) => `${h.emoji} ${h.name}${h.target_count > 1 ? ` (${h.target_count} ${pluralize(h.unit, h.target_count)})` : ''}`)
        .join(', ') || 'rest day — nothing due',
    perfectDayStreak: s.streaks['perfect_day']?.current ?? 0,
  };
  const streakBits = due
    .map((h) => ({ h, c: s.streaks[h.id]?.current ?? 0 }))
    .filter((x) => x.c > 0)
    .map((x) => `${x.h.name}: ${x.c} days`);
  if (streakBits.length) facts.streaks = streakBits.join(', ');
  if (s.unannouncedCoupons.length) {
    const titles = s.unannouncedCoupons.map((c) => `"${c.title}"`).join(' + ');
    facts.newRewardEarned = `🎁 New reward unlocked: ${titles} — text "redeem" to claim it!`;
  }
  return facts;
}
