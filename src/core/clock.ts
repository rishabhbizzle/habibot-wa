// All timezone math lives here. Storage is UTC epoch ms; day/time logic uses
// user-local 'YYYY-MM-DD' and 'HH:MM' strings computed via Intl.

export interface Clock {
  now(): Date;
}

export const realClock: Clock = { now: () => new Date() };

const dayFmtCache = new Map<string, Intl.DateTimeFormat>();
const hmFmtCache = new Map<string, Intl.DateTimeFormat>();
const wdFmtCache = new Map<string, Intl.DateTimeFormat>();

function dayFmt(tz: string): Intl.DateTimeFormat {
  let f = dayFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFmtCache.set(tz, f);
  }
  return f;
}

function hmFmt(tz: string): Intl.DateTimeFormat {
  let f = hmFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    hmFmtCache.set(tz, f);
  }
  return f;
}

function wdFmt(tz: string): Intl.DateTimeFormat {
  let f = wdFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    wdFmtCache.set(tz, f);
  }
  return f;
}

/** 'YYYY-MM-DD' in the given tz */
export function localDay(d: Date, tz: string): string {
  return dayFmt(tz).format(d);
}

/** 'HH:MM' (24h) in the given tz */
export function localHM(d: Date, tz: string): string {
  return hmFmt(tz).format(d);
}

/** Minutes elapsed in the local day, 0..1439 */
export function minutesIntoDay(d: Date, tz: string): number {
  return hmToMin(localHM(d, tz));
}

export function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function minToHM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function weekdayShort(d: Date, tz: string): string {
  return wdFmt(tz).format(d); // 'Sun', 'Mon', ...
}

export function isSunday(d: Date, tz: string): boolean {
  return weekdayShort(d, tz) === 'Sun';
}

// ---- Pure calendar-string arithmetic (no tz involved) ----

function toUTC(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  return new Date(toUTC(day) + n * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** 0=Mon ... 6=Sun for a calendar day string */
export function dayOfWeekMon0(day: string): number {
  const dow = new Date(toUTC(day)).getUTCDay(); // 0=Sun
  return (dow + 6) % 7;
}

/** Monday of the week containing `day` — used as the week key */
export function weekKey(day: string): string {
  return addDays(day, -dayOfWeekMon0(day));
}

const WD_SLUGS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export function weekdaySlug(day: string): string {
  return WD_SLUGS[dayOfWeekMon0(day)];
}

/**
 * UTC epoch ms for a local wall-clock time in the given tz. Iterative offset
 * correction — exact for fixed-offset zones (IST) and correct for DST zones
 * outside the ambiguous switchover hour.
 */
export function epochFromLocal(day: string, hm: string, tz: string): number {
  const target = Date.parse(`${day}T${hm}:00.000Z`);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const d = new Date(guess);
    const seenAsUtc = Date.parse(`${localDay(d, tz)}T${localHM(d, tz)}:00.000Z`);
    guess += target - seenAsUtc;
  }
  return guess;
}
