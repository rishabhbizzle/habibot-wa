-- Seed data. REPLACE the two phone numbers before running:
--   wa_id = full international number, digits only, no '+' (e.g. 9198XXXXXXXX).
-- Run: npm run db:seed:local   (or db:seed:remote after deploy)
--
-- ⚠️ FIRST-INSTALL ONLY. INSERT OR REPLACE overwrites whole rows — re-running
-- this after launch wipes persona, streaks, and the about-her notes.
-- Never commit real phone numbers to git.

INSERT OR REPLACE INTO users (id, wa_id, role, display_name, tz, persona, language, wake_start, wake_end, created_at)
VALUES
  ('gf',    'REPLACE_GF_NUMBER',    'player', 'Her',     'Asia/Kolkata', NULL, 'en', '09:00', '21:00', 1755302400000),
  ('admin', 'REPLACE_ADMIN_NUMBER', 'admin',  'Rishabh', 'Asia/Kolkata', NULL, 'en', '09:00', '21:00', 1755302400000);

INSERT OR REPLACE INTO habits
  (id, user_id, name, emoji, active, schedule_type, interval_days, anchor_date, weekly_days, anchor_time,
   window_start, window_end, target_count, unit, pacing, nag_max_per_day, nag_min_gap_min, points, streak_enabled)
VALUES
  ('water', 'gf', 'Water', '💧', 1, 'daily', NULL, NULL, NULL, NULL,
   '09:00', '21:00', 8, 'glass', 'spread', 5, 45, 10, 1),
  ('multivitamin', 'gf', 'Multivitamin', '💊', 1, 'every_n_days', 2, '2026-08-15', NULL, '09:30',
   NULL, NULL, 1, 'dose', 'once', 3, 90, 10, 1);

INSERT OR REPLACE INTO streaks (key, user_id, current, best, last_counted_day) VALUES
  ('water', 'gf', 0, 0, NULL),
  ('multivitamin', 'gf', 0, 0, NULL),
  ('perfect_day', 'gf', 0, 0, NULL);

-- Starter reward pool (edit/extend via WhatsApp: /coupon add "..." trigger=streak:7)
INSERT INTO coupons (user_id, title, description, status, trigger_type, trigger_value, created_at) VALUES
  ('gf', '1x back massage from Rishabh', 'Redeemable any evening. No take-backs.', 'stocked', 'streak_milestone', 7, 1755302400000),
  ('gf', 'You pick dinner, he pays', NULL, 'stocked', 'streak_milestone', 3, 1755302400000),
  ('gf', 'One no-questions-asked request', 'Use wisely.', 'stocked', 'perfect_week', 7, 1755302400000);
