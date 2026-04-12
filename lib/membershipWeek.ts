/**
 * Returns the Monday that starts the current membership week.
 *
 * Membership weeks run Mon 00:00 → Sun 12:00.
 * After Sunday noon the "current week" flips to the next Monday.
 */
export function membershipWeekStart(now: Date = new Date()): string {
  const d = new Date(now);

  // Sunday after noon → treat as next Monday's week
  if (d.getDay() === 0 && d.getHours() >= 12) {
    d.setDate(d.getDate() + 1); // push to Monday
  }

  // Roll back to Monday
  const day = d.getDay(); // 0 = Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);

  return formatLocalDate(d);
}

/**
 * Returns the date range [from, to] for the current membership week.
 * Both are YYYY-MM-DD strings (Monday → Sunday).
 */
export function membershipWeekRange(now: Date = new Date()): { from: string; to: string } {
  const from = membershipWeekStart(now);
  // Parse as UTC to avoid DST shifting the date
  const monday = new Date(from + 'T12:00:00Z');
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const to = sunday.toISOString().split('T')[0];
  return { from, to };
}

/** Format a Date as YYYY-MM-DD using local time components. */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
