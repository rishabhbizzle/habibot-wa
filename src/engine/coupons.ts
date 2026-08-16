import type { Coupon, Milestone } from '../core/types';

/**
 * Pick at most one stocked coupon for a milestone: exact trigger match first
 * (type + value), then a generic 'any' coupon, else none (points-only party).
 */
export function pickCoupon(pool: Coupon[], m: Milestone): Coupon | null {
  const stocked = pool.filter((c) => c.status === 'stocked');
  const exact = stocked.find(
    (c) => c.trigger_type === m.trigger_type && (c.trigger_value === null || c.trigger_value === m.value),
  );
  if (exact) return exact;
  return stocked.find((c) => c.trigger_type === 'any') ?? null;
}
