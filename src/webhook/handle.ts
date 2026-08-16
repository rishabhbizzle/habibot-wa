import { localDay } from '../core/clock';
import { parseConvoState } from '../core/convo';
import { decodeBtn } from '../core/ids';
import type { User } from '../core/types';
import { repo } from '../db/repo';
import { handleAdmin } from '../flows/admin';
import { applyIntent } from '../flows/logging';
import { onboardingStep } from '../flows/onboarding';
import { resolveRedeemPick } from '../flows/redeem';
import { sendReply } from '../flows/reply';
import { parseIntent } from '../intents/parse';
import { morningDecision } from '../scheduler/decisions';
import { loadSnapshot } from '../scheduler/snapshot';
import { executeDecision, type TickDeps } from '../scheduler/tick';
import type { InboundMessage } from './parse';

/** One inbound WhatsApp message, end to end. Must never throw. */
export async function handleInbound(deps: TickDeps, msg: InboundMessage): Promise<void> {
  const { db } = deps;
  const now = deps.clock.now();
  const user = await repo.getUserByWaId(db, msg.waId);

  // Dedupe first: Meta retries webhooks (up to 7 days) on any non-200.
  const ins = await repo.insertMessage(db, {
    wa_message_id: msg.wamid,
    user_id: user?.id ?? null,
    direction: 'in',
    kind: msg.kind,
    body: msg.text ?? msg.buttonId ?? null,
    status: 'received',
    created_at: now.getTime(),
  });
  if (ins.duplicate) return;
  if (!user) return; // unknown sender: logged, never answered

  await repo.updateUser(db, user.id, { last_inbound_at: now.getTime() });
  user.last_inbound_at = now.getTime(); // escalation + window state see the fresh value

  if (user.role === 'admin') {
    await handleAdmin(deps, user, msg, now);
    return;
  }

  const state = parseConvoState(user.convo_state);

  // Onboarding intercepts everything until she's set up.
  if (!user.persona || state?.kind === 'onboarding') {
    await onboardingStep(deps, user, msg, now);
    return;
  }

  if (msg.kind === 'button' && msg.buttonId) {
    await handleButton(deps, user, msg, now);
    return;
  }

  if (state?.kind === 'redeem_pick') {
    const t = (msg.text ?? '').trim();
    if (/^\d{1,2}$/.test(t)) {
      await resolveRedeemPick(deps, user, Number(t), state.couponIds, now);
      return;
    }
    // anything else falls through to normal handling (and clears the pick state)
    await repo.updateUser(db, user.id, { convo_state: null });
  }

  if (msg.kind !== 'text' || !msg.text) {
    // audio/image/etc: acknowledge kindly, don't pretend to understand
    await sendReply(deps, user, 'smalltalk_reply', { herMessage: `she sent a ${msg.kind} message` }, now.getTime());
    return;
  }

  const day = localDay(now, user.tz);
  const [habits, logsToday, recent] = await Promise.all([
    repo.getActiveHabits(db, user.id),
    repo.logsForDay(db, user.id, day),
    repo.recentMessages(db, user.id, 8),
  ]);
  const intent = await parseIntent(msg.text, user, habits, logsToday, recent, deps.llm, now);
  await applyIntent(deps, user, intent, now, 'text');
}

async function handleButton(deps: TickDeps, user: User, msg: InboundMessage, now: Date): Promise<void> {
  const b = decodeBtn(msg.buttonId ?? '');
  if (!b) {
    // Unknown button id (e.g. legacy) — treat its title as text-ish smalltalk.
    await sendReply(deps, user, 'smalltalk_reply', { herMessage: msg.buttonTitle ?? 'a button tap' }, now.getTime());
    return;
  }

  if (b.action === 'morning_ack') {
    // Template quick-reply tap: her message just reopened the window. If no
    // real morning brief went out yet today, send it now.
    const snap = await loadSnapshot(deps.db, user, now);
    const alreadySent = snap.nudgesToday.some((n) => n.kind === 'morning' && n.status === 'sent');
    if (!alreadySent) await executeDecision(deps, snap, morningDecision(snap));
    return;
  }

  const today = localDay(now, user.tz);
  if (b.day !== today) {
    await sendReply(deps, user, 'stale_tap', {}, now.getTime());
    return;
  }

  switch (b.action) {
    case 'done':
      await applyIntent(deps, user, { type: 'log_habit', habit: b.habitId, count: 1 }, now, 'button');
      return;
    case 'snooze':
      await applyIntent(deps, user, { type: 'snooze', habit: b.habitId, minutes: b.minutes }, now, 'button');
      return;
    case 'skip':
      await applyIntent(deps, user, { type: 'skip_today', habit: b.habitId }, now, 'button');
      return;
  }
}
