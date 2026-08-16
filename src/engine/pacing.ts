import { CONFIG } from '../env';

export interface PacingInput {
  target: number;
  done: number;
  nowMin: number;
  startMin: number;
  endMin: number;
  /** epoch-ms deltas expressed as minutes-since for gap math */
  minutesSinceLastNudge: number | null;
  nudgesToday: number;
  nagMax: number;
  snoozed: boolean;
  catchupSentToday: boolean;
}

export type PacingResult =
  | { action: 'fire'; kind: 'reminder' | 'catchup' }
  | { action: 'suppress'; reason: 'complete' | 'on_pace' | 'snoozed' | 'gap' | 'capped' | 'before_window' | 'after_window' };

export function waterDecision(i: PacingInput): PacingResult {
  const remaining = i.target - i.done;
  if (remaining <= 0) return { action: 'suppress', reason: 'complete' };
  if (i.nowMin < i.startMin) return { action: 'suppress', reason: 'before_window' };
  if (i.nowMin >= i.endMin) return { action: 'suppress', reason: 'after_window' };
  if (i.snoozed) return { action: 'suppress', reason: 'snoozed' };
  if (i.nudgesToday >= i.nagMax) return { action: 'suppress', reason: 'capped' };

  const span = i.endMin - i.startMin;
  const elapsed = (i.nowMin - i.startMin) / span;
  const expected = elapsed * i.target;
  if (i.done >= expected - CONFIG.PACING_TOLERANCE) return { action: 'suppress', reason: 'on_pace' };

  const minutesLeft = i.endMin - i.nowMin;
  const gap = Math.min(Math.max(minutesLeft / (remaining + 1), CONFIG.PACING_GAP_MIN), CONFIG.PACING_GAP_MAX);
  if (i.minutesSinceLastNudge !== null && i.minutesSinceLastNudge < gap) {
    return { action: 'suppress', reason: 'gap' };
  }

  const kind =
    minutesLeft <= CONFIG.CATCHUP_WINDOW_MIN && remaining >= CONFIG.CATCHUP_BEHIND && !i.catchupSentToday
      ? 'catchup'
      : 'reminder';
  return { action: 'fire', kind };
}
