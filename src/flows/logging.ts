import { localDay, minutesIntoDay, hmToMin } from '../core/clock';
import { encodeBtn } from '../core/ids';
import type { Facts, Habit, Intent, User } from '../core/types';
import { repo } from '../db/repo';
import { applyLog, doneUnits, isComplete } from '../engine/game';
import { isDueOn } from '../engine/schedule';
import type { TickDeps } from '../scheduler/tick';
import type { ButtonSpec } from '../wa/sender';
import { cancelReminder, listReminders, setReminder } from './reminders';
import { sendPlain, sendReply } from './reply';
import { startRedeem } from './redeem';
import { buildStatusText } from './status';

export interface LogOutcome {
  ok: boolean;
  alreadyDone?: boolean;
  completedNow: boolean;
  newDone: number;
  habit: Habit | null;
}

/** Persist a "done" log + points; no messaging. Shared by her, buttons, and admin. */
export async function performLog(
  deps: TickDeps,
  user: User,
  habitId: string,
  count: number,
  source: 'button' | 'text' | 'admin',
  now: Date,
): Promise<LogOutcome> {
  const habit = await repo.getHabit(deps.db, habitId);
  if (!habit || habit.user_id !== user.id) return { ok: false, completedNow: false, newDone: 0, habit: null };
  const day = localDay(now, user.tz);
  const logsToday = await repo.logsForDay(deps.db, user.id, day);
  const r = applyLog(habit, logsToday, count);
  if (!r.accepted) return { ok: true, alreadyDone: true, completedNow: false, newDone: r.newDone, habit };

  const stmts = [
    repo.insertLogStmt({
      habit_id: habit.id,
      user_id: user.id,
      local_day: day,
      count: r.cappedCount,
      status: 'done',
      source,
      logged_at: now.getTime(),
    }),
    ...r.ledger.map((l) => repo.insertLedgerStmt(user.id, l.delta, l.reason, l.ref, day, now.getTime())),
  ];
  await deps.db.batch(stmts);
  return { ok: true, completedNow: r.completedNow, newDone: r.newDone, habit };
}

function plusOneButton(habit: Habit, day: string): ButtonSpec {
  return {
    id: encodeBtn({ action: 'done', habitId: habit.id, day }),
    title: habit.pacing === 'spread' ? `${habit.emoji} +1 ${habit.unit}`.slice(0, 20) : `${habit.emoji} Done`.slice(0, 20),
  };
}

async function pendingHabits(deps: TickDeps, user: User, day: string): Promise<Habit[]> {
  const [habits, logs] = await Promise.all([
    repo.getActiveHabits(deps.db, user.id),
    repo.logsForDay(deps.db, user.id, day),
  ]);
  return habits.filter(
    (h) =>
      isDueOn(h, day) &&
      !logs.some((l) => l.habit_id === h.id && l.status === 'skipped') &&
      !isComplete(h, logs.filter((l) => l.habit_id === h.id)),
  );
}

/** Epoch ms of tomorrow's wake_start in the user's tz (soft mode auto-expiry). */
export function nextWakeStartMs(nowMs: number, user: User): number {
  const nowMin = minutesIntoDay(new Date(nowMs), user.tz);
  const deltaMin = 24 * 60 - nowMin + hmToMin(user.wake_start);
  return nowMs + deltaMin * 60_000;
}

export async function applyIntent(
  deps: TickDeps,
  user: User,
  intent: Intent,
  now: Date,
  source: 'button' | 'text' = 'text',
): Promise<void> {
  const nowMs = now.getTime();
  const day = localDay(now, user.tz);

  switch (intent.type) {
    case 'log_habit': {
      const out = await performLog(deps, user, intent.habit, intent.count, source, now);
      if (!out.ok || !out.habit) {
        await sendReply(deps, user, 'didnt_understand', {}, nowMs);
        return;
      }
      const h = out.habit;
      const facts: Facts = {
        habit: h.name,
        emoji: h.emoji,
        done: out.newDone,
        target: h.target_count,
        remaining: Math.max(h.target_count - out.newDone, 0),
        unit: h.unit,
        points: h.points,
      };
      if (out.alreadyDone) {
        await sendReply(deps, user, 'already_done', facts, nowMs);
      } else if (out.completedNow) {
        await sendReply(deps, user, 'habit_complete', facts, nowMs);
      } else {
        const buttons = h.pacing === 'spread' ? [plusOneButton(h, day)] : undefined;
        await sendReply(deps, user, 'praise_log', facts, nowMs, buttons);
      }
      return;
    }

    case 'snooze': {
      let habitId = intent.habit;
      if (!habitId) {
        const pending = await pendingHabits(deps, user, day);
        habitId = pending[0]?.id ?? null;
      }
      if (!habitId) {
        await sendPlain(deps, user, 'Nothing pending to snooze — you’re all caught up ✅', nowMs);
        return;
      }
      const habit = await repo.getHabit(deps.db, habitId);
      await repo.upsertSnooze(deps.db, { habit_id: habitId, local_day: day, until: nowMs + intent.minutes * 60_000 });
      await sendReply(deps, user, 'snooze_ack', { habit: habit?.name ?? habitId, minutes: intent.minutes }, nowMs);
      return;
    }

    case 'skip_today': {
      const habit = await repo.getHabit(deps.db, intent.habit);
      if (!habit) {
        await sendReply(deps, user, 'didnt_understand', {}, nowMs);
        return;
      }
      await deps.db.batch([
        repo.insertLogStmt({
          habit_id: habit.id,
          user_id: user.id,
          local_day: day,
          count: 0,
          status: 'skipped',
          source,
          logged_at: nowMs,
        }),
      ]);
      await sendReply(deps, user, 'skip_ack', { habit: habit.name, emoji: habit.emoji }, nowMs);
      return;
    }

    case 'set_mode': {
      if (intent.mode === 'soft') {
        await repo.updateUser(deps.db, user.id, { soft_until: nextWakeStartMs(nowMs, user) });
        await sendReply(deps, user, 'soft_ack', {}, nowMs);
      } else {
        await repo.updateUser(deps.db, user.id, { soft_until: null });
        await sendReply(deps, user, 'smalltalk_reply', { event: 'back_to_normal_mode', gist: 'she asked for normal mode back' }, nowMs);
      }
      return;
    }

    case 'set_persona': {
      const fields: Record<string, unknown> = {};
      if (intent.vibe) fields.persona = intent.vibe;
      if (intent.language) fields.language = intent.language;
      if (Object.keys(fields).length === 0) {
        await sendReply(deps, user, 'didnt_understand', {}, nowMs);
        return;
      }
      await repo.updateUser(deps.db, user.id, fields as Partial<User>);
      const updated = { ...user, ...(fields as Partial<User>) } as User;
      await sendReply(
        deps,
        updated,
        'smalltalk_reply',
        { event: 'persona_switched', note: 'introduce your (possibly new) vibe in one short line' },
        nowMs,
      );
      return;
    }

    case 'set_reminder':
      await setReminder(deps, user, intent.text, intent.dueLocal, now);
      return;

    case 'list_reminders':
      await listReminders(deps, user, now);
      return;

    case 'cancel_reminder':
      await cancelReminder(deps, user, intent.id, now);
      return;

    case 'redeem_coupon':
      await startRedeem(deps, user, now);
      return;

    case 'get_status': {
      const text = await buildStatusText(deps, user, now);
      await sendPlain(deps, user, text, nowMs);
      return;
    }

    case 'smalltalk':
      await sendReply(deps, user, 'smalltalk_reply', { herMessage: intent.gist }, nowMs);
      return;

    case 'set_window': // onboarding-only; ignore elsewhere
    case 'unclear':
    default: {
      const pending = await pendingHabits(deps, user, day);
      const buttons = pending.slice(0, 3).map((h) => plusOneButton(h, day));
      await sendReply(deps, user, 'didnt_understand', {}, nowMs, buttons.length ? buttons : undefined);
      return;
    }
  }
}
