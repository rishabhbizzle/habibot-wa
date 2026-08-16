import { serializeConvoState } from '../core/convo';
import type { Coupon, User } from '../core/types';
import { repo } from '../db/repo';
import type { TickDeps } from '../scheduler/tick';
import { sendPlain, sendReply } from './reply';

export async function startRedeem(deps: TickDeps, user: User, now: Date): Promise<void> {
  const nowMs = now.getTime();
  const earned = await repo.couponsByStatus(deps.db, user.id, 'earned');
  if (earned.length === 0) {
    await sendPlain(
      deps,
      user,
      'No rewards banked yet 👀 Streaks unlock them — a 3-day streak gets you the first one.',
      nowMs,
    );
    return;
  }
  if (earned.length === 1) {
    await doRedeem(deps, user, earned[0], nowMs);
    return;
  }
  const list = earned.map((c, i) => `${i + 1}. ${c.title}`).join('\n');
  await repo.updateUser(deps.db, user.id, {
    convo_state: serializeConvoState({ kind: 'redeem_pick', couponIds: earned.map((c) => c.id) }),
  });
  await sendPlain(deps, user, `🎁 Your earned rewards:\n${list}\n\nReply with a number to redeem one.`, nowMs);
}

export async function resolveRedeemPick(deps: TickDeps, user: User, n: number, couponIds: number[], now: Date): Promise<void> {
  const nowMs = now.getTime();
  await repo.updateUser(deps.db, user.id, { convo_state: null });
  const id = couponIds[n - 1];
  if (!id) {
    await sendPlain(deps, user, `Pick a number between 1 and ${couponIds.length} 🙂 (say "redeem" to see the list again)`, nowMs);
    return;
  }
  const coupon = await deps.db.first<Coupon>('SELECT * FROM coupons WHERE id = ?', id);
  if (!coupon || coupon.status !== 'earned') {
    await sendPlain(deps, user, 'That one is not redeemable anymore — say "redeem" to see the current list.', nowMs);
    return;
  }
  await doRedeem(deps, user, coupon, nowMs);
}

async function doRedeem(deps: TickDeps, user: User, coupon: Coupon, nowMs: number): Promise<void> {
  const res = await deps.db.run(
    "UPDATE coupons SET status = 'redeemed', redeemed_at = ? WHERE id = ? AND status = 'earned'",
    nowMs,
    coupon.id,
  );
  if (res.changes === 0) {
    await sendPlain(deps, user, 'That one was already redeemed ✅', nowMs);
    return;
  }
  await sendReply(deps, user, 'redeem_confirm', { title: coupon.title }, nowMs);
  const admin = await repo.getAdmin(deps.db);
  if (admin) {
    try {
      await sendPlain(deps, admin, `🎟️ She redeemed: "${coupon.title}". Pay up.`, nowMs);
    } catch {
      // admin notification is best-effort
    }
  }
}
