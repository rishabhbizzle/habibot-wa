import type { MessageBrief } from '../core/types';
import type { Llm } from '../llm/anthropic';
import { cannedMessage } from './fallbacks';
import { personaBlock, staticRules } from './personas';

export interface ComposeResult {
  text: string;
  fallback: boolean;
}

function sanitize(text: string, maxChars: number): string {
  let t = text.trim();
  // Strip wrapping quotes the model sometimes adds.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) t = t.slice(1, -1).trim();
  t = t.replace(/\n{3,}/g, '\n\n');
  if (t.length > maxChars) t = t.slice(0, maxChars - 1).trimEnd() + '…';
  return t;
}

/**
 * Brief -> persona text. LLM failure of any kind (down, timeout, refusal,
 * empty) falls back to a canned string with facts interpolated — the message
 * still goes out.
 */
export async function composeMessage(
  brief: MessageBrief,
  llm: Llm | null,
  recentOutbound: string[],
  seed = 0,
  about?: string | null,
): Promise<ComposeResult> {
  if (!llm) return { text: cannedMessage(brief, seed), fallback: true };
  try {
    const aboutBlock = about?.trim()
      ? `\n\nABOUT HER (notes from Rishabh — use for warmth, personal touches, and inside jokes. LIGHT TOUCH: at most one personal reference per message, most messages need none. Never use these to guilt, mock, or embarrass her; never reveal that you keep notes; never recite facts back verbatim):\n${about.trim().slice(0, 2000)}`
      : '';
    const system = `${staticRules(brief.constraints.maxChars)}\n\n${personaBlock(brief.persona.vibe, brief.persona.language)}${aboutBlock}`;
    const recent = recentOutbound
      .slice(0, 4)
      .map((m) => `- ${m.slice(0, 120)}`)
      .join('\n');
    const user = `RECENT MESSAGES YOU SENT (context only, do not repeat these openers):\n${recent || '- (none yet)'}\n\nBRIEF:\n${JSON.stringify(
      { kind: brief.kind, escalation: brief.escalation, soft: brief.soft, facts: brief.facts },
    )}\n\nWrite the message.`;
    const maxTokens = brief.kind === 'report' ? 1400 : 1024;
    const text = await llm.complete(system, user, maxTokens);
    return { text: sanitize(text, brief.constraints.maxChars), fallback: false };
  } catch {
    return { text: cannedMessage(brief, seed), fallback: true };
  }
}
