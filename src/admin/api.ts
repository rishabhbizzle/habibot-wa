import { Hono } from 'hono';
import { localDay } from '../core/clock';
import type { Coupon, Habit, MessageRow, User } from '../core/types';
import { buildDeps } from '../deps';
import type { Env } from '../env';
import { repo } from '../db/repo';
import { doneUnits, isComplete, isSkipped } from '../engine/game';
import { isDueOn } from '../engine/schedule';
import { sendTestMessage } from '../flows/admin';
import { nextWakeStartMs } from '../flows/logging';
import { isSoft } from '../scheduler/decisions';
import { windowOpen } from '../scheduler/snapshot';
import { runTick } from '../scheduler/tick';

const HM = /^\d{2}:\d{2}$/;
const HABIT_ID = /^[a-z0-9_-]{2,24}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const adminApi = new Hono<{ Bindings: Env }>();

adminApi.use('*', async (c, next) => {
  const key = c.env.ADMIN_KEY;
  if (!key) return c.json({ error: 'ADMIN_KEY secret not set on the worker' }, 503);
  if (c.req.header('authorization') !== `Bearer ${key}`) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

adminApi.get('/overview', async (c) => {
  const deps = await buildDeps(c.env);
  const player = await repo.getPlayer(deps.db);
  if (!player) return c.json({ error: 'no player seeded' }, 500);
  const now = new Date();
  const day = localDay(now, player.tz);

  const [habits, logs, streaks, points, messages, coupons, nudges] = await Promise.all([
    deps.db.all<Habit>('SELECT * FROM habits ORDER BY rowid'),
    repo.logsForDay(deps.db, player.id, day),
    repo.getStreaks(deps.db, player.id),
    repo.pointsBalance(deps.db, player.id),
    repo.recentMessages(deps.db, player.id, 25),
    deps.db.all<Coupon>('SELECT * FROM coupons WHERE user_id = ? ORDER BY id DESC', player.id),
    repo.nudgesForDay(deps.db, player.id, day),
  ]);

  return c.json({
    now: now.getTime(),
    day,
    player: {
      display_name: player.display_name,
      about: player.about,
      persona: player.persona,
      language: player.language,
      wake_start: player.wake_start,
      wake_end: player.wake_end,
      tz: player.tz,
      soft: isSoft(player, now.getTime()),
      paused_until: player.paused_until && player.paused_until > now.getTime() ? player.paused_until : null,
      window_open: windowOpen(player, now.getTime()),
      onboarded: player.persona !== null,
    },
    habits: habits.map((h) => ({
      ...h,
      due_today: isDueOn(h, day),
      done_today: doneUnits(h.id, logs),
      skipped_today: isSkipped(h.id, logs),
      complete_today: isComplete(h, logs.filter((l) => l.habit_id === h.id)),
      streak: streaks[h.id]?.current ?? 0,
      best: streaks[h.id]?.best ?? 0,
    })),
    perfect_streak: streaks['perfect_day']?.current ?? 0,
    points,
    nudges_today: nudges.filter((n) => n.status === 'sent').map((n) => `${n.kind}${n.escalation ? `@L${n.escalation}` : ''}`),
    coupons,
    messages: messages.map((m: MessageRow) => ({
      direction: m.direction,
      kind: m.kind,
      status: m.status,
      body: (m.body ?? '').slice(0, 200),
      created_at: m.created_at,
    })),
  });
});

adminApi.post('/habits', async (c) => {
  const deps = await buildDeps(c.env);
  const player = await repo.getPlayer(deps.db);
  if (!player) return c.json({ error: 'no player' }, 500);
  const b = (await c.req.json()) as Record<string, unknown>;

  const id = String(b.id ?? '').toLowerCase();
  const scheduleType = String(b.schedule_type ?? 'daily');
  const pacing = String(b.pacing ?? 'once');
  const err = (m: string) => c.json({ error: m }, 400);
  if (!HABIT_ID.test(id)) return err('id must be 2-24 chars of a-z, 0-9, -, _');
  const name = String(b.name ?? '').trim();
  if (!name || name.length > 30) return err('name required (max 30 chars)');
  if (!['daily', 'every_n_days', 'weekly'].includes(scheduleType)) return err('bad schedule_type');
  if (!['spread', 'once'].includes(pacing)) return err('bad pacing');
  const intervalDays = b.interval_days ? Number(b.interval_days) : null;
  if (scheduleType === 'every_n_days' && (!intervalDays || intervalDays < 2 || intervalDays > 30)) {
    return err('every_n_days needs interval_days 2-30');
  }
  const anchorDate = b.anchor_date ? String(b.anchor_date) : null;
  if (scheduleType === 'every_n_days' && (!anchorDate || !DATE.test(anchorDate))) return err('every_n_days needs anchor_date YYYY-MM-DD');
  const weeklyDays = b.weekly_days ? String(b.weekly_days).toLowerCase().replace(/\s/g, '') : null;
  if (scheduleType === 'weekly' && (!weeklyDays || !weeklyDays.split(',').every((d) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(d)))) {
    return err('weekly needs weekly_days like mon,thu');
  }
  const opt = (v: unknown) => (v && HM.test(String(v)) ? String(v) : null);
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : def;
  };

  await deps.db.batch([
    {
      sql: `INSERT OR REPLACE INTO habits (id, user_id, name, emoji, active, schedule_type, interval_days, anchor_date, weekly_days,
              anchor_time, window_start, window_end, target_count, unit, pacing, nag_max_per_day, nag_min_gap_min, points, streak_enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, player.id, name, String(b.emoji ?? '✅').slice(0, 8), b.active === 0 || b.active === false ? 0 : 1,
        scheduleType, scheduleType === 'every_n_days' ? intervalDays : null, scheduleType === 'every_n_days' ? anchorDate : null,
        scheduleType === 'weekly' ? weeklyDays : null,
        opt(b.anchor_time), opt(b.window_start), opt(b.window_end),
        num(b.target_count, 1, 1, 30), String(b.unit ?? 'time').slice(0, 12), pacing,
        num(b.nag_max_per_day, 3, 1, 10), num(b.nag_min_gap_min, 60, 15, 720), num(b.points, 10, 1, 100), 1,
      ],
    },
    { sql: `INSERT OR IGNORE INTO streaks (key, user_id, current, best, last_counted_day) VALUES (?, ?, 0, 0, NULL)`, params: [id, player.id] },
  ]);
  return c.json({ ok: true });
});

adminApi.post('/habits/toggle', async (c) => {
  const deps = await buildDeps(c.env);
  const b = (await c.req.json()) as { id?: string; active?: boolean };
  const r = await deps.db.run('UPDATE habits SET active = ? WHERE id = ?', b.active ? 1 : 0, String(b.id ?? ''));
  return r.changes ? c.json({ ok: true }) : c.json({ error: 'unknown habit' }, 404);
});

adminApi.post('/coupons', async (c) => {
  const deps = await buildDeps(c.env);
  const player = await repo.getPlayer(deps.db);
  if (!player) return c.json({ error: 'no player' }, 500);
  const b = (await c.req.json()) as Record<string, unknown>;
  const title = String(b.title ?? '').trim();
  if (!title || title.length > 80) return c.json({ error: 'title required (max 80)' }, 400);
  const trigger = String(b.trigger_type ?? 'any');
  if (!['streak_milestone', 'perfect_week', 'any'].includes(trigger)) return c.json({ error: 'bad trigger_type' }, 400);
  const id = await repo.insertCoupon(deps.db, {
    user_id: player.id,
    title,
    description: b.description ? String(b.description).slice(0, 200) : null,
    trigger_type: trigger as Coupon['trigger_type'],
    trigger_value: b.trigger_value ? Number(b.trigger_value) : null,
    media_ref: b.media_ref ? String(b.media_ref).slice(0, 60) : null,
    created_at: Date.now(),
  });
  return c.json({ ok: true, id });
});

adminApi.post('/coupons/delete', async (c) => {
  const deps = await buildDeps(c.env);
  const b = (await c.req.json()) as { id?: number };
  const r = await deps.db.run("DELETE FROM coupons WHERE id = ? AND status = 'stocked'", Number(b.id ?? 0));
  return r.changes ? c.json({ ok: true }) : c.json({ error: 'only stocked coupons can be deleted' }, 400);
});

adminApi.post('/mode', async (c) => {
  const deps = await buildDeps(c.env);
  const player = await repo.getPlayer(deps.db);
  if (!player) return c.json({ error: 'no player' }, 500);
  const b = (await c.req.json()) as { soft?: boolean; pause_hours?: number };
  const now = Date.now();
  if (typeof b.soft === 'boolean') {
    await repo.updateUser(deps.db, player.id, { soft_until: b.soft ? nextWakeStartMs(now, player) : null });
  }
  if (typeof b.pause_hours === 'number') {
    await repo.updateUser(deps.db, player.id, {
      paused_until: b.pause_hours > 0 ? now + Math.min(b.pause_hours, 168) * 3600_000 : null,
    });
  }
  return c.json({ ok: true });
});

adminApi.post('/user', async (c) => {
  const deps = await buildDeps(c.env);
  const player = await repo.getPlayer(deps.db);
  if (!player) return c.json({ error: 'no player' }, 500);
  const b = (await c.req.json()) as Record<string, unknown>;
  const fields: Partial<User> = {};
  if (b.wake_start && HM.test(String(b.wake_start))) fields.wake_start = String(b.wake_start);
  if (b.wake_end && HM.test(String(b.wake_end))) fields.wake_end = String(b.wake_end);
  if (['sassy', 'sweet', 'pet'].includes(String(b.persona))) fields.persona = String(b.persona) as User['persona'];
  if (['en', 'hinglish'].includes(String(b.language))) fields.language = String(b.language) as User['language'];
  if (typeof b.display_name === 'string' && b.display_name.trim()) fields.display_name = b.display_name.trim().slice(0, 30);
  if (typeof b.about === 'string') fields.about = b.about.trim().slice(0, 2000) || null;
  if (Object.keys(fields).length === 0) return c.json({ error: 'nothing valid to update' }, 400);
  await repo.updateUser(deps.db, player.id, fields);
  return c.json({ ok: true });
});

adminApi.post('/tick', async (c) => {
  const deps = await buildDeps(c.env);
  const report = await runTick(deps, { force: true });
  return c.json(report);
});

adminApi.post('/test', async (c) => {
  const deps = await buildDeps(c.env);
  const [player, admin] = await Promise.all([repo.getPlayer(deps.db), repo.getAdmin(deps.db)]);
  if (!player || !admin) return c.json({ error: 'users not seeded' }, 500);
  const b = (await c.req.json()) as { what?: string };
  await sendTestMessage(deps, admin, player, String(b.what ?? 'water'), Date.now());
  return c.json({ ok: true, note: 'sent to the admin WhatsApp' });
});
