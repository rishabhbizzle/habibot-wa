import { localDay } from '../core/clock';
import type { User } from '../core/types';
import { repo } from '../db/repo';
import { doneUnits, isComplete, isSkipped } from '../engine/game';
import { isDueOn } from '../engine/schedule';
import { isSoft } from '../scheduler/decisions';
import { windowOpen } from '../scheduler/snapshot';
import type { TickDeps } from '../scheduler/tick';

/** Deterministic status text (no LLM) — used by her "status" and admin /status. */
export async function buildStatusText(deps: TickDeps, player: User, now: Date): Promise<string> {
  const day = localDay(now, player.tz);
  const [habits, logs, streaks, points] = await Promise.all([
    repo.getActiveHabits(deps.db, player.id),
    repo.logsForDay(deps.db, player.id, day),
    repo.getStreaks(deps.db, player.id),
    repo.pointsBalance(deps.db, player.id),
  ]);

  const lines: string[] = [`📋 Today (${day})`];
  for (const h of habits) {
    if (!isDueOn(h, day)) {
      lines.push(`${h.emoji} ${h.name}: not due today`);
      continue;
    }
    if (isSkipped(h.id, logs)) {
      lines.push(`${h.emoji} ${h.name}: skipped (streak frozen)`);
      continue;
    }
    const done = doneUnits(h.id, logs);
    const mark = isComplete(h, logs.filter((l) => l.habit_id === h.id)) ? ' ✅' : '';
    const streak = streaks[h.id]?.current ?? 0;
    lines.push(`${h.emoji} ${h.name}: ${done}/${h.target_count}${mark}${streak > 0 ? ` — streak ${streak}` : ''}`);
  }
  const pd = streaks['perfect_day']?.current ?? 0;
  if (pd > 0) lines.push(`⭐ Perfect-day streak: ${pd}`);
  lines.push(`🪙 Points: ${points}`);

  const flags: string[] = [];
  if (isSoft(player, now.getTime())) flags.push('soft mode');
  if (player.paused_until && player.paused_until > now.getTime()) flags.push('paused');
  if (!windowOpen(player, now.getTime())) flags.push('24h window closed');
  if (flags.length) lines.push(`⚙️ ${flags.join(', ')}`);
  return lines.join('\n');
}
