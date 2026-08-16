import type { BriefKind, Facts, MessageBrief, Snapshot, TickDecision, User } from '../core/types';
import { CONFIG } from '../env';
import { isSoft } from '../scheduler/decisions';

function personaOf(user: User): MessageBrief['persona'] {
  return { vibe: user.persona ?? 'sweet', language: user.language };
}

export function briefKindFor(d: TickDecision, s: Snapshot): BriefKind {
  switch (d.kind) {
    case 'morning':
      return 'morning';
    case 'report':
      return 'report';
    case 'catchup':
      return 'catchup';
    case 'streak_save':
      return 'streak_save';
    case 'reminder': {
      const habit = s.habits.find((h) => h.id === d.habitId);
      return habit?.pacing === 'spread' ? 'water_reminder' : 'vitamin_reminder';
    }
    default:
      return 'didnt_understand';
  }
}

export function buildBrief(d: TickDecision, s: Snapshot, factsOverride?: Facts): MessageBrief {
  const kind = briefKindFor(d, s);
  return {
    kind,
    persona: personaOf(s.player),
    escalation: Math.min(Math.max(d.escalation, 0), 3) as 0 | 1 | 2 | 3,
    soft: isSoft(s.player, s.now),
    facts: factsOverride ?? d.facts,
    constraints: { maxChars: kind === 'report' ? CONFIG.MAX_CHARS_REPORT : CONFIG.MAX_CHARS },
  };
}

/** Briefs for webhook-side replies (praise, acks, smalltalk, ...). */
export function replyBrief(kind: BriefKind, user: User, nowMs: number, facts: Facts): MessageBrief {
  return {
    kind,
    persona: personaOf(user),
    escalation: 0,
    soft: isSoft(user, nowMs),
    facts,
    constraints: { maxChars: kind === 'report' ? CONFIG.MAX_CHARS_REPORT : CONFIG.MAX_CHARS },
  };
}
