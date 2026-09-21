import type { Season } from '../sim/types';

/** Calendar: 4 seasons × 30 days = a 120-day year. Day 1 = 1 Spring, Year 1. */
export const DAYS_PER_SEASON = 30;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const SEASON_NAMES: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};

export function seasonOfDay(day: number): Season {
  return SEASONS[Math.floor(((day - 1) % DAYS_PER_YEAR) / DAYS_PER_SEASON)];
}

export function yearOfDay(day: number): number {
  return Math.floor((day - 1) / DAYS_PER_YEAR) + 1;
}

export function dayOfSeason(day: number): number {
  return (((day - 1) % DAYS_PER_YEAR) % DAYS_PER_SEASON) + 1;
}

/** Third of the season, for flavor text: Early/Mid/Late Summer. */
export function seasonPhase(day: number): 'Early' | 'Mid' | 'Late' {
  const d = dayOfSeason(day);
  return d <= 10 ? 'Early' : d <= 20 ? 'Mid' : 'Late';
}

export function formatDay(day: number): string {
  return `${seasonPhase(day)} ${SEASON_NAMES[seasonOfDay(day)]}, Year ${yearOfDay(day)}`;
}

export function formatDayShort(day: number): string {
  return `${SEASON_NAMES[seasonOfDay(day)].slice(0, 3)} ${dayOfSeason(day)} · Y${yearOfDay(day)}`;
}

/** Weekly challenge seed phrase derived from the real-world ISO week. */
export function weeklySeedPhrase(now = new Date()): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const diff = now.getTime() - start.getTime();
  const week = Math.floor(diff / (7 * 24 * 3600 * 1000)) + 1;
  return `weekly-${now.getUTCFullYear()}-w${String(week).padStart(2, '0')}`;
}
