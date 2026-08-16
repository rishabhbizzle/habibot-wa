import { localDay, hmToMin, minToHM } from '../core/clock';
import { pluralize } from '../core/text';
import { parseConvoState, serializeConvoState } from '../core/convo';
import { encodeBtn } from '../core/ids';
import type { ConvoState, Lang, User, Vibe } from '../core/types';
import { repo } from '../db/repo';
import { isDueOn } from '../engine/schedule';
import { WINDOW_TOOL } from '../intents/schema';
import type { TickDeps } from '../scheduler/tick';
import type { InboundMessage } from '../webhook/parse';
import { sendPlain, sendReply } from './reply';

const PERSONA_BTNS = [
  { id: 'ob:persona:sassy', title: 'Sassy 😈' },
  { id: 'ob:persona:sweet', title: 'Sweet 🥰' },
  { id: 'ob:persona:pet', title: 'Pet 🦦' },
];
const LANG_BTNS = [
  { id: 'ob:lang:en', title: 'English' },
  { id: 'ob:lang:hinglish', title: 'Hinglish' },
];
const WIN_BTNS = [
  { id: 'ob:win:09:00-21:00', title: '9am – 9pm' },
  { id: 'ob:win:08:00-22:00', title: '8am – 10pm' },
  { id: 'ob:win:custom', title: 'Custom' },
];

const INTRO =
  'Hi! 👋 I’m your new pocket companion — Rishabh built me just for you, to make daily habits (water, vitamins…) actually fun. Fair warning: there are real-life rewards involved 👀\n\nFirst things first: what should my vibe be?';

function matchPersona(input: string): Vibe | null {
  const t = input.toLowerCase();
  if (t.includes('ob:persona:')) return (t.split(':')[2] as Vibe) ?? null;
  if (/sassy|😈|roast/.test(t)) return 'sassy';
  if (/sweet|🥰|nice|gentle/.test(t)) return 'sweet';
  if (/pet|🦦|otter|bubbles|tamagotchi/.test(t)) return 'pet';
  return null;
}

function matchLang(input: string): Lang | null {
  const t = input.toLowerCase();
  if (t.includes('ob:lang:')) return (t.split(':')[2] as Lang) ?? null;
  if (/hinglish|hindi/.test(t)) return 'hinglish';
  if (/english|eng\b/.test(t)) return 'en';
  return null;
}

export function parseWindowText(input: string): { start: string; end: string } | null {
  const m = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|se|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let sh = Number(m[1]);
  const sm = Number(m[2] ?? 0);
  const sap = m[3]?.toLowerCase();
  let eh = Number(m[4]);
  const em = Number(m[5] ?? 0);
  const eap = m[6]?.toLowerCase();
  if (sap === 'pm' && sh < 12) sh += 12;
  if (sap === 'am' && sh === 12) sh = 0;
  if (eap === 'pm' && eh < 12) eh += 12;
  if (eap === 'am' && eh === 12) eh = 0;
  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (!eap && end <= start && eh < 12) end += 12 * 60; // "10 to 9" -> 10:00-21:00
  // No meridiems and an implausibly short waking window -> the end is pm ("10 se 11" = 10:00-23:00).
  if (!sap && !eap && end - start < 4 * 60 && eh < 12) end += 12 * 60;
  if (end <= start || end - start < 4 * 60 || sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  return { start: minToHM(start), end: minToHM(end) };
}

async function setStep(deps: TickDeps, user: User, step: Extract<ConvoState, { kind: 'onboarding' }>['step']): Promise<void> {
  await repo.updateUser(deps.db, user.id, { convo_state: serializeConvoState({ kind: 'onboarding', step }) });
}

export async function startOnboarding(deps: TickDeps, user: User, now: Date): Promise<void> {
  await sendPlain(deps, user, INTRO, now.getTime(), PERSONA_BTNS);
  await setStep(deps, user, 'persona');
}

export async function onboardingStep(deps: TickDeps, user: User, msg: InboundMessage, now: Date): Promise<void> {
  const nowMs = now.getTime();
  const state = parseConvoState(user.convo_state);
  const step = state?.kind === 'onboarding' ? state.step : 'intro';
  const input = (msg.buttonId ?? msg.text ?? '').trim();

  switch (step) {
    case 'intro':
      await startOnboarding(deps, user, now);
      return;

    case 'persona': {
      const vibe = matchPersona(input);
      if (!vibe) {
        await sendPlain(deps, user, 'Pick one to continue 🙂', nowMs, PERSONA_BTNS);
        return;
      }
      await repo.updateUser(deps.db, user.id, { persona: vibe });
      user.persona = vibe;
      await sendPlain(deps, user, 'Excellent choice. Language preference?', nowMs, LANG_BTNS);
      await setStep(deps, user, 'language');
      return;
    }

    case 'language': {
      const lang = matchLang(input);
      if (!lang) {
        await sendPlain(deps, user, 'English or Hinglish?', nowMs, LANG_BTNS);
        return;
      }
      await repo.updateUser(deps.db, user.id, { language: lang });
      user.language = lang;
      await sendPlain(deps, user, 'Last one: when are you awake? I promise to shut up outside these hours.', nowMs, WIN_BTNS);
      await setStep(deps, user, 'window');
      return;
    }

    case 'window': {
      if (input === 'ob:win:custom') {
        await sendPlain(deps, user, 'Tell me your hours, e.g. "10am to 11pm"', nowMs);
        await setStep(deps, user, 'window_custom');
        return;
      }
      const m = input.match(/^ob:win:(\d{2}:\d{2})-(\d{2}:\d{2})$/);
      const win = m ? { start: m[1], end: m[2] } : parseWindowText(input);
      if (!win) {
        await sendPlain(deps, user, 'Pick one, or tap Custom 🙂', nowMs, WIN_BTNS);
        return;
      }
      await finish(deps, user, win, now);
      return;
    }

    case 'window_custom': {
      let win = parseWindowText(input);
      if (!win && deps.llm) {
        try {
          const res = await deps.llm.toolCall(
            'Extract the daily awake window from the message. Use 24h HH:MM.',
            input,
            [WINDOW_TOOL],
            300,
          );
          if (res?.name === 'set_window') {
            const s = String(res.input.start ?? '');
            const e = String(res.input.end ?? '');
            if (/^\d{2}:\d{2}$/.test(s) && /^\d{2}:\d{2}$/.test(e) && hmToMin(e) > hmToMin(s)) {
              win = { start: s, end: e };
            }
          }
        } catch {
          // fall through to re-ask
        }
      }
      if (!win) {
        await sendPlain(deps, user, 'Hmm, try like this: "9am to 9pm"', nowMs);
        return;
      }
      await finish(deps, user, win, now);
      return;
    }
  }
}

async function finish(deps: TickDeps, user: User, win: { start: string; end: string }, now: Date): Promise<void> {
  await repo.updateUser(deps.db, user.id, { wake_start: win.start, wake_end: win.end, convo_state: null });
  const updated = { ...user, wake_start: win.start, wake_end: win.end, convo_state: null };
  const day = localDay(now, user.tz);
  const habits = await repo.getActiveHabits(deps.db, user.id);
  const due = habits.filter((h) => isDueOn(h, day));
  const dueList = due.map((h) => `${h.emoji} ${h.name} (${h.target_count} ${pluralize(h.unit, h.target_count)})`).join(', ');
  const buttons = due.slice(0, 3).map((h) => ({
    id: encodeBtn({ action: 'done', habitId: h.id, day }),
    title: h.pacing === 'spread' ? `${h.emoji} +1 ${h.unit}`.slice(0, 20) : `${h.emoji} Done`.slice(0, 20),
  }));
  await sendReply(
    deps,
    updated,
    'smalltalk_reply',
    {
      event: 'onboarding_complete',
      note: 'introduce yourself in your chosen voice (first impression!), mention that streaks earn real rewards from Rishabh, and lay out today',
      dueToday: dueList || 'rest day',
      awakeWindow: `${win.start}-${win.end}`,
    },
    now.getTime(),
    buttons.length ? buttons : undefined,
  );
}
