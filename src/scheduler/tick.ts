import { addDays, daysBetween, localDay, type Clock } from '../core/clock';
import { encodeBtn } from '../core/ids';
import type { Facts, Habit, Snapshot, TickDecision, User } from '../core/types';
import { repo, type Db } from '../db/repo';
import { CONFIG } from '../env';
import { pickCoupon } from '../engine/coupons';
import { rolloverDay } from '../engine/rollover';
import { buildBrief } from '../composer/briefs';
import { composeMessage } from '../composer/compose';
import type { Llm } from '../llm/anthropic';
import type { ButtonSpec, SendResult, Sender } from '../wa/sender';
import { fireDueReminders } from '../flows/reminders';
import { prepareWeeklyReport } from '../flows/report';
import { recentOutbound } from '../flows/reply';
import { decide } from './decisions';
import { loadSnapshot } from './snapshot';

export interface TickDeps {
  db: Db;
  send: Sender;
  llm: Llm | null;
  clock: Clock;
  templateName: string;
  publicBaseUrl: string;
  /** optional weather provider for the morning brief (see src/weather.ts) */
  weatherFacts?: () => Promise<Facts>;
}

export interface TickReport {
  ran: boolean;
  reason?: string;
  sent: { kind: string; habitId: string | null; ok: boolean; text?: string }[];
  remindersFired?: number;
}

export async function runTick(deps: TickDeps, opts: { force?: boolean } = {}): Promise<TickReport> {
  const { db } = deps;
  const now = deps.clock.now();
  const player = await repo.getPlayer(db);
  if (!player) return { ran: false, reason: 'no_player', sent: [] };

  if (!opts.force && !(await repo.acquireTickLock(db, now.getTime(), 5 * 60_000))) {
    return { ran: false, reason: 'locked', sent: [] };
  }

  const today = localDay(now, player.tz);
  await maybeRollover(deps, player, today, now.getTime());
  if (!player.persona) return { ran: true, reason: 'not_onboarded', sent: [] };

  const snap = await loadSnapshot(db, player, now);
  const decisions = decide(snap);
  const sent: TickReport['sent'] = [];
  for (const d of decisions) {
    try {
      sent.push(await executeDecision(deps, snap, d));
    } catch (e) {
      sent.push({ kind: d.kind, habitId: d.habitId, ok: false, text: String(e) });
    }
  }

  // Her own one-off reminders — independent of nudge caps and soft/pause modes.
  let remindersFired = 0;
  try {
    remindersFired = await fireDueReminders(deps, player, now);
  } catch (e) {
    console.error('fireDueReminders failed', e);
  }
  return { ran: true, sent, remindersFired };
}

// ---- Rollover ----

async function maybeRollover(deps: TickDeps, player: User, today: string, nowMs: number): Promise<void> {
  const { db } = deps;
  const last = await repo.getState(db, 'last_rollover_day');
  if (last === today) return;

  const yday = addDays(today, -1);
  // `last` is the first unclosed day; close [last..yday], capped at 7 days back.
  let start = last && last <= yday ? last : yday;
  if (daysBetween(start, yday) > 6) start = addDays(yday, -6);

  const habits = await repo.getActiveHabits(db, player.id);
  const streaks = await repo.getStreaks(db, player.id);
  const pool = await repo.couponsByStatus(db, player.id, 'stocked');
  const earnedIds = new Set<number>();
  const stmts: { sql: string; params: unknown[] }[] = [];

  for (let day = start; day <= yday; day = addDays(day, 1)) {
    const logs = await repo.logsForDay(db, player.id, day);
    // Approximation: soft mode auto-expires next morning, so a soft_until within
    // the last ~36h means yesterday ran soft.
    const softDay =
      day === yday && player.soft_until !== null && Math.abs(nowMs - player.soft_until) < 36 * 3600_000;
    const res = rolloverDay({ day, userId: player.id, habits, logs, streaks, softDay });
    for (const s of res.streakUpdates) {
      streaks[s.key] = s;
      stmts.push(repo.upsertStreakStmt(s));
    }
    for (const l of res.ledger) {
      stmts.push(repo.insertLedgerStmt(player.id, l.delta, l.reason, l.ref, day, nowMs));
    }
    for (const m of res.milestones) {
      const coupon = pickCoupon(pool.filter((c) => !earnedIds.has(c.id)), m);
      if (coupon) {
        earnedIds.add(coupon.id);
        stmts.push(repo.markCouponEarnedStmt(coupon.id, m.key, nowMs));
      }
    }
  }

  stmts.push({
    sql: "INSERT INTO system_state (key, value) VALUES ('last_rollover_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params: [today],
  });
  await db.batch(stmts);
}

// ---- Decision execution ----

export async function executeDecision(deps: TickDeps, snap: Snapshot, d: TickDecision) {
  const player = snap.player;

  if (d.kind === 'template_reopen') {
    const res = await deps.send.template(player.wa_id, deps.templateName, {
      name: player.display_name,
      buttonPayload: 'morning_ack',
    });
    await recordSend(deps, snap, d, res, `[template:${deps.templateName}]`, null);
    return { kind: d.kind, habitId: null, ok: res.ok };
  }

  if (d.kind === 'report') {
    const prepared = await prepareWeeklyReport(deps.db, snap);
    const brief = buildBrief(d, snap, prepared.facts);
    const { text, fallback } = await composeMessage(brief, deps.llm, await recentOutbound(deps.db, player.id), seedFor(snap), player.about);
    const res = await deps.send.text(player.wa_id, text);
    await recordSend(deps, snap, d, res, text, JSON.stringify({ ...brief, fallback }));
    if (res.ok) {
      await deps.db.batch(prepared.postSend);
      await repo.setState(deps.db, 'last_report_week', snap.weekKey);
    }
    return { kind: d.kind, habitId: null, ok: res.ok, text };
  }

  // morning / reminder / catchup / streak_save
  let facts = d.facts;
  if (d.kind === 'morning' && deps.weatherFacts) {
    facts = { ...facts, ...(await deps.weatherFacts()) };
  }
  const brief = buildBrief(d, snap, facts);
  const { text, fallback } = await composeMessage(brief, deps.llm, await recentOutbound(deps.db, player.id), seedFor(snap), player.about);
  const buttons = buttonsFor(d, snap);
  const res = buttons.length
    ? await deps.send.buttons(player.wa_id, text, buttons)
    : await deps.send.text(player.wa_id, text);
  await recordSend(deps, snap, d, res, text, JSON.stringify({ ...brief, fallback }));

  if (d.kind === 'morning' && res.ok && snap.unannouncedCoupons.length > 0) {
    await announceCoupons(deps, snap);
  }
  return { kind: d.kind, habitId: d.habitId, ok: res.ok, text };
}

function seedFor(snap: Snapshot): number {
  return snap.nudgesToday.length + snap.localDay.charCodeAt(9);
}

function buttonsFor(d: TickDecision, snap: Snapshot): ButtonSpec[] {
  const day = snap.localDay;
  const habitBtn = (h: Habit): ButtonSpec => ({
    id: encodeBtn({ action: 'done', habitId: h.id, day }),
    title: h.pacing === 'spread' ? `${h.emoji} +1 ${h.unit}`.slice(0, 20) : `${h.emoji} Done`.slice(0, 20),
  });

  if (d.kind === 'morning') {
    const due = snap.habits.filter(
      (h) =>
        h.active === 1 &&
        !snap.logsToday.some((l) => l.habit_id === h.id && l.status === 'skipped') &&
        snap.logsToday.filter((l) => l.habit_id === h.id && l.status === 'done').reduce((s, l) => s + l.count, 0) <
          h.target_count,
    );
    return due.slice(0, 3).map(habitBtn);
  }

  if (d.habitId) {
    const h = snap.habits.find((x) => x.id === d.habitId);
    if (!h) return [];
    return [
      habitBtn(h),
      { id: encodeBtn({ action: 'snooze', habitId: h.id, day, minutes: 60 }), title: 'Snooze 1h' },
      { id: encodeBtn({ action: 'skip', habitId: h.id, day }), title: 'Skip today' },
    ];
  }
  return [];
}

async function announceCoupons(deps: TickDeps, snap: Snapshot): Promise<void> {
  const ids = snap.unannouncedCoupons.map((c) => c.id);
  await deps.db.batch(
    ids.map((id) => ({ sql: 'UPDATE coupons SET announced = 1 WHERE id = ?', params: [id] })),
  );
  for (const c of snap.unannouncedCoupons) {
    if (c.media_ref && deps.publicBaseUrl) {
      await deps.send.audio(
        snap.player.wa_id,
        `${deps.publicBaseUrl}/media/${c.media_ref}`,
        c.media_ref.endsWith('.ogg'),
      );
    }
  }
}

export async function recordSend(
  deps: TickDeps,
  snap: Snapshot,
  d: TickDecision,
  res: SendResult,
  text: string,
  briefJson: string | null,
): Promise<void> {
  const { db } = deps;
  const status = res.ok ? (res.skipped ?? 'sent') : 'failed';
  const msg = await repo.insertMessage(db, {
    wa_message_id: res.waMessageId ?? null,
    user_id: snap.player.id,
    direction: 'out',
    kind: d.kind,
    body: text,
    brief: briefJson,
    status,
    created_at: snap.now,
  });
  await db.batch([
    repo.insertNudgeStmt({
      user_id: snap.player.id,
      habit_id: d.habitId,
      kind: d.kind,
      local_day: snap.localDay,
      escalation: d.escalation,
      sent_at: snap.now,
      status: res.ok ? 'sent' : 'failed',
      message_id: msg.id,
    }),
  ]);

  // Consecutive-failure alarm to the admin.
  if (res.ok) {
    await repo.setState(db, 'send_fail_streak', '0');
  } else {
    const n = Number(await repo.getState(db, 'send_fail_streak')) + 1;
    await repo.setState(db, 'send_fail_streak', String(n));
    if (n === CONFIG.SEND_FAIL_ALERT_AFTER) {
      const admin = await repo.getAdmin(db);
      if (admin) {
        try {
          await deps.send.text(admin.wa_id, `⚠️ habitbot: ${n} consecutive send failures. Last error: ${res.error ?? 'unknown'}`);
        } catch {
          // admin unreachable too — nothing else to do
        }
      }
    }
  }
}
