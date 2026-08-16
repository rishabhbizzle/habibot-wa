import { replyBrief } from '../composer/briefs';
import { composeMessage } from '../composer/compose';
import type { BriefKind, Facts, User } from '../core/types';
import { repo, type Db } from '../db/repo';
import type { TickDeps } from '../scheduler/tick';
import type { ButtonSpec } from '../wa/sender';

export async function recentOutbound(db: Db, userId: string): Promise<string[]> {
  const rows = await repo.recentMessages(db, userId, 10);
  return rows
    .filter((m) => m.direction === 'out' && m.body)
    .map((m) => m.body as string)
    .slice(0, 4);
}

/** Compose an in-persona reply and send it (replies never count as nudges). */
export async function sendReply(
  deps: TickDeps,
  user: User,
  kind: BriefKind,
  facts: Facts,
  nowMs: number,
  buttons?: ButtonSpec[],
): Promise<{ text: string; ok: boolean }> {
  const brief = replyBrief(kind, user, nowMs, facts);
  const recent = await recentOutbound(deps.db, user.id);
  const { text, fallback } = await composeMessage(brief, deps.llm, recent, Math.floor(nowMs / 60000) % 7, user.about);
  const ok = await deliver(deps, user, kind, text, JSON.stringify({ ...brief, fallback }), nowMs, buttons);
  return { text, ok };
}

/** Send fixed text (admin replies, lists — no persona, no LLM). */
export async function sendPlain(
  deps: TickDeps,
  user: User,
  text: string,
  nowMs: number,
  buttons?: ButtonSpec[],
): Promise<boolean> {
  return deliver(deps, user, 'plain', text, null, nowMs, buttons);
}

async function deliver(
  deps: TickDeps,
  user: User,
  kind: string,
  text: string,
  brief: string | null,
  nowMs: number,
  buttons?: ButtonSpec[],
): Promise<boolean> {
  const res =
    buttons && buttons.length > 0
      ? await deps.send.buttons(user.wa_id, text, buttons)
      : await deps.send.text(user.wa_id, text);
  await repo.insertMessage(deps.db, {
    wa_message_id: res.waMessageId ?? null,
    user_id: user.id,
    direction: 'out',
    kind,
    body: text,
    brief,
    status: res.ok ? (res.skipped ?? 'sent') : 'failed',
    created_at: nowMs,
  });
  return res.ok;
}
