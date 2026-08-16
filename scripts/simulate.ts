/**
 * Day simulator — steps a fake clock through a full day of 15-min ticks with a
 * scripted "her", printing the message timeline. The "is this bot annoying?"
 * preview; runs the exact production decide()/tick path against in-memory sqlite.
 *
 *   npm run simulate            # scenario: normal (logs sometimes)
 *   npm run simulate ignores    # she ignores everything -> watch escalation
 *   npm run simulate perfect    # logs unprompted -> watch the bot stay quiet
 */
import { localHM } from '../src/core/clock';
import { runTick, type TickDeps } from '../src/scheduler/tick';
import { handleInbound } from '../src/webhook/handle';
import { fakeClock, fakeSender, istMs } from '../test/helpers/fakes';
import { memoryDb, seedBasics } from '../test/helpers/sqlite';

const DAY = '2026-08-21'; // Friday; vitamin due
const IST = 'Asia/Kolkata';

type Action = { hm: string; kind: 'text' | 'button'; value: string };

const SCENARIOS: Record<string, Action[]> = {
  normal: [
    { hm: '09:20', kind: 'button', value: `done:multivitamin:${DAY}` },
    { hm: '09:21', kind: 'button', value: `done:water:${DAY}` },
    { hm: '11:35', kind: 'text', value: '2' },
    { hm: '15:05', kind: 'text', value: '2' },
    // then she gets busy and ignores the evening
  ],
  ignores: [],
  perfect: [
    { hm: '09:20', kind: 'button', value: `done:multivitamin:${DAY}` },
    { hm: '10:00', kind: 'text', value: '2' },
    { hm: '12:00', kind: 'text', value: '2' },
    { hm: '14:30', kind: 'text', value: '2' },
    { hm: '17:00', kind: 'text', value: '2' },
    { hm: '19:00', kind: 'text', value: 'thank youuu' },
  ],
};

async function main() {
  const scenario = process.argv[2] ?? 'normal';
  const actions = SCENARIOS[scenario];
  if (!actions) {
    console.error(`Unknown scenario "${scenario}". Options: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  const { db, raw } = memoryDb();
  seedBasics(raw);
  // She texted last night, streaks warmed up, one coupon stocked.
  raw.prepare('UPDATE users SET last_inbound_at = ? WHERE id = ?').run(istMs(DAY, '07:45'), 'gf');
  raw.prepare("UPDATE streaks SET current = 6, best = 6 WHERE key = 'water'").run();
  raw.prepare(
    `INSERT INTO habit_logs (habit_id, user_id, local_day, count, status, source, logged_at)
     VALUES ('water', 'gf', '2026-08-20', 8, 'done', 'text', ?)`,
  ).run(istMs('2026-08-20', '20:00'));
  raw.prepare(
    `INSERT INTO coupons (user_id, title, status, trigger_type, trigger_value, created_at)
     VALUES ('gf', '1x back massage from Rishabh', 'stocked', 'streak_milestone', 7, 0)`,
  ).run();

  const clock = fakeClock(istMs(DAY, '00:00'));
  const send = fakeSender(clock);
  const deps: TickDeps = { db, send, llm: null, clock, templateName: 'morning_checkin', publicBaseUrl: '' };

  const timeline: { at: number; who: 'HER' | 'BOT'; text: string }[] = [];
  let printed = 0;
  const flushSends = () => {
    for (const s of send.sent.slice(printed)) {
      const btns = s.buttons?.length ? `  [${s.buttons.map((b) => b.title).join(' | ')}]` : '';
      timeline.push({ at: s.at, who: 'BOT', text: `${s.body}${btns}` });
    }
    printed = send.sent.length;
  };

  const queue = [...actions];
  for (let tick = 0; tick < 96; tick++) {
    const tickMs = istMs(DAY, '00:00') + tick * 15 * 60_000;
    // Her scripted actions up to this tick fire first, at their own timestamps.
    while (queue.length && istMs(DAY, queue[0].hm) <= tickMs) {
      const a = queue.shift()!;
      clock.set(istMs(DAY, a.hm));
      timeline.push({ at: clock.ms(), who: 'HER', text: a.kind === 'button' ? `taps [${a.value}]` : `"${a.value}"` });
      await handleInbound(deps, {
        waId: '919900000001',
        wamid: `wamid.sim.${tick}.${queue.length}`,
        kind: a.kind === 'button' ? 'button' : 'text',
        text: a.kind === 'text' ? a.value : undefined,
        buttonId: a.kind === 'button' ? a.value : undefined,
      });
      flushSends();
    }
    clock.set(tickMs);
    await runTick(deps);
    flushSends();
  }

  timeline.sort((a, b) => a.at - b.at);
  console.log(`\n=== habitbot simulated day — scenario: ${scenario} (LLM off, canned strings) ===\n`);
  for (const e of timeline) {
    const hm = localHM(new Date(e.at), IST);
    const who = e.who === 'BOT' ? 'BOT →her' : 'HER→bot';
    console.log(`${hm}  ${who}  ${e.text.replace(/\n/g, '\n              ')}`);
  }

  const nudges = raw.prepare('SELECT kind, escalation, status FROM nudges ORDER BY sent_at').all() as {
    kind: string;
    escalation: number;
    status: string;
  }[];
  const logs = raw.prepare('SELECT habit_id, SUM(count) AS units FROM habit_logs WHERE local_day = ? GROUP BY habit_id').all(DAY) as {
    habit_id: string;
    units: number;
  }[];
  console.log(`\n--- day summary ---`);
  console.log(`proactive messages: ${nudges.length} (${nudges.map((n) => `${n.kind}${n.escalation ? `@L${n.escalation}` : ''}`).join(', ') || 'none'})`);
  console.log(`her replies: ${timeline.filter((t) => t.who === 'HER').length}`);
  console.log(`logged today: ${logs.map((l) => `${l.habit_id}=${l.units}`).join(', ') || 'nothing'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
