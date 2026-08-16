import type { Nudge } from '../core/types';
import { CONFIG } from '../env';

const REMINDER_KINDS = new Set(['reminder', 'catchup', 'streak_save']);

/**
 * Escalation is derived, never stored: the level of the NEXT reminder equals
 * the number of reminder-ish nudges already sent since her last inbound
 * message today, capped. Any inbound resets it automatically.
 */
export function escalationLevel(nudgesToday: Nudge[], lastInboundAt: number | null): 0 | 1 | 2 | 3 {
  const since = lastInboundAt ?? 0;
  const n = nudgesToday.filter(
    (x) => x.status === 'sent' && x.sent_at > since && REMINDER_KINDS.has(x.kind),
  ).length;
  return Math.min(n, CONFIG.MAX_ESCALATION) as 0 | 1 | 2 | 3;
}
