import { localDay, localHM, weekdayShort } from '../core/clock';
import type { Habit, HabitLog, Intent, MessageRow, User } from '../core/types';
import type { Llm } from '../llm/anthropic';
import { keywordIntent } from './keywords';
import { intentTools } from './schema';

const DUE_LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function toIntent(name: string, input: Record<string, unknown>): Intent {
  switch (name) {
    case 'log_habit':
      return { type: 'log_habit', habit: String(input.habit ?? ''), count: clampInt(input.count, 1, 1, 20) };
    case 'set_reminder': {
      const dueLocal = String(input.due_local ?? '');
      if (!DUE_LOCAL.test(dueLocal)) return { type: 'unclear' };
      return { type: 'set_reminder', text: String(input.text ?? '').trim(), dueLocal };
    }
    case 'list_reminders':
      return { type: 'list_reminders' };
    case 'cancel_reminder':
      return { type: 'cancel_reminder', id: clampInt(input.id, 0, 0, 999999) };
    case 'snooze':
      return { type: 'snooze', habit: input.habit ? String(input.habit) : null, minutes: clampInt(input.minutes, 60, 10, 720) };
    case 'skip_today':
      return { type: 'skip_today', habit: String(input.habit ?? '') };
    case 'set_mode':
      return { type: 'set_mode', mode: input.mode === 'normal' ? 'normal' : 'soft', reason: input.reason ? String(input.reason) : undefined };
    case 'set_persona': {
      const vibe = ['sassy', 'sweet', 'pet'].includes(String(input.vibe)) ? (String(input.vibe) as 'sassy' | 'sweet' | 'pet') : undefined;
      const language = ['en', 'hinglish'].includes(String(input.language)) ? (String(input.language) as 'en' | 'hinglish') : undefined;
      return { type: 'set_persona', vibe, language };
    }
    case 'redeem_coupon':
      return { type: 'redeem_coupon', hint: input.hint ? String(input.hint) : undefined };
    case 'get_status':
      return { type: 'get_status' };
    case 'smalltalk':
      return { type: 'smalltalk', gist: String(input.gist ?? '') };
    default:
      return { type: 'unclear' };
  }
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.round(n), min), max);
}

export async function parseIntent(
  text: string,
  user: User,
  habits: Habit[],
  logsToday: HabitLog[],
  recent: MessageRow[],
  llm: Llm | null,
  now: Date,
): Promise<Intent> {
  const kw = keywordIntent(text, habits, logsToday);
  if (kw) return kw;
  if (!llm) return { type: 'unclear' };

  const habitLines = habits
    .map((h) => `- ${h.id}: ${h.name}, target ${h.target_count} ${h.unit}(s)/day (${h.pacing})`)
    .join('\n');
  const history = recent
    .slice(0, 6)
    .reverse()
    .map((m) => `${m.direction === 'in' ? 'HER' : 'BOT'}: ${(m.body ?? '').slice(0, 80)}`)
    .join('\n');
  const nowLine = `${localDay(now, user.tz)} ${localHM(now, user.tz)} (${weekdayShort(now, user.tz)}), timezone ${user.tz}`;
  const system = `Classify one WhatsApp message from the user of a habit bot into exactly one tool call. Current local datetime: ${nowLine}. Her habits:\n${habitLines}\nHinglish is common ("ho gaya" = done, "paani" = water, "yaad dilana" = remind). Prefer log_habit when she reports doing something; set_reminder when she asks to be reminded (compute due_local from the current datetime — next upcoming occurrence; bare hours like "at 5" mean the next 5 o'clock); smalltalk for everything conversational; unclear only as a last resort.`;
  const userMsg = `RECENT CONVERSATION:\n${history || '(none)'}\n\nHER MESSAGE: ${text}`;

  try {
    const res = await llm.toolCall(system, userMsg, intentTools(habits), 700);
    if (!res) return { type: 'unclear' };
    const intent = toIntent(res.name, res.input);
    // Guard hallucinated habit ids.
    if ((intent.type === 'log_habit' || intent.type === 'skip_today') && !habits.some((h) => h.id === intent.habit)) {
      return { type: 'unclear' };
    }
    if (intent.type === 'snooze' && intent.habit && !habits.some((h) => h.id === intent.habit)) {
      return { type: 'snooze', habit: null, minutes: intent.minutes };
    }
    return intent;
  } catch {
    return { type: 'unclear' };
  }
}
