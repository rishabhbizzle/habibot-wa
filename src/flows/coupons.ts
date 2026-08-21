import type { Coupon, User } from '../core/types';
import { repo } from '../db/repo';
import { windowOpen } from '../scheduler/snapshot';
import type { TickDeps } from '../scheduler/tick';
import { sendReply } from './reply';

export interface GiftResult {
  ok: boolean;
  /** false when her 24h window was closed — the morning brief will announce it */
  announced: boolean;
  coupon?: Coupon;
  error?: string;
}

/**
 * Unlock a reward on the spot — no streak, no milestone, just because. Either
 * gifts an existing stocked coupon (by id) or creates a brand-new one.
 * Announces immediately when her window is open; otherwise leaves it
 * unannounced so the next morning brief picks it up (see tick.announceCoupons).
 */
export async function giftCoupon(
  deps: TickDeps,
  player: User,
  input: { id?: number; title?: string; note?: string | null; media?: string | null },
  now: Date,
): Promise<GiftResult> {
  const nowMs = now.getTime();

  let couponId: number;
  if (input.id !== undefined) {
    const existing = await repo.getCoupon(deps.db, input.id, player.id);
    if (!existing) return { ok: false, announced: false, error: `no coupon #${input.id}` };
    if (existing.status !== 'stocked') {
      return { ok: false, announced: false, error: `#${input.id} is already ${existing.status}` };
    }
    const ok = await repo.giftStockedCoupon(deps.db, input.id, player.id, nowMs);
    if (!ok) return { ok: false, announced: false, error: `#${input.id} could not be gifted` };
    couponId = input.id;
  } else {
    const title = (input.title ?? '').trim();
    if (!title) return { ok: false, announced: false, error: 'a title is required' };
    if (title.length > 80) return { ok: false, announced: false, error: 'title too long (max 80 chars)' };
    couponId = await repo.insertGiftedCoupon(deps.db, {
      user_id: player.id,
      title,
      description: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
      media_ref: input.media?.trim() || null,
      now: nowMs,
    });
  }

  const coupon = await repo.getCoupon(deps.db, couponId, player.id);
  if (!coupon) return { ok: false, announced: false, error: 'coupon vanished after write' };

  // Her window is closed: keep announced=0 so the morning brief delivers it.
  if (!windowOpen(player, nowMs)) return { ok: true, announced: false, coupon };

  const note = (input.note ?? coupon.description ?? '').trim();
  const { ok } = await sendReply(
    deps,
    player,
    'coupon_gifted',
    {
      title: coupon.title,
      noteFromRishabh: note,
      framing: 'a surprise gift from Rishabh — she did NOT earn this through a streak, he just wanted to give it to her',
    },
    nowMs,
  );
  if (!ok) return { ok: true, announced: false, coupon };

  await repo.markCouponAnnounced(deps.db, coupon.id);
  if (coupon.media_ref && deps.publicBaseUrl) {
    try {
      await deps.send.audio(
        player.wa_id,
        `${deps.publicBaseUrl}/media/${coupon.media_ref}`,
        coupon.media_ref.endsWith('.ogg'),
      );
    } catch {
      // the voice note is a bonus; the coupon already landed
    }
  }
  return { ok: true, announced: true, coupon };
}
