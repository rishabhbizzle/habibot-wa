export function pluralize(unit: string, n: number): string {
  if (n === 1) return unit;
  return unit.endsWith('s') || unit.endsWith('sh') || unit.endsWith('ch') ? `${unit}es` : `${unit}s`;
}
