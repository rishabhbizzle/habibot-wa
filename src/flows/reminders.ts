import { epochFromLocal, localDay, localHM } from '../core/clock';
import type { User } from '../core/types';
import { repo } from '../db/repo';
import type { TickDeps } from '../scheduler/tick';
import { windowOpen } from '../scheduler/snapshot';
import { sendPlain, sendReply } from './reply';

const MAX_PENDING = 20;
const DUE_LOCAL = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/;

/** Human label like "today 17:00" / "tomorrow 09:30" / "Aug 21, 09:30". */
function whenLabel(dueAt: number, nowMs: number, tz: string): string {
  const dueDay = localDay(new Date(dueAt), tz);
  const nowDay = localDay(new Date(nowMs), tz);
  const hm = localHM(new Date(dueAt), tz);
  if (dueDay === nowDay) return `today ${hm}`;
  const tomorrow = localDay(new Date(nowMs + 86400000), tz);
  if (dueDay === tomorrow) return `tomorrow ${hm}`;
  return `${dueDay} ${hm}`;
}

export async function setReminder(deps: TickDeps, user: User, text: string, dueLocal: string, now: Date): Promise<void> {
  const nowMs = now.getTime();
  const cleaned = text.trim().slice(0, 200);
  const m = dueLocal.match(DUE_LOCAL);
  if (!cleaned || !m) {
    await sendPlain(deps, user, 'Tell me what and when, e.g. "remind me to call mom at 5pm" 🙂', nowMs);
    return;
  }
  let dueAt = epochFromLocal(m[1], m[2], user.tz);
  if (dueAt <= nowMs) dueAt += 86400000; // "remind me at 9" said at 22:00 -> tomorrow 9
  if (dueAt <= nowMs || dueAt > nowMs + 366 * 86400000) {
    await sendPlain(deps, user, 'That time confused me a little — try something like "tomorrow 9am" or "today 6pm".', nowMs);
    return;
  }
  const pending = await repo.pendingReminders(deps.db, user.id);
  if (pending.length >= MAX_PENDING) {
    await sendPlain(deps, user, `You already have ${MAX_PENDING} reminders queued — say "reminders" to see and cancel some first.`, nowMs);
    return;
  }
  await repo.insertReminder(deps.db, user.id, cleaned, dueAt, nowMs);
  await sendReply(deps, user, 'reminder_set', { text: cleaned, when: whenLabel(dueAt, nowMs, user.tz) }, nowMs);
}

export async function listReminders(deps: TickDeps, user: User, now: Date): Promise<void> {
  const nowMs = now.getTime();
  const pending = await repo.pendingReminders(deps.db, user.id);
  if (pending.length === 0) {
    await sendPlain(deps, user, 'No reminders queued. Try "remind me to call mom at 5pm" ⏰', nowMs);
    return;
  }
  const lines = pending.map((r) => `#${r.id} — ${r.text} — ${whenLabel(r.due_at, nowMs, user.tz)}`);
  await sendPlain(deps, user, `⏰ Your reminders:\n${lines.join('\n')}\n\n(cancel one with "cancel reminder 3")`, nowMs);
}

export async function cancelReminder(deps: TickDeps, user: User, id: number, now: Date): Promise<void> {
  const ok = await repo.cancelReminder(deps.db, user.id, id);
  await sendPlain(deps, user, ok ? `Cancelled #${id} ✅` : `Couldn't find a pending reminder #${id} — say "reminders" to see the list.`, now.getTime());
}

/**
 * Called from every tick. Her own reminders bypass soft mode, pause, and the
 * daily message caps — she asked for them. Only a closed 24h window delays
 * delivery (retries next tick).
 */
export async function fireDueReminders(deps: TickDeps, player: User, now: Date): Promise<number> {
  const nowMs = now.getTime();
  if (!windowOpen(player, nowMs)) return 0;
  const due = await repo.dueReminders(deps.db, player.id, nowMs);
  let fired = 0;
  for (const r of due) {
    // Mark first so a mid-send crash can't double-fire; an ordinary send
    // failure reverts to pending so the reminder retries next tick.
    await repo.markReminderSent(deps.db, r.id);
    const lateMin = Math.round((nowMs - r.due_at) / 60000);
    const { ok } = await sendReply(
      deps,
      player,
      'reminder_fire',
      { text: r.text, setFor: localHM(new Date(r.due_at), player.tz), late: lateMin > 30 },
      nowMs,
    );
    if (!ok) {
      await deps.db.run("UPDATE reminders SET status = 'pending' WHERE id = ?", r.id);
      continue;
    }
    fired += 1;
  }
  return fired;
}
