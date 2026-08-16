export type Role = 'player' | 'admin';
export type Vibe = 'sassy' | 'sweet' | 'pet';
export type Lang = 'en' | 'hinglish';

export interface User {
  id: string;
  wa_id: string;
  role: Role;
  display_name: string;
  tz: string;
  persona: Vibe | null;
  language: Lang;
  wake_start: string;
  wake_end: string;
  soft_until: number | null;
  paused_until: number | null;
  last_inbound_at: number | null;
  convo_state: string | null;
  about: string | null;
  created_at: number;
}

export type ConvoState =
  | { kind: 'onboarding'; step: 'intro' | 'persona' | 'language' | 'window' | 'window_custom' }
  | { kind: 'redeem_pick'; couponIds: number[] };

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  active: number;
  schedule_type: 'daily' | 'every_n_days' | 'weekly';
  interval_days: number | null;
  anchor_date: string | null;
  weekly_days: string | null;
  anchor_time: string | null;
  window_start: string | null;
  window_end: string | null;
  target_count: number;
  unit: string;
  pacing: 'spread' | 'once';
  nag_max_per_day: number;
  nag_min_gap_min: number;
  points: number;
  streak_enabled: number;
}

export interface HabitLog {
  id?: number;
  habit_id: string;
  user_id: string;
  local_day: string;
  count: number;
  status: 'done' | 'skipped';
  source: 'button' | 'text' | 'admin';
  note?: string | null;
  logged_at: number;
}

export interface Streak {
  key: string;
  user_id: string;
  current: number;
  best: number;
  last_counted_day: string | null;
}

export type NudgeKind = 'morning' | 'reminder' | 'catchup' | 'streak_save' | 'report' | 'template_reopen';

export interface Nudge {
  id?: number;
  user_id: string;
  habit_id: string | null;
  kind: NudgeKind;
  local_day: string;
  escalation: number;
  sent_at: number;
  status: 'sent' | 'failed';
  message_id?: number | null;
}

export interface Snooze {
  habit_id: string;
  local_day: string;
  until: number;
}

export interface Coupon {
  id: number;
  user_id: string;
  title: string;
  description: string | null;
  status: 'stocked' | 'earned' | 'redeemed';
  trigger_type: 'streak_milestone' | 'perfect_week' | 'points' | 'any';
  trigger_value: number | null;
  media_ref: string | null;
  earned_at: number | null;
  earned_for: string | null;
  announced: number;
  redeemed_at: number | null;
  created_at: number;
}

export interface Challenge {
  id: number;
  user_id: string;
  week_start_day: string;
  title: string;
  rule: string; // JSON ChallengeRule
  status: 'active' | 'completed' | 'failed';
  reward_points: number;
  created_at: number;
}

export type ChallengeRule = { type: 'habit_days'; habit_id: string; days: number };

export interface MessageRow {
  id?: number;
  wa_message_id?: string | null;
  user_id: string | null;
  direction: 'in' | 'out';
  kind: string;
  body: string | null;
  brief?: string | null;
  status: string;
  created_at: number;
}

// ---- Scheduler ----

export interface Snapshot {
  now: number; // epoch ms
  localDay: string;
  localMin: number; // minutes into local day
  weekKey: string;
  isSunday: boolean;
  player: User;
  habits: Habit[]; // active, player's
  logsToday: HabitLog[];
  nudgesToday: Nudge[];
  snoozesToday: Snooze[];
  streaks: Record<string, Streak>;
  windowOpen: boolean;
  lastReportWeek: string;
  unannouncedCoupons: Coupon[];
}

export type Facts = Record<string, string | number | boolean>;

export interface TickDecision {
  kind: NudgeKind;
  habitId: string | null;
  escalation: number;
  facts: Facts;
  suppressed?: never;
}

// ---- Composer ----

export type BriefKind =
  | 'morning'
  | 'water_reminder'
  | 'vitamin_reminder'
  | 'catchup'
  | 'streak_save'
  | 'praise_log'
  | 'habit_complete'
  | 'milestone'
  | 'coupon_earned'
  | 'report'
  | 'redeem_confirm'
  | 'reminder_set'
  | 'reminder_fire'
  | 'smalltalk_reply'
  | 'soft_ack'
  | 'skip_ack'
  | 'snooze_ack'
  | 'stale_tap'
  | 'already_done'
  | 'didnt_understand';

export interface MessageBrief {
  kind: BriefKind;
  persona: { vibe: Vibe; language: Lang };
  escalation: 0 | 1 | 2 | 3;
  soft: boolean;
  facts: Facts;
  constraints: { maxChars: number };
}

// ---- Intents ----

export interface Reminder {
  id: number;
  user_id: string;
  text: string;
  due_at: number;
  status: 'pending' | 'sent' | 'cancelled';
  created_at: number;
}

export type Intent =
  | { type: 'log_habit'; habit: string; count: number }
  | { type: 'set_reminder'; text: string; dueLocal: string } // 'YYYY-MM-DD HH:MM' local
  | { type: 'list_reminders' }
  | { type: 'cancel_reminder'; id: number }
  | { type: 'snooze'; habit: string | null; minutes: number }
  | { type: 'skip_today'; habit: string }
  | { type: 'set_mode'; mode: 'soft' | 'normal'; reason?: string }
  | { type: 'set_persona'; vibe?: Vibe; language?: Lang }
  | { type: 'set_window'; start: string; end: string }
  | { type: 'redeem_coupon'; hint?: string }
  | { type: 'get_status' }
  | { type: 'smalltalk'; gist: string }
  | { type: 'unclear' };

// ---- Milestones ----

export interface Milestone {
  key: string; // e.g. 'water:streak:7' | 'perfect:streak:7'
  trigger_type: 'streak_milestone' | 'perfect_week';
  habit_id: string | null;
  value: number;
  label: string; // human text for facts, e.g. '7-day Water streak'
}
