import type { Habit } from '../core/types';
import type { ToolDef } from '../llm/anthropic';

/** Anthropic tool definitions for the intent parser, built per-request so the
 *  habit enum always matches the live habit list. */
export function intentTools(habits: Habit[]): ToolDef[] {
  const habitIds = habits.map((h) => h.id);
  const habitEnum = habitIds.length ? habitIds : ['water'];
  return [
    {
      name: 'log_habit',
      description:
        'She reports having done a habit (e.g. "had 2 glasses", "took it", "ho gaya", "drank a bottle" ~= 2 glasses). Pick the habit from context; count is units done now.',
      input_schema: {
        type: 'object',
        properties: {
          habit: { type: 'string', enum: habitEnum },
          count: { type: 'integer', description: 'units done now; default 1' },
        },
        required: ['habit'],
        additionalProperties: false,
      },
    },
    {
      name: 'snooze',
      description: 'She wants to be reminded later ("in an hour", "after my meeting").',
      input_schema: {
        type: 'object',
        properties: {
          habit: { type: 'string', enum: habitEnum },
          minutes: { type: 'integer', description: 'minutes to snooze; default 60' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'skip_today',
      description: 'She explicitly wants to skip a habit for today (streak freezes, no penalty).',
      input_schema: {
        type: 'object',
        properties: { habit: { type: 'string', enum: habitEnum } },
        required: ['habit'],
        additionalProperties: false,
      },
    },
    {
      name: 'set_mode',
      description:
        'She is having a rough day / wants gentleness ("not today please", "be nice") -> soft. Or wants normal mode back.',
      input_schema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['soft', 'normal'] },
          reason: { type: 'string' },
        },
        required: ['mode'],
        additionalProperties: false,
      },
    },
    {
      name: 'set_persona',
      description: 'She wants a different bot personality ("be nicer" -> sweet, "roast me" -> sassy, "pet mode" -> pet) or language (English/Hinglish).',
      input_schema: {
        type: 'object',
        properties: {
          vibe: { type: 'string', enum: ['sassy', 'sweet', 'pet'] },
          language: { type: 'string', enum: ['en', 'hinglish'] },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'set_reminder',
      description:
        'She asks to be reminded about something at a time ("remind me to call mom at 5", "kal subah yaad dilana parcel ka"). Extract WHAT (short, her words) and WHEN as local 24h "YYYY-MM-DD HH:MM" — always the NEXT upcoming occurrence relative to the current datetime you were given.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'what to remind her about, short, in her words' },
          due_local: { type: 'string', description: 'local time "YYYY-MM-DD HH:MM" (24h)' },
        },
        required: ['text', 'due_local'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_reminders',
      description: 'She asks what reminders are set ("my reminders", "what did I ask you to remind me?").',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'cancel_reminder',
      description: 'She cancels a reminder by its number ("cancel reminder 3").',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'redeem_coupon',
      description: 'She wants to redeem/cash in an earned reward.',
      input_schema: {
        type: 'object',
        properties: { hint: { type: 'string' } },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_status',
      description: 'She asks how she is doing today / streaks / points.',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'smalltalk',
      description: 'Anything conversational that is not a habit action: chat, questions, jokes, feelings, reactions.',
      input_schema: {
        type: 'object',
        properties: { gist: { type: 'string', description: 'one-line summary of what she said' } },
        required: ['gist'],
        additionalProperties: false,
      },
    },
    {
      name: 'unclear',
      description: 'The message cannot be confidently classified.',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ];
}

export const WINDOW_TOOL: ToolDef = {
  name: 'set_window',
  description: 'Extract the daily awake/reminder window from her message (e.g. "10 to 11pm" -> 10:00-23:00).',
  input_schema: {
    type: 'object',
    properties: {
      start: { type: 'string', description: "24h 'HH:MM'" },
      end: { type: 'string', description: "24h 'HH:MM'" },
    },
    required: ['start', 'end'],
    additionalProperties: false,
  },
};
