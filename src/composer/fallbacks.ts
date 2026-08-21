import type { BriefKind, MessageBrief } from '../core/types';

// Canned strings — the reason a reminder can never silently drop. Rotating
// variants keyed by a stable seed; {key} placeholders interpolate brief.facts.
const TEMPLATES: Record<BriefKind, string[]> = {
  morning: [
    'Good morning {name}! {weatherLine} On today: {dueToday}. {newRewardEarned} Let’s go 💪',
    'Morning! {weatherLine} Today’s lineup: {dueToday}. {newRewardEarned} You’ve got this ☀️',
  ],
  water_reminder: [
    'Water check: {done}/{target} glasses, {hoursLeft}h left in the day 💧',
    'Hydration status: {done}/{target}. Your move 💧',
    '{remaining} glasses to go — tiny sip break? 💧',
  ],
  vitamin_reminder: [
    '{emoji} {habit} time — taken it yet?',
    'Friendly poke: today is a {habit} day {emoji}',
  ],
  catchup: [
    '{remaining} glasses left and only {hoursLeft}h to go — sprint time 💧',
    'Endgame: {done}/{target} with {hoursLeft}h left. Chug responsibly 💧',
  ],
  streak_save: [
    '⚠️ Your {streak}-day {habit} streak is on the line — about {minutesLeft} min left to save it!',
  ],
  praise_log: ['Logged! {done}/{target} 💧', 'Nice — {done}/{target} in the books.'],
  habit_complete: ['{emoji} {habit} DONE for today. +{points} pts!', 'That’s a wrap on {habit} today {emoji} +{points} pts'],
  milestone: ['🔥 {label}! Genuinely impressive.'],
  coupon_earned: ['🎁 Reward unlocked: {title}. Text "redeem" whenever you want to cash it in.'],
  coupon_gifted: [
    '🎁 Surprise — Rishabh just unlocked something for you, no streak required: "{title}" {noteFromRishabh} Text "redeem" whenever.',
    '🎁 Special delivery, straight from Rishabh (you didn\'t even have to earn this one): "{title}" {noteFromRishabh} Say "redeem" to claim it.',
  ],
  report: [
    '📊 Weekly report\nGrade: {grade} ({overallPct}%)\n{perHabit}\nPerfect days: {perfectDays} | Best day: {bestDay}\nPoints this week: {pointsEarned}\n{challengeLine}\nNext challenge: {nextChallengeTitle} (+{nextChallengePoints} pts)',
  ],
  redeem_confirm: ['Done! "{title}" is officially redeemed. Rishabh has been notified 😌'],
  reminder_set: ['Noted! I’ll poke you {when}: "{text}" ⏰', 'On it — {when}, I’ll remind you: "{text}" ⏰'],
  reminder_fire: ['⏰ Reminder: {text}', 'You asked me to remind you (set for {setFor}): {text} ⏰'],
  smalltalk_reply: ['🙂', 'Noted!'],
  soft_ack: ['Okay 🤍 Gentle mode on for the rest of today — no reminders, no pressure.'],
  skip_ack: ['Noted — {habit} skipped today. Your streak is safe (frozen, not broken).'],
  snooze_ack: ['Snoozed {habit} for {minutes} min ⏰'],
  stale_tap: ['That button was from yesterday’s card — today is a fresh page 🙂'],
  already_done: ['Already fully logged for today ✅ Nothing left to do.'],
  didnt_understand: [
    'Didn’t catch that — tap a button, or say things like "done", "2 glasses", "snooze", "status", "redeem", or "remind me to call mom at 5".',
  ],
};

export function interpolate(template: string, facts: MessageBrief['facts']): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = facts[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

export function cannedMessage(brief: MessageBrief, seed = 0): string {
  const variants = TEMPLATES[brief.kind] ?? TEMPLATES.didnt_understand;
  const t = variants[Math.abs(seed) % variants.length];
  return interpolate(t, brief.facts).replace(/ +/g, ' ').trim();
}
