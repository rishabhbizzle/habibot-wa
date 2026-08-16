import { addDays } from '../core/clock';
import type { ChallengeRule, Facts, Snapshot } from '../core/types';
import { repo, type Db } from '../db/repo';
import { weeklyReport } from '../engine/report';

export interface PreparedReport {
  facts: Facts;
  /** statements to run only after the report message actually sends */
  postSend: { sql: string; params: unknown[] }[];
}

export async function prepareWeeklyReport(db: Db, s: Snapshot): Promise<PreparedReport> {
  const weekStart = s.weekKey;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [logs, points, challengeRow] = await Promise.all([
    repo.logsForDays(db, s.player.id, days),
    repo.pointsForDays(db, s.player.id, days),
    repo.activeChallenge(db, s.player.id, weekStart),
  ]);

  const challenge =
    challengeRow && challengeRow.status === 'active'
      ? {
          title: challengeRow.title,
          rule: JSON.parse(challengeRow.rule) as ChallengeRule,
          reward_points: challengeRow.reward_points,
        }
      : null;

  const rep = weeklyReport({
    weekStart,
    days,
    habits: s.habits,
    logs,
    streaks: s.streaks,
    pointsEarned: points,
    challenge,
  });

  const postSend: PreparedReport['postSend'] = [];
  if (challengeRow && challengeRow.status === 'active' && rep.challengeResult) {
    postSend.push({
      sql: 'UPDATE challenges SET status = ? WHERE id = ?',
      params: [rep.challengeResult, challengeRow.id],
    });
    if (rep.challengeResult === 'completed') {
      postSend.push(
        repo.insertLedgerStmt(s.player.id, challengeRow.reward_points, 'challenge', String(challengeRow.id), s.localDay, s.now),
      );
    }
  }
  const nextWeekStart = addDays(weekStart, 7);
  postSend.push({
    sql: `INSERT INTO challenges (user_id, week_start_day, title, rule, status, reward_points, created_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    params: [s.player.id, nextWeekStart, rep.nextChallenge.title, JSON.stringify(rep.nextChallenge.rule), rep.nextChallenge.reward_points, s.now],
  });

  const challengeLine = rep.challengeTitle
    ? rep.challengeResult === 'completed'
      ? `Challenge "${rep.challengeTitle}": COMPLETED ✅ (+${challenge?.reward_points ?? 0} pts)`
      : `Challenge "${rep.challengeTitle}": not this time`
    : 'No challenge was running this week';

  const facts: Facts = {
    grade: rep.grade,
    overallPct: rep.overallPct,
    perHabit: rep.perHabit.map((h) => `${h.emoji} ${h.name}: ${h.pct}% (${h.detail})`).join(' | '),
    perfectDays: rep.perfectDays,
    bestDay: rep.bestDay ?? '—',
    pointsEarned: rep.pointsEarned,
    challengeLine,
    nextChallengeTitle: rep.nextChallenge.title,
    nextChallengePoints: rep.nextChallenge.reward_points,
  };
  return { facts, postSend };
}
