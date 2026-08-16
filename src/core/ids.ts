// Button-id codec. Ids embed the local day so stale taps (yesterday's card)
// are detectable: 'done:water:2026-08-15', 'snooze:water:2026-08-15:60',
// 'skip:water:2026-08-15', 'morning_ack'.

export type ButtonAction =
  | { action: 'done'; habitId: string; day: string }
  | { action: 'snooze'; habitId: string; day: string; minutes: number }
  | { action: 'skip'; habitId: string; day: string }
  | { action: 'morning_ack' };

export function encodeBtn(b: ButtonAction): string {
  switch (b.action) {
    case 'done':
      return `done:${b.habitId}:${b.day}`;
    case 'snooze':
      return `snooze:${b.habitId}:${b.day}:${b.minutes}`;
    case 'skip':
      return `skip:${b.habitId}:${b.day}`;
    case 'morning_ack':
      return 'morning_ack';
  }
}

export function decodeBtn(id: string): ButtonAction | null {
  if (id === 'morning_ack') return { action: 'morning_ack' };
  const parts = id.split(':');
  if (parts[0] === 'done' && parts.length === 3) return { action: 'done', habitId: parts[1], day: parts[2] };
  if (parts[0] === 'skip' && parts.length === 3) return { action: 'skip', habitId: parts[1], day: parts[2] };
  if (parts[0] === 'snooze' && parts.length === 4) {
    const minutes = Number(parts[3]);
    if (Number.isFinite(minutes)) return { action: 'snooze', habitId: parts[1], day: parts[2], minutes };
  }
  return null;
}
