export type PayoutCadence = "monthly_day" | "monthly_ordinal" | "weekly";

export interface PayoutSchedule {
  cadence: PayoutCadence | null;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  ordinal: number | null;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const ORDINAL_NAMES: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  5: "last",
};

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function describeSchedule(s: PayoutSchedule | null | undefined): string {
  if (!s || !s.cadence) return "No schedule set";
  if (s.cadence === "monthly_day" && s.dayOfMonth) {
    return `Monthly on the ${ordinalSuffix(s.dayOfMonth)}`;
  }
  if (
    s.cadence === "monthly_ordinal" &&
    s.ordinal != null &&
    s.dayOfWeek != null
  ) {
    const ord = ORDINAL_NAMES[s.ordinal] ?? `${s.ordinal}th`;
    return `Monthly on the ${ord} ${DAY_NAMES[s.dayOfWeek]}`;
  }
  if (s.cadence === "weekly" && s.dayOfWeek != null) {
    return `Every ${DAY_NAMES[s.dayOfWeek]}`;
  }
  return "No schedule set";
}

/**
 * Returns the next date (UTC) on or after `from` that satisfies the schedule.
 * Returns null when the schedule is incomplete.
 */
export function nextPayoutDate(
  s: PayoutSchedule | null | undefined,
  from: Date = new Date(),
): Date | null {
  if (!s || !s.cadence) return null;
  const start = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );

  if (s.cadence === "monthly_day") {
    if (!s.dayOfMonth) return null;
    return matchMonthlyDay(start, s.dayOfMonth);
  }
  if (s.cadence === "monthly_ordinal") {
    if (s.ordinal == null || s.dayOfWeek == null) return null;
    return matchMonthlyOrdinal(start, s.ordinal, s.dayOfWeek);
  }
  if (s.cadence === "weekly") {
    if (s.dayOfWeek == null) return null;
    return matchWeekly(start, s.dayOfWeek);
  }
  return null;
}

function matchMonthlyDay(from: Date, dayOfMonth: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const candidate = new Date(Date.UTC(y, m, Math.min(dayOfMonth, daysInMonth(y, m))));
  if (candidate.getTime() >= from.getTime()) return candidate;
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1;
  return new Date(Date.UTC(ny, nm, Math.min(dayOfMonth, daysInMonth(ny, nm))));
}

function matchMonthlyOrdinal(
  from: Date,
  ordinal: number,
  dayOfWeek: number,
): Date {
  // Try this month, then next month
  for (let offset = 0; offset < 12; offset++) {
    const y = from.getUTCFullYear();
    const m = from.getUTCMonth() + offset;
    const date = nthWeekdayOfMonth(y, m, ordinal, dayOfWeek);
    if (date.getTime() >= from.getTime()) return date;
  }
  return from;
}

function nthWeekdayOfMonth(
  y: number,
  m: number,
  ordinal: number,
  dayOfWeek: number,
): Date {
  const normalizedY = y + Math.floor(m / 12);
  const normalizedM = ((m % 12) + 12) % 12;
  if (ordinal === 5) {
    // last weekday of the month
    const last = daysInMonth(normalizedY, normalizedM);
    for (let d = last; d >= 1; d--) {
      const dt = new Date(Date.UTC(normalizedY, normalizedM, d));
      if (dt.getUTCDay() === dayOfWeek) return dt;
    }
  }
  let count = 0;
  for (let d = 1; d <= daysInMonth(normalizedY, normalizedM); d++) {
    const dt = new Date(Date.UTC(normalizedY, normalizedM, d));
    if (dt.getUTCDay() === dayOfWeek) {
      count++;
      if (count === ordinal) return dt;
    }
  }
  // fall through (shouldn't happen for valid input)
  return new Date(Date.UTC(normalizedY, normalizedM, 1));
}

function matchWeekly(from: Date, dayOfWeek: number): Date {
  const diff = (dayOfWeek - from.getUTCDay() + 7) % 7;
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + diff);
  return result;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

export function formatScheduleDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
