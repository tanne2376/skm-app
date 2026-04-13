/**
 * Returns the Monday (YYYY-MM-DD) that starts the membership week
 * containing the given session date + time.
 *
 * Membership weeks run Mon 00:00 → Sun 12:00.
 * A session on Sunday before noon belongs to the current week;
 * Sunday noon or later belongs to the next week.
 */
export function membershipWeekStart(sessionDate: string, startTime?: string): string {
  // Build a full timestamp if time is provided, otherwise treat as midnight
  const ts = startTime
    ? new Date(`${sessionDate}T${startTime}`)
    : new Date(`${sessionDate}T00:00:00`);

  // Sunday after noon → next week
  if (ts.getDay() === 0 && ts.getHours() >= 12) {
    ts.setDate(ts.getDate() + 1); // push to Monday
  }

  // Roll back to Monday
  const day = ts.getDay(); // 0 = Sun
  const diff = ts.getDate() - day + (day === 0 ? -6 : 1);
  ts.setDate(diff);

  return ts.toISOString().split('T')[0];
}
