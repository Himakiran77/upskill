export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "today", "yesterday", "4 days ago" */
export function daysAgo(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** "4 Oct" in the center's time zone. */
export function shortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(new Date(iso));
}

/** "Tue 6 Oct 2026" in the center's time zone. */
export function longDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/** Weekday initial for a YYYY-MM-DD calendar day. */
export const weekdayInitial = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' }).format(utc(day));

/** "Monday 5 Oct" for a YYYY-MM-DD calendar day. */
export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utc(day));

/** Day of the month for a YYYY-MM-DD calendar day: "5". */
export const dayOfMonth = (day: string) => String(Number(day.slice(8, 10)));

/** "AR" for "Aisha Rahman". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
