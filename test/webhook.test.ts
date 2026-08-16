import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeBtn, encodeBtn } from '../src/core/ids';
import { keywordIntent } from '../src/intents/keywords';
import { parseWindowText } from '../src/flows/onboarding';
import { parseWebhook } from '../src/webhook/parse';
import { log, mkVitamin, mkWater } from './helpers/snapshots';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/webhook/inbound.json'), 'utf8'));

describe('webhook parsing', () => {
  it('extracts text, reply-button, and template-button messages; ignores statuses', () => {
    const { messages } = parseWebhook(fixture);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ kind: 'text', waId: '919900000001', wamid: 'wamid.text.1', text: 'had 2 glasses' });
    expect(messages[1]).toMatchObject({ kind: 'button', buttonId: 'done:water:2026-08-21' });
    expect(messages[2]).toMatchObject({ kind: 'button', buttonId: 'morning_ack' });
  });

  it('tolerates junk payloads', () => {
    expect(parseWebhook(null).messages).toEqual([]);
    expect(parseWebhook({ object: 'something_else' }).messages).toEqual([]);
    expect(parseWebhook({ object: 'whatsapp_business_account', entry: [{}] }).messages).toEqual([]);
  });
});

describe('button id codec', () => {
  it('round-trips every action', () => {
    const done = { action: 'done', habitId: 'water', day: '2026-08-21' } as const;
    const snooze = { action: 'snooze', habitId: 'water', day: '2026-08-21', minutes: 60 } as const;
    const skip = { action: 'skip', habitId: 'multivitamin', day: '2026-08-21' } as const;
    expect(decodeBtn(encodeBtn(done))).toEqual(done);
    expect(decodeBtn(encodeBtn(snooze))).toEqual(snooze);
    expect(decodeBtn(encodeBtn(skip))).toEqual(skip);
    expect(decodeBtn('morning_ack')).toEqual({ action: 'morning_ack' });
    expect(decodeBtn('garbage')).toBeNull();
  });
});

describe('keyword pre-pass', () => {
  const habits = [mkWater(), mkVitamin()];

  it('handles the hot paths without an LLM', () => {
    expect(keywordIntent('redeem', habits, [])).toEqual({ type: 'redeem_coupon' });
    expect(keywordIntent('status', habits, [])).toEqual({ type: 'get_status' });
    expect(keywordIntent('3', habits, [])).toEqual({ type: 'log_habit', habit: 'water', count: 3 });
    expect(keywordIntent('rough day honestly', habits, [])).toMatchObject({ type: 'set_mode', mode: 'soft' });
  });

  it('resolves a bare "done" to the vitamin when both are pending', () => {
    expect(keywordIntent('done', habits, [])).toEqual({ type: 'log_habit', habit: 'multivitamin', count: 1 });
    expect(keywordIntent('ho gaya', habits, [])).toEqual({ type: 'log_habit', habit: 'multivitamin', count: 1 });
  });

  it('resolves "done" to the only pending habit', () => {
    const logs = [log('multivitamin', 1, '09:40')];
    expect(keywordIntent('done', habits, logs)).toEqual({ type: 'log_habit', habit: 'water', count: 1 });
  });

  it('defers real language to the LLM', () => {
    expect(keywordIntent('I think I drank enough today, what do you think?', habits, [])).toBeNull();
  });
});

describe('onboarding window parsing', () => {
  it('parses common phrasings', () => {
    expect(parseWindowText('9am to 9pm')).toEqual({ start: '09:00', end: '21:00' });
    expect(parseWindowText('10 to 11pm')).toEqual({ start: '10:00', end: '23:00' });
    expect(parseWindowText('8:30am - 10:15pm')).toEqual({ start: '08:30', end: '22:15' });
    expect(parseWindowText('10 se 11')).toEqual({ start: '10:00', end: '23:00' });
  });

  it('assumes pm for ambiguous short windows', () => {
    expect(parseWindowText('9 to 10')).toEqual({ start: '09:00', end: '22:00' });
  });

  it('rejects nonsense', () => {
    expect(parseWindowText('whenever')).toBeNull();
    expect(parseWindowText('9pm to 9am')).toBeNull();
    expect(parseWindowText('9am to 11am')).toBeNull(); // explicit but < 4h — surely a mistake
  });
});
