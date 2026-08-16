import type { Habit, HabitLog, Intent } from '../core/types';
import { doneUnits, isComplete } from '../engine/game';

const DONE_RE = /^(done|did it|took it|ho ?gaya|le liya|pee? liya|pi liya|finished|✅|👍)\.?!?$/i;
const SNOOZE_RE = /^(snooze|later|baad me(in)?|thodi der me(in)?)\.?!?$/i;
const SKIP_RE = /^(skip|skip today|not today|aaj nahi)\.?!?$/i;
const SOFT_RE = /(rough day|bad day|tough day|be nice today|go easy|leave me alone today|not feeling (it|well|good)|mann nahi)/i;
const STATUS_RE = /^(status|progress|how am i doing|score|points)\??$/i;
const REDEEM_RE = /^redeem\.?!?$/i;

/**
 * Deterministic pre-pass — the hot paths never touch the LLM. Returns null
 * when the message genuinely needs language understanding.
 */
export function keywordIntent(text: string, habits: Habit[], logsToday: HabitLog[]): Intent | null {
  const t = text.trim();
  if (!t) return { type: 'unclear' };

  if (REDEEM_RE.test(t)) return { type: 'redeem_coupon' };
  if (STATUS_RE.test(t)) return { type: 'get_status' };
  if (/^(my )?reminders\??$/i.test(t)) return { type: 'list_reminders' };
  const cancel = t.match(/^cancel reminder #?(\d{1,6})$/i);
  if (cancel) return { type: 'cancel_reminder', id: Number(cancel[1]) };
  if (/remind/i.test(t)) return null; // always let the LLM parse reminder times
  if (SOFT_RE.test(t)) return { type: 'set_mode', mode: 'soft', reason: t };

  const pending = habits.filter((h) => h.active === 1 && !isComplete(h, logsToday.filter((l) => l.habit_id === h.id)));

  // Bare small number while a countable habit is pending -> log that many units.
  const num = t.match(/^(\d{1,2})$/);
  if (num) {
    const spread = pending.find((h) => h.pacing === 'spread');
    if (spread) return { type: 'log_habit', habit: spread.id, count: Number(num[1]) };
  }

  if (DONE_RE.test(t)) {
    if (pending.length === 1) return { type: 'log_habit', habit: pending[0].id, count: 1 };
    // several pending — pick the 'once' habit if exactly one (a bare "done"
    // almost always means the vitamin, not one glass of water)
    const onces = pending.filter((h) => h.pacing === 'once');
    if (onces.length === 1) return { type: 'log_habit', habit: onces[0].id, count: 1 };
    return null; // ambiguous — let the LLM decide
  }

  if (SNOOZE_RE.test(t)) {
    if (pending.length >= 1) return { type: 'snooze', habit: pending.length === 1 ? pending[0].id : null, minutes: 60 };
  }

  if (SKIP_RE.test(t) && pending.length === 1) return { type: 'skip_today', habit: pending[0].id };

  return null;
}
