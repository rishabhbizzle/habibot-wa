import { isSunday, localDay, minutesIntoDay, weekKey } from '../core/clock';
import type { Snapshot, User } from '../core/types';
import { CONFIG } from '../env';
import { repo, type Db } from '../db/repo';

export function windowOpen(user: User, nowMs: number): boolean {
  return user.last_inbound_at !== null && nowMs - user.last_inbound_at < CONFIG.WINDOW_MS;
}

export async function loadSnapshot(db: Db, player: User, now: Date): Promise<Snapshot> {
  const tz = player.tz;
  const day = localDay(now, tz);
  const [habits, logsToday, nudgesToday, snoozesToday, streaks, lastReportWeek, unannouncedCoupons] =
    await Promise.all([
      repo.getActiveHabits(db, player.id),
      repo.logsForDay(db, player.id, day),
      repo.nudgesForDay(db, player.id, day),
      repo.snoozesForDay(db, day),
      repo.getStreaks(db, player.id),
      repo.getState(db, 'last_report_week'),
      repo.unannouncedCoupons(db, player.id),
    ]);

  return {
    now: now.getTime(),
    localDay: day,
    localMin: minutesIntoDay(now, tz),
    weekKey: weekKey(day),
    isSunday: isSunday(now, tz),
    player,
    habits,
    logsToday,
    nudgesToday,
    snoozesToday,
    streaks,
    windowOpen: windowOpen(player, now.getTime()),
    lastReportWeek,
    unannouncedCoupons,
  };
}
