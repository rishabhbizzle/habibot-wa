import { addDays, localDay } from '../core/clock';
import { serializeConvoState } from '../core/convo';
import type { Habit, HabitLog, User } from '../core/types';
import { repo } from '../db/repo';
import { CONFIG } from '../env';
import { recomputeStreak } from '../engine/rollover';
import { composeMessage } from '../composer/compose';
import type { MessageBrief } from '../core/types';
import { windowOpen } from '../scheduler/snapshot';
import { runTick, type TickDeps } from '../scheduler/tick';
import type { InboundMessage } from '../webhook/parse';
import { startOnboarding } from './onboarding';
import { performLog, nextWakeStartMs } from './logging';
import { sendPlain } from './reply';
import { buildStatusText } from './status';

const HELP = `habitbot admin commands:
/status — her day at a glance
/note <fact> — teach the bot about her ("she calls me Rishu")
/about — see everything it knows | /about clear
/name <name> — what the bot calls her
/tick — force a scheduler tick now
/onboard — (re)start her onboarding
/soft on|off — gentle mode for today
/pause 4h | /resume — pause all reminders
/log <habit> [count] — log on her behalf
/habit list|pause <id>|resume <id>
/coupon add "Title" trigger=streak:7 [media=file.ogg]
/coupon list
/test morning|water|vitamin|report|coupon|escalate
/recount — rebuild streaks from logs
/export — table counts`;

export async function handleAdmin(deps: TickDeps, admin: User, msg: InboundMessage, now: Date): Promise<void> {
  const nowMs = now.getTime();
  const raw = (msg.text ?? msg.buttonId ?? '').trim();
  if (!raw.startsWith('/')) {
    await sendPlain(deps, admin, `(admin) ${HELP}`, nowMs);
    return;
  }
  const [cmd, ...rest] = raw.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  const player = await repo.getPlayer(deps.db);
  if (!player) {
    await sendPlain(deps, admin, 'No player row in DB — run the seed first.', nowMs);
    return;
  }

  switch (cmd.toLowerCase()) {
    case 'help':
      await sendPlain(deps, admin, HELP, nowMs);
      return;

    case 'status':
      await sendPlain(deps, admin, await buildStatusText(deps, player, now), nowMs);
      return;

    case 'tick': {
      const r = await runTick(deps, { force: true });
      const summary = r.ran
        ? r.sent.length
          ? r.sent.map((s) => `${s.kind}${s.habitId ? `:${s.habitId}` : ''} ${s.ok ? '✓' : '✗'}`).join(', ')
          : `nothing to send${r.reason ? ` (${r.reason})` : ''}`
        : `did not run: ${r.reason}`;
      await sendPlain(deps, admin, `tick → ${summary}`, nowMs);
      return;
    }

    case 'onboard': {
      await repo.updateUser(deps.db, player.id, {
        persona: null,
        convo_state: serializeConvoState({ kind: 'onboarding', step: 'intro' }),
      });
      const fresh = { ...player, persona: null };
      if (windowOpen(player, nowMs)) {
        await startOnboarding(deps, fresh as User, now);
        await sendPlain(deps, admin, 'Onboarding intro sent to her.', nowMs);
      } else {
        const res = await deps.send.template(player.wa_id, deps.templateName, {
          name: player.display_name,
          buttonPayload: 'morning_ack',
        });
        await sendPlain(
          deps,
          admin,
          res.ok
            ? 'Her 24h window is closed — sent the template. Onboarding starts when she replies.'
            : `Template send failed: ${res.error ?? 'unknown'}`,
          nowMs,
        );
      }
      return;
    }

    case 'note': {
      const fact = arg.trim().slice(0, 200);
      if (!fact) {
        await sendPlain(deps, admin, 'Usage: /note she loves chai more than people', nowMs);
        return;
      }
      const current = player.about ?? '';
      const next = (current ? current + '\n' : '') + '• ' + fact;
      if (next.length > 2000) {
        await sendPlain(deps, admin, 'The about-her notes are full (2000 chars) — trim with /about clear or edit in the admin panel.', nowMs);
        return;
      }
      await repo.updateUser(deps.db, player.id, { about: next });
      await sendPlain(deps, admin, `Noted (${next.split('\n').length} facts). She'll never know how I got so perceptive.`, nowMs);
      return;
    }

    case 'about': {
      if (arg === 'clear') {
        await repo.updateUser(deps.db, player.id, { about: null });
        await sendPlain(deps, admin, 'Wiped. The bot knows nothing again.', nowMs);
        return;
      }
      await sendPlain(
        deps,
        admin,
        player.about ? `What the bot knows about her:\n${player.about}` : 'Nothing yet — teach it with /note <fact> or the admin panel.',
        nowMs,
      );
      return;
    }

    case 'name': {
      const name = arg.trim().slice(0, 30);
      if (!name) {
        await sendPlain(deps, admin, 'Usage: /name Priya', nowMs);
        return;
      }
      await repo.updateUser(deps.db, player.id, { display_name: name });
      await sendPlain(deps, admin, `Got it — she's "${name}" now.`, nowMs);
      return;
    }

    case 'soft': {
      if (arg === 'on') {
        await repo.updateUser(deps.db, player.id, { soft_until: nextWakeStartMs(nowMs, player) });
        await repo.setState(deps.db, `soft_day:${localDay(now, player.tz)}`, '1');
        await sendPlain(deps, admin, 'Soft mode ON until tomorrow morning.', nowMs);
      } else if (arg === 'off') {
        await repo.updateUser(deps.db, player.id, { soft_until: null });
        await sendPlain(deps, admin, 'Soft mode OFF.', nowMs);
      } else {
        await sendPlain(deps, admin, 'Usage: /soft on|off', nowMs);
      }
      return;
    }

    case 'pause': {
      const m = arg.match(/^(\d{1,3})\s*h/i);
      if (!m) {
        await sendPlain(deps, admin, 'Usage: /pause 4h', nowMs);
        return;
      }
      await repo.updateUser(deps.db, player.id, { paused_until: nowMs + Number(m[1]) * 3600_000 });
      await sendPlain(deps, admin, `Paused all reminders for ${m[1]}h.`, nowMs);
      return;
    }

    case 'resume':
      await repo.updateUser(deps.db, player.id, { paused_until: null });
      await sendPlain(deps, admin, 'Resumed.', nowMs);
      return;

    case 'log': {
      const m = arg.match(/^(\S+)(?:\s+(\d{1,2}))?$/);
      if (!m) {
        await sendPlain(deps, admin, 'Usage: /log water 2', nowMs);
        return;
      }
      const out = await performLog(deps, player, m[1], Number(m[2] ?? 1), 'admin', now);
      await sendPlain(
        deps,
        admin,
        !out.ok || !out.habit
          ? `Unknown habit "${m[1]}"`
          : out.alreadyDone
            ? `${out.habit.name} was already complete.`
            : `Logged. ${out.habit.name}: ${out.newDone}/${out.habit.target_count}${out.completedNow ? ' ✅' : ''}`,
        nowMs,
      );
      return;
    }

    case 'habit': {
      const [sub, id] = arg.split(/\s+/);
      if (sub === 'list' || !sub) {
        const habits = await deps.db.all<Habit>('SELECT * FROM habits WHERE user_id = ?', player.id);
        await sendPlain(
          deps,
          admin,
          habits
            .map(
              (h) =>
                `${h.emoji} ${h.id}: ${h.name} — ${h.schedule_type}${h.interval_days ? `/${h.interval_days}d` : ''}, target ${h.target_count} ${h.unit}, ${h.pacing}${h.active ? '' : ' [PAUSED]'}`,
            )
            .join('\n') || 'no habits',
          nowMs,
        );
      } else if ((sub === 'pause' || sub === 'resume') && id) {
        const r = await deps.db.run('UPDATE habits SET active = ? WHERE id = ? AND user_id = ?', sub === 'resume' ? 1 : 0, id, player.id);
        await sendPlain(deps, admin, r.changes ? `${id} ${sub}d.` : `Unknown habit "${id}"`, nowMs);
      } else {
        await sendPlain(deps, admin, 'Usage: /habit list | /habit pause <id> | /habit resume <id>', nowMs);
      }
      return;
    }

    case 'coupon': {
      if (arg.startsWith('add')) {
        const m = arg.match(/^add\s+"([^"]+)"(?:\s+trigger=(streak|perfect_week|any):?(\d+)?)?(?:\s+media=(\S+))?/);
        if (!m) {
          await sendPlain(deps, admin, 'Usage: /coupon add "1x back massage" trigger=streak:7 [media=note1.ogg]', nowMs);
          return;
        }
        const trigger = m[2] === 'streak' ? 'streak_milestone' : m[2] === 'perfect_week' ? 'perfect_week' : 'any';
        const id = await repo.insertCoupon(deps.db, {
          user_id: player.id,
          title: m[1],
          description: null,
          trigger_type: trigger,
          trigger_value: m[3] ? Number(m[3]) : null,
          media_ref: m[4] ?? null,
          created_at: nowMs,
        });
        await sendPlain(deps, admin, `Coupon #${id} stocked: "${m[1]}" (${trigger}${m[3] ? `:${m[3]}` : ''})`, nowMs);
      } else {
        const rows = await deps.db.all<{ id: number; title: string; status: string; trigger_type: string; trigger_value: number | null }>(
          'SELECT id, title, status, trigger_type, trigger_value FROM coupons WHERE user_id = ? ORDER BY id',
          player.id,
        );
        await sendPlain(
          deps,
          admin,
          rows.map((c) => `#${c.id} [${c.status}] ${c.title} (${c.trigger_type}${c.trigger_value ? `:${c.trigger_value}` : ''})`).join('\n') ||
            'no coupons',
          nowMs,
        );
      }
      return;
    }

    case 'test': {
      await sendTestMessage(deps, admin, player, arg || 'water', nowMs);
      return;
    }

    case 'recount': {
      const habits = await repo.getActiveHabits(deps.db, player.id);
      const yday = addDays(localDay(now, player.tz), -1);
      const days = Array.from({ length: 60 }, (_, i) => addDays(yday, -i));
      const logs = await repo.logsForDays(deps.db, player.id, days);
      const byDay = new Map<string, HabitLog[]>();
      for (const l of logs) {
        const arr = byDay.get(l.local_day) ?? [];
        arr.push(l);
        byDay.set(l.local_day, arr);
      }
      const stmts = habits.map((h) => repo.upsertStreakStmt(recomputeStreak(h, player.id, byDay, days)));
      await deps.db.batch(stmts);
      const streaks = await repo.getStreaks(deps.db, player.id);
      await sendPlain(
        deps,
        admin,
        'Recounted from logs: ' + habits.map((h) => `${h.id}=${streaks[h.id]?.current ?? 0}`).join(', ') + ' (perfect_day untouched)',
        nowMs,
      );
      return;
    }

    case 'export': {
      const tables = ['users', 'habits', 'habit_logs', 'streaks', 'points_ledger', 'coupons', 'challenges', 'messages', 'nudges'];
      const counts: string[] = [];
      for (const t of tables) {
        const row = await deps.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
        counts.push(`${t}: ${row?.n ?? 0}`);
      }
      await sendPlain(deps, admin, counts.join('\n'), nowMs);
      return;
    }

    default:
      await sendPlain(deps, admin, `Unknown command "/${cmd}" — /help`, nowMs);
  }
}

export async function sendTestMessage(deps: TickDeps, admin: User, player: User, what: string, nowMs: number): Promise<void> {
  const persona = { vibe: player.persona ?? 'sassy', language: player.language } as MessageBrief['persona'];
  const briefs: Record<string, MessageBrief> = {
    morning: {
      kind: 'morning',
      persona,
      escalation: 0,
      soft: false,
      facts: { name: player.display_name, dueToday: '💧 Water (8 glasses), 💊 Multivitamin', streaks: 'Water: 4 days' },
      constraints: { maxChars: CONFIG.MAX_CHARS },
    },
    water: {
      kind: 'water_reminder',
      persona,
      escalation: 0,
      soft: false,
      facts: { habit: 'Water', done: 2, target: 8, remaining: 6, hoursLeft: 5, streak: 4 },
      constraints: { maxChars: CONFIG.MAX_CHARS },
    },
    vitamin: {
      kind: 'vitamin_reminder',
      persona,
      escalation: 1,
      soft: false,
      facts: { habit: 'Multivitamin', emoji: '💊', streak: 2 },
      constraints: { maxChars: CONFIG.MAX_CHARS },
    },
    escalate: {
      kind: 'water_reminder',
      persona,
      escalation: 3,
      soft: false,
      facts: { habit: 'Water', done: 1, target: 8, remaining: 7, hoursLeft: 2, streak: 6 },
      constraints: { maxChars: CONFIG.MAX_CHARS },
    },
    coupon: {
      kind: 'coupon_earned',
      persona,
      escalation: 0,
      soft: false,
      facts: { title: '1x back massage from Rishabh', label: '7-day Water streak' },
      constraints: { maxChars: CONFIG.MAX_CHARS },
    },
    report: {
      kind: 'report',
      persona,
      escalation: 0,
      soft: false,
      facts: {
        grade: 'B+',
        overallPct: 82,
        perHabit: '💧 Water: 79% (44/56 glasses) | 💊 Multivitamin: 100% (3/3 days)',
        perfectDays: 2,
        bestDay: 'Wed',
        pointsEarned: 340,
        challengeLine: 'Challenge "5 full water days": COMPLETED ✅ (+30 pts)',
        nextChallengeTitle: 'Full water goal on 6 days',
        nextChallengePoints: 40,
      },
      constraints: { maxChars: CONFIG.MAX_CHARS_REPORT },
    },
    soft: {
      kind: 'soft_ack',
      persona,
      escalation: 0,
      soft: true,
      facts: {},
      constraints: { maxChars: CONFIG.MAX_CHARS },
    },
  };
  const brief = briefs[what];
  if (!brief) {
    await sendPlain(deps, admin, `Usage: /test ${Object.keys(briefs).join('|')}`, nowMs);
    return;
  }
  const { text, fallback } = await composeMessage(brief, deps.llm, [], Math.floor(nowMs / 60000) % 5, player.about);
  await sendPlain(deps, admin, `[test:${what}${fallback ? ' — LLM FELL BACK TO CANNED' : ''}]\n${text}`, nowMs);
}
