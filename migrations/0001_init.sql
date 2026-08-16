-- habitbot schema v1. All timestamps: UTC epoch ms (INTEGER).
-- All *_day columns: user-local day string 'YYYY-MM-DD'. Times of day: local 'HH:MM'.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wa_id TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player','admin')),
  display_name TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  persona TEXT CHECK (persona IN ('sassy','sweet','pet')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','hinglish')),
  wake_start TEXT NOT NULL DEFAULT '09:00',
  wake_end TEXT NOT NULL DEFAULT '21:00',
  soft_until INTEGER,
  paused_until INTEGER,
  last_inbound_at INTEGER,
  convo_state TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '✅',
  active INTEGER NOT NULL DEFAULT 1,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('daily','every_n_days','weekly')),
  interval_days INTEGER,
  anchor_date TEXT,
  weekly_days TEXT,
  anchor_time TEXT,
  window_start TEXT,
  window_end TEXT,
  target_count INTEGER NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'time',
  pacing TEXT NOT NULL DEFAULT 'once' CHECK (pacing IN ('spread','once')),
  nag_max_per_day INTEGER NOT NULL DEFAULT 3,
  nag_min_gap_min INTEGER NOT NULL DEFAULT 45,
  points INTEGER NOT NULL DEFAULT 10,
  streak_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  local_day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('done','skipped')),
  source TEXT NOT NULL CHECK (source IN ('button','text','admin')),
  note TEXT,
  logged_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_habit_day ON habit_logs(habit_id, local_day);
CREATE INDEX IF NOT EXISTS idx_logs_user_day ON habit_logs(user_id, local_day);

-- key = habit_id, or 'perfect_day'
CREATE TABLE IF NOT EXISTS streaks (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  current INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  last_counted_day TEXT
);

CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('habit_log','habit_complete','perfect_day','streak_bonus','challenge','admin_adjust')),
  ref TEXT,
  local_day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user_day ON points_ledger(user_id, local_day);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'stocked' CHECK (status IN ('stocked','earned','redeemed')),
  trigger_type TEXT NOT NULL DEFAULT 'any' CHECK (trigger_type IN ('streak_milestone','perfect_week','points','any')),
  trigger_value INTEGER,
  media_ref TEXT,
  earned_at INTEGER,
  earned_for TEXT,
  announced INTEGER NOT NULL DEFAULT 0,
  redeemed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  week_start_day TEXT NOT NULL,
  title TEXT NOT NULL,
  rule TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','failed')),
  reward_points INTEGER NOT NULL DEFAULT 25,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_week ON challenges(user_id, week_start_day);

-- Every in/out message. wa_message_id (wamid) UNIQUE is the webhook dedupe key.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT UNIQUE,
  user_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  kind TEXT NOT NULL,
  body TEXT,
  brief TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_user_time ON messages(user_id, created_at DESC);

-- Record of proactive sends; answers every suppression question on tick.
CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  habit_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('morning','reminder','catchup','streak_save','report','template_reopen')),
  local_day TEXT NOT NULL,
  escalation INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  message_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_nudges_user_day ON nudges(user_id, local_day, kind);
CREATE INDEX IF NOT EXISTS idx_nudges_habit_day ON nudges(habit_id, local_day);

CREATE TABLE IF NOT EXISTS snoozes (
  habit_id TEXT NOT NULL,
  local_day TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (habit_id, local_day)
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO system_state (key, value) VALUES
  ('tick_lock', '0'),
  ('last_rollover_day', ''),
  ('last_report_week', ''),
  ('send_fail_streak', '0'),
  ('schema_version', '1');
