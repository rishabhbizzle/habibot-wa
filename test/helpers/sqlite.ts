import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Db } from '../../src/db/repo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** In-memory better-sqlite3 wrapped in the async Db interface used by prod (D1). */
export function memoryDb(): { db: Db; raw: Database.Database } {
  const raw = new Database(':memory:');
  const dir = join(root, 'migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const db: Db = {
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return raw.prepare(sql).all(...(params as never[])) as T[];
    },
    async first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      return ((raw.prepare(sql).get(...(params as never[])) as T | undefined) ?? null);
    },
    async run(sql: string, ...params: unknown[]) {
      const r = raw.prepare(sql).run(...(params as never[]));
      return { changes: r.changes, lastRowId: Number(r.lastInsertRowid) };
    },
    async batch(stmts) {
      const tx = raw.transaction(() => {
        for (const s of stmts) raw.prepare(s.sql).run(...(s.params as never[]));
      });
      tx();
    },
  };
  return { db, raw };
}

export function seedBasics(raw: Database.Database, opts: { persona?: string | null } = {}): void {
  const persona = opts.persona === undefined ? 'sassy' : opts.persona;
  raw.prepare(
    `INSERT INTO users (id, wa_id, role, display_name, tz, persona, language, wake_start, wake_end, created_at)
     VALUES ('gf', '919900000001', 'player', 'Her', 'Asia/Kolkata', ?, 'en', '09:00', '21:00', 0)`,
  ).run(persona);
  raw.prepare(
    `INSERT INTO users (id, wa_id, role, display_name, tz, persona, language, wake_start, wake_end, created_at)
     VALUES ('admin', '919900000002', 'admin', 'Rishabh', 'Asia/Kolkata', NULL, 'en', '09:00', '21:00', 0)`,
  ).run();
  raw.prepare(
    `INSERT INTO habits (id, user_id, name, emoji, active, schedule_type, interval_days, anchor_date, weekly_days, anchor_time,
      window_start, window_end, target_count, unit, pacing, nag_max_per_day, nag_min_gap_min, points, streak_enabled)
     VALUES ('water', 'gf', 'Water', '💧', 1, 'daily', NULL, NULL, NULL, NULL, '09:00', '21:00', 8, 'glass', 'spread', 5, 45, 10, 1)`,
  ).run();
  raw.prepare(
    `INSERT INTO habits (id, user_id, name, emoji, active, schedule_type, interval_days, anchor_date, weekly_days, anchor_time,
      window_start, window_end, target_count, unit, pacing, nag_max_per_day, nag_min_gap_min, points, streak_enabled)
     VALUES ('multivitamin', 'gf', 'Multivitamin', '💊', 1, 'every_n_days', 2, '2026-08-15', NULL, '09:30', NULL, NULL, 1, 'dose', 'once', 3, 90, 10, 1)`,
  ).run();
  const streaks = raw.prepare(`INSERT INTO streaks (key, user_id, current, best, last_counted_day) VALUES (?, 'gf', 0, 0, NULL)`);
  for (const k of ['water', 'multivitamin', 'perfect_day']) streaks.run(k);
}
