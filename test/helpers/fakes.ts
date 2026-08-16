import type { Clock } from '../../src/core/clock';
import type { ButtonSpec, SendResult, Sender } from '../../src/wa/sender';

export interface SentRecord {
  at: number;
  kind: 'text' | 'buttons' | 'template' | 'audio';
  to: string;
  body: string;
  buttons?: ButtonSpec[];
}

export function fakeClock(startMs: number): Clock & { advance(ms: number): void; set(ms: number): void; ms(): number } {
  let t = startMs;
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
    ms: () => t,
  };
}

export function fakeSender(clock: Clock, opts: { fail?: () => boolean } = {}): Sender & { sent: SentRecord[] } {
  const sent: SentRecord[] = [];
  let n = 0;
  const result = (): SendResult =>
    opts.fail?.() ? { ok: false, error: 'fake failure' } : { ok: true, waMessageId: `wamid.out.${++n}` };
  return {
    sent,
    async text(to, body) {
      const r = result();
      if (r.ok) sent.push({ at: clock.now().getTime(), kind: 'text', to, body });
      return r;
    },
    async buttons(to, body, buttons) {
      const r = result();
      if (r.ok) sent.push({ at: clock.now().getTime(), kind: 'buttons', to, body, buttons });
      return r;
    },
    async template(to, name) {
      const r = result();
      if (r.ok) sent.push({ at: clock.now().getTime(), kind: 'template', to, body: `[template:${name}]` });
      return r;
    },
    async audio(to, link) {
      const r = result();
      if (r.ok) sent.push({ at: clock.now().getTime(), kind: 'audio', to, body: link });
      return r;
    },
  };
}

/** Epoch ms for an IST wall-clock time, e.g. istMs('2026-08-21', '14:30'). IST = UTC+5:30, no DST. */
export function istMs(day: string, hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return Date.parse(`${day}T00:00:00.000Z`) + ((h - 5) * 60 + (m - 30)) * 60_000;
}
