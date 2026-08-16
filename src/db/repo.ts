import type {
  Challenge,
  Coupon,
  Habit,
  HabitLog,
  MessageRow,
  Nudge,
  Reminder,
  Snooze,
  Streak,
  User,
} from '../core/types';

// Minimal async DB interface shared by the D1 impl (prod) and the
// better-sqlite3 impl (tests + simulate). SQL stays SQLite-dialect-common.
export interface Db {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastRowId: number | null }>;
  batch(stmts: { sql: string; params: unknown[] }[]): Promise<void>;
}

export function d1Db(d1: D1Database): Db {
  return {
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const res = await d1.prepare(sql).bind(...params).all<T>();
      return res.results ?? [];
    },
    async first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const row = await d1.prepare(sql).bind(...params).first<T>();
      return (row as T | null) ?? null;
    },
    async run(sql: string, ...params: unknown[]) {
      const res = await d1.prepare(sql).bind(...params).run();
      return { changes: res.meta.changes ?? 0, lastRowId: res.meta.last_row_id ?? null };
    },
    async batch(stmts) {
      if (stmts.length === 0) return;
      await d1.batch(stmts.map((s) => d1.prepare(s.sql).bind(...s.params)));
    },
  };
}

// ---- Repo: typed queries ----

export const repo = {
  getUsers(db: Db): Promise<User[]> {
    return db.all<User>('SELECT * FROM users');
  },

  getUser(db: Db, id: string): Promise<User | null> {
    return db.first<User>('SELECT * FROM users WHERE id = ?', id);
  },

  getUserByWaId(db: Db, waId: string): Promise<User | null> {
    return db.first<User>('SELECT * FROM users WHERE wa_id = ?', waId);
  },

  getPlayer(db: Db): Promise<User | null> {
    return db.first<User>("SELECT * FROM users WHERE role = 'player' LIMIT 1");
  },

  getAdmin(db: Db): Promise<User | null> {
    return db.first<User>("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
  },

  async updateUser(db: Db, id: string, fields: Partial<User>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const vals = keys.map((k) => (fields as Record<string, unknown>)[k]);
    await db.run(`UPDATE users SET ${sets} WHERE id = ?`, ...vals, id);
  },

  getActiveHabits(db: Db, userId: string): Promise<Habit[]> {
    return db.all<Habit>('SELECT * FROM habits WHERE user_id = ? AND active = 1', userId);
  },

  getHabit(db: Db, id: string): Promise<Habit | null> {
    return db.first<Habit>('SELECT * FROM habits WHERE id = ?', id);
  },

  logsForDay(db: Db, userId: string, day: string): Promise<HabitLog[]> {
    return db.all<HabitLog>('SELECT * FROM habit_logs WHERE user_id = ? AND local_day = ?', userId, day);
  },

  logsForDays(db: Db, userId: string, days: string[]): Promise<HabitLog[]> {
    const qs = days.map(() => '?').join(',');
    return db.all<HabitLog>(
      `SELECT * FROM habit_logs WHERE user_id = ? AND local_day IN (${qs})`,
      userId,
      ...days,
    );
  },

  insertLogStmt(log: HabitLog): { sql: string; params: unknown[] } {
    return {
      sql: `INSERT INTO habit_logs (habit_id, user_id, local_day, count, status, source, note, logged_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [log.habit_id, log.user_id, log.local_day, log.count, log.status, log.source, log.note ?? null, log.logged_at],
    };
  },

  nudgesForDay(db: Db, userId: string, day: string): Promise<Nudge[]> {
    return db.all<Nudge>('SELECT * FROM nudges WHERE user_id = ? AND local_day = ?', userId, day);
  },

  insertNudgeStmt(n: Nudge): { sql: string; params: unknown[] } {
    return {
      sql: `INSERT INTO nudges (user_id, habit_id, kind, local_day, escalation, sent_at, status, message_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [n.user_id, n.habit_id, n.kind, n.local_day, n.escalation, n.sent_at, n.status, n.message_id ?? null],
    };
  },

  snoozesForDay(db: Db, day: string): Promise<Snooze[]> {
    return db.all<Snooze>('SELECT * FROM snoozes WHERE local_day = ?', day);
  },

  async upsertSnooze(db: Db, s: Snooze): Promise<void> {
    await db.run(
      `INSERT INTO snoozes (habit_id, local_day, until) VALUES (?, ?, ?)
       ON CONFLICT(habit_id, local_day) DO UPDATE SET until = excluded.until`,
      s.habit_id,
      s.local_day,
      s.until,
    );
  },

  async getStreaks(db: Db, userId: string): Promise<Record<string, Streak>> {
    const rows = await db.all<Streak>('SELECT * FROM streaks WHERE user_id = ?', userId);
    return Object.fromEntries(rows.map((r) => [r.key, r]));
  },

  upsertStreakStmt(s: Streak): { sql: string; params: unknown[] } {
    return {
      sql: `INSERT INTO streaks (key, user_id, current, best, last_counted_day) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET current = excluded.current, best = excluded.best, last_counted_day = excluded.last_counted_day`,
      params: [s.key, s.user_id, s.current, s.best, s.last_counted_day],
    };
  },

  insertLedgerStmt(userId: string, delta: number, reason: string, ref: string | null, day: string, now: number) {
    return {
      sql: `INSERT INTO points_ledger (user_id, delta, reason, ref, local_day, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [userId, delta, reason, ref, day, now],
    };
  },

  async pointsBalance(db: Db, userId: string): Promise<number> {
    const row = await db.first<{ total: number | null }>(
      'SELECT SUM(delta) AS total FROM points_ledger WHERE user_id = ?',
      userId,
    );
    return row?.total ?? 0;
  },

  async pointsForDays(db: Db, userId: string, days: string[]): Promise<number> {
    const qs = days.map(() => '?').join(',');
    const row = await db.first<{ total: number | null }>(
      `SELECT SUM(delta) AS total FROM points_ledger WHERE user_id = ? AND local_day IN (${qs})`,
      userId,
      ...days,
    );
    return row?.total ?? 0;
  },

  couponsByStatus(db: Db, userId: string, status: string): Promise<Coupon[]> {
    return db.all<Coupon>('SELECT * FROM coupons WHERE user_id = ? AND status = ? ORDER BY id', userId, status);
  },

  unannouncedCoupons(db: Db, userId: string): Promise<Coupon[]> {
    return db.all<Coupon>(
      "SELECT * FROM coupons WHERE user_id = ? AND status = 'earned' AND announced = 0 ORDER BY id",
      userId,
    );
  },

  async insertCoupon(
    db: Db,
    c: Omit<Coupon, 'id' | 'status' | 'earned_at' | 'earned_for' | 'announced' | 'redeemed_at'>,
  ): Promise<number> {
    const res = await db.run(
      `INSERT INTO coupons (user_id, title, description, status, trigger_type, trigger_value, media_ref, created_at)
       VALUES (?, ?, ?, 'stocked', ?, ?, ?, ?)`,
      c.user_id,
      c.title,
      c.description,
      c.trigger_type,
      c.trigger_value,
      c.media_ref,
      c.created_at,
    );
    return res.lastRowId ?? 0;
  },

  markCouponEarnedStmt(id: number, earnedFor: string, now: number) {
    return {
      sql: `UPDATE coupons SET status = 'earned', earned_at = ?, earned_for = ? WHERE id = ? AND status = 'stocked'`,
      params: [now, earnedFor, id],
    };
  },

  activeChallenge(db: Db, userId: string, weekStart: string): Promise<Challenge | null> {
    return db.first<Challenge>(
      "SELECT * FROM challenges WHERE user_id = ? AND week_start_day = ? ORDER BY id DESC LIMIT 1",
      userId,
      weekStart,
    );
  },

  async insertMessage(db: Db, m: MessageRow): Promise<{ id: number | null; duplicate: boolean }> {
    if (m.wa_message_id) {
      const res = await db.run(
        `INSERT OR IGNORE INTO messages (wa_message_id, user_id, direction, kind, body, brief, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        m.wa_message_id,
        m.user_id,
        m.direction,
        m.kind,
        m.body,
        m.brief ?? null,
        m.status,
        m.created_at,
      );
      return { id: res.lastRowId, duplicate: res.changes === 0 };
    }
    const res = await db.run(
      `INSERT INTO messages (user_id, direction, kind, body, brief, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      m.user_id,
      m.direction,
      m.kind,
      m.body,
      m.brief ?? null,
      m.status,
      m.created_at,
    );
    return { id: res.lastRowId, duplicate: false };
  },

  recentMessages(db: Db, userId: string, limit: number): Promise<MessageRow[]> {
    return db.all<MessageRow>(
      'SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      userId,
      limit,
    );
  },

  async insertReminder(db: Db, userId: string, text: string, dueAt: number, now: number): Promise<number> {
    const r = await db.run(
      `INSERT INTO reminders (user_id, text, due_at, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
      userId,
      text,
      dueAt,
      now,
    );
    return r.lastRowId ?? 0;
  },

  pendingReminders(db: Db, userId: string): Promise<Reminder[]> {
    return db.all<Reminder>(
      "SELECT * FROM reminders WHERE user_id = ? AND status = 'pending' ORDER BY due_at",
      userId,
    );
  },

  dueReminders(db: Db, userId: string, now: number): Promise<Reminder[]> {
    return db.all<Reminder>(
      "SELECT * FROM reminders WHERE user_id = ? AND status = 'pending' AND due_at <= ? ORDER BY due_at",
      userId,
      now,
    );
  },

  async markReminderSent(db: Db, id: number): Promise<void> {
    await db.run("UPDATE reminders SET status = 'sent' WHERE id = ? AND status = 'pending'", id);
  },

  async cancelReminder(db: Db, userId: string, id: number): Promise<boolean> {
    const r = await db.run(
      "UPDATE reminders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'",
      id,
      userId,
    );
    return r.changes > 0;
  },

  async getState(db: Db, key: string): Promise<string> {
    const row = await db.first<{ value: string }>('SELECT value FROM system_state WHERE key = ?', key);
    return row?.value ?? '';
  },

  async setState(db: Db, key: string, value: string): Promise<void> {
    await db.run(
      'INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  },

  /** CAS advisory lock: returns true if acquired (no other tick within staleMs). */
  async acquireTickLock(db: Db, now: number, staleMs: number): Promise<boolean> {
    const res = await db.run(
      "UPDATE system_state SET value = ? WHERE key = 'tick_lock' AND CAST(value AS INTEGER) < ?",
      String(now),
      now - staleMs,
    );
    return res.changes > 0;
  },

  async releaseTickLock(db: Db): Promise<void> {
    await db.run("UPDATE system_state SET value = '0' WHERE key = 'tick_lock'");
  },
};
