import type { ConvoState } from './types';

export function parseConvoState(raw: string | null): ConvoState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ConvoState;
    if (v && typeof v === 'object' && 'kind' in v) return v;
  } catch {
    // corrupted state — treat as none
  }
  return null;
}

export function serializeConvoState(state: ConvoState | null): string | null {
  return state === null ? null : JSON.stringify(state);
}
