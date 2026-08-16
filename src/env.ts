export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  WA_TOKEN: string;
  WA_PHONE_ID: string;
  WA_APP_SECRET: string;
  WA_VERIFY_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  ADMIN_KEY?: string;
  TEST_MODE?: string;
  DRY_RUN?: string;
  DEV_SKIP_SIGNATURE?: string;
  LLM_MODEL?: string;
  TEMPLATE_NAME?: string;
  TEMPLATE_LANG?: string;
  GRAPH_VERSION?: string;
  PUBLIC_BASE_URL?: string;
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
}

export const CONFIG = {
  // Proactive-message budget (replies to her messages never count).
  MAX_NUDGES_PER_DAY: 10,
  SOFT_MAX_NUDGES: 2,
  // The 24h customer-service window, with a safety margin.
  WINDOW_MS: 23.5 * 60 * 60 * 1000,
  // Points
  POINT_PER_UNIT: 1, // per glass etc. for 'spread' habits
  PERFECT_DAY_POINTS: 20,
  // Streak milestones that can trigger coupons / celebration.
  STREAK_THRESHOLDS: [3, 7, 14, 30, 50, 100],
  PERFECT_WEEK: 7,
  // Escalation
  MAX_ESCALATION: 3,
  // Catch-up trigger: this many units behind with <= this much time left.
  CATCHUP_BEHIND: 3,
  CATCHUP_WINDOW_MIN: 120,
  // Streak-save fires within this many minutes of window end.
  STREAK_SAVE_WINDOW_MIN: 120,
  STREAK_SAVE_MIN_STREAK: 3,
  // Water pacing gap bounds (minutes) + how many units behind pace counts as "behind".
  PACING_GAP_MIN: 60,
  PACING_GAP_MAX: 180,
  PACING_TOLERANCE: 1,
  // Message constraints
  MAX_CHARS: 300,
  MAX_CHARS_REPORT: 900,
  // Alerts
  SEND_FAIL_ALERT_AFTER: 3,
  // Report
  REPORT_HOUR_MIN: 20 * 60, // 20:00 local
  DEFAULT_MODEL: 'claude-opus-5',
} as const;
