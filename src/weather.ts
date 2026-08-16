import type { Facts } from './core/types';

// Open-Meteo daily forecast — free, no API key. Failure = empty facts; the
// morning brief simply goes out without weather.
const CODE_LABELS: [number[], string][] = [
  [[0], 'clear skies'],
  [[1, 2], 'partly cloudy'],
  [[3], 'overcast'],
  [[45, 48], 'foggy'],
  [[51, 53, 55, 56, 57], 'drizzly'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'rainy'],
  [[71, 73, 75, 77, 85, 86], 'snowy'],
  [[95, 96, 99], 'thundery'],
];

export function weatherLabel(code: number): string {
  for (const [codes, label] of CODE_LABELS) if (codes.includes(code)) return label;
  return 'mixed weather';
}

export function buildWeatherFacts(tmax: number, precipProb: number, code: number): Facts {
  const t = Math.round(tmax);
  let line = `Today: ${weatherLabel(code)}, high ${t}°C`;
  if (precipProb >= 50) line += `, ${Math.round(precipProb)}% chance of rain`;
  const facts: Facts = { weatherLine: `${line}.` };
  if (t >= 38) facts.hotDaySuggestion = 'it is a proper scorcher — suggest 2 bonus glasses beyond the target';
  else if (t >= 33) facts.hotDaySuggestion = 'hot day — suggest 1 bonus glass beyond the target';
  return facts;
}

export function makeWeatherFacts(lat: string, lon: string, tz: string): () => Promise<Facts> {
  return async () => {
    if (!lat || !lon) return {};
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
        `&daily=temperature_2m_max,precipitation_probability_max,weather_code&forecast_days=1&timezone=${encodeURIComponent(tz)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return {};
      const data = (await res.json()) as {
        daily?: { temperature_2m_max?: number[]; precipitation_probability_max?: number[]; weather_code?: number[] };
      };
      const tmax = data.daily?.temperature_2m_max?.[0];
      if (typeof tmax !== 'number') return {};
      return buildWeatherFacts(tmax, data.daily?.precipitation_probability_max?.[0] ?? 0, data.daily?.weather_code?.[0] ?? 0);
    } catch {
      return {};
    }
  };
}
