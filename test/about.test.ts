import { describe, expect, it } from 'vitest';
import { composeMessage } from '../src/composer/compose';
import type { MessageBrief, User } from '../src/core/types';
import type { Llm } from '../src/llm/anthropic';
import { repo } from '../src/db/repo';
import { handleAdmin } from '../src/flows/admin';
import type { TickDeps } from '../src/scheduler/tick';
import { fakeClock, fakeSender, istMs } from './helpers/fakes';
import { memoryDb, seedBasics } from './helpers/sqlite';

const brief: MessageBrief = {
  kind: 'water_reminder',
  persona: { vibe: 'sassy', language: 'en' },
  escalation: 0,
  soft: false,
  facts: { done: 2, target: 8 },
  constraints: { maxChars: 300 },
};

function capturingLlm(): Llm & { lastSystem: string } {
  const o = {
    lastSystem: '',
    async complete(system: string): Promise<string> {
      o.lastSystem = system;
      return 'hey, water time';
    },
    async toolCall(): Promise<null> {
      return null;
    },
  };
  return o;
}

describe('about-her memory', () => {
  it('injects the dossier + guardrails into the system prompt', async () => {
    const llm = capturingLlm();
    await composeMessage(brief, llm, [], 0, '• she calls Rishabh "Rishu"\n• chai obsessive');
    expect(llm.lastSystem).toContain('ABOUT HER');
    expect(llm.lastSystem).toContain('Rishu');
    expect(llm.lastSystem).toContain('Never use these to guilt');
  });

  it('omits the block entirely when no notes exist', async () => {
    const llm = capturingLlm();
    await composeMessage(brief, llm, [], 0, null);
    expect(llm.lastSystem).not.toContain('ABOUT HER');
  });

  it('/note appends, /about shows, /name renames, /about clear wipes', async () => {
    const { db, raw } = memoryDb();
    seedBasics(raw);
    const clock = fakeClock(istMs('2026-08-21', '12:00'));
    const send = fakeSender(clock);
    const deps: TickDeps = { db, send, llm: null, clock, templateName: 'hello_world', publicBaseUrl: '' };
    const admin = (await repo.getAdmin(db)) as User;
    const msg = (text: string) => ({ waId: admin.wa_id, wamid: `w.${text}`, kind: 'text' as const, text });

    await handleAdmin(deps, admin, msg('/note she calls him Rishu'), clock.now());
    await handleAdmin(deps, admin, msg('/note chai > water, always'), clock.now());
    let gf = (await repo.getPlayer(db)) as User;
    expect(gf.about).toBe('• she calls him Rishu\n• chai > water, always');

    await handleAdmin(deps, admin, msg('/about'), clock.now());
    expect(send.sent.at(-1)?.body).toContain('chai > water');

    await handleAdmin(deps, admin, msg('/name Priya'), clock.now());
    gf = (await repo.getPlayer(db)) as User;
    expect(gf.display_name).toBe('Priya');

    await handleAdmin(deps, admin, msg('/about clear'), clock.now());
    gf = (await repo.getPlayer(db)) as User;
    expect(gf.about).toBeNull();
  });
});
