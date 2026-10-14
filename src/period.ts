import type { Period } from "./types";

export type CalendarDate = { year: number; month: number; day: number };

export function zonedParts(date: Date, timeZone: string): CalendarDate & { hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  let day = Number(bag.day);
  let month = Number(bag.month);
  let year = Number(bag.year);
  if (hour === 24) {
    hour = 0;
    const next = shiftCalendarDay(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  return { year, month, day, hour, minute: Number(bag.minute), second: Number(bag.second) };
}

export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const utc = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
  return zonedAsUtc - utc;
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = timeZoneOffsetMs(new Date(guess), timeZone);
  let instant = guess - offset1;
  const offset2 = timeZoneOffsetMs(new Date(instant), timeZone);
  if (offset2 !== offset1) instant = guess - offset2;
  return new Date(instant);
}

export function shiftCalendarDay(year: number, month: number, day: number, delta: number): CalendarDate {
  const t = new Date(Date.UTC(year, month - 1, day));
  t.setUTCDate(t.getUTCDate() + delta);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseYmd(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Dates must use YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date ${value}.`);
  }
  return { year, month, day };
}

function periodForDay(day: CalendarDate, timeZone: string): Period {
  const next = shiftCalendarDay(day.year, day.month, day.day, 1);
  const start = zonedTimeToUtc(day.year, day.month, day.day, 0, 0, 0, timeZone);
  const end = zonedTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
  return {
    start,
    end,
    label: formatYmd(day.year, day.month, day.day),
    year: String(day.year),
    month: String(day.month).padStart(2, "0"),
  };
}

export function previousReportingPeriod(now: Date, timeZone: string): Period {
  const today = zonedParts(now, timeZone);
  const yesterday = shiftCalendarDay(today.year, today.month, today.day, -1);
  return periodForDay(yesterday, timeZone);
}

export function currentCalendarPeriod(now: Date, timeZone: string): Period {
  const today = zonedParts(now, timeZone);
  return periodForDay(today, timeZone);
}

export function periodFromDates(fromYmd: string, toYmd: string, timeZone: string): Period {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  const start = zonedTimeToUtc(from.year, from.month, from.day, 0, 0, 0, timeZone);
  const endDay = shiftCalendarDay(to.year, to.month, to.day, 1);
  const end = zonedTimeToUtc(endDay.year, endDay.month, endDay.day, 0, 0, 0, timeZone);
  if (end.getTime() <= start.getTime()) throw new Error("Date range end must be on or after the start.");
  if (end.getTime() - start.getTime() > 32 * 24 * 60 * 60 * 1000) {
    throw new Error("Date range cannot exceed 31 days.");
  }
  const startLabel = formatYmd(from.year, from.month, from.day);
  const endLabel = formatYmd(to.year, to.month, to.day);
  return {
    start,
    end,
    label: startLabel === endLabel ? startLabel : `${startLabel}_to_${endLabel}`,
    year: String(from.year),
    month: String(from.month).padStart(2, "0"),
  };
}

export function gmailQuery(period: Period): string {
  const after = Math.floor(period.start.getTime() / 1000);
  const before = Math.floor(period.end.getTime() / 1000);
  return `in:inbox category:primary -category:promotions -category:updates -category:social -category:forums after:${after} before:${before}`;
}

export function nextScheduledInstant(now: Date, timeZone: string, hour: number, minute: number): Date {
  const parts = zonedParts(now, timeZone);
  let day = { year: parts.year, month: parts.month, day: parts.day };
  let instant = zonedTimeToUtc(day.year, day.month, day.day, hour, minute, 0, timeZone);
  if (instant.getTime() <= now.getTime()) {
    day = shiftCalendarDay(day.year, day.month, day.day, 1);
    instant = zonedTimeToUtc(day.year, day.month, day.day, hour, minute, 0, timeZone);
  }
  return instant;
}

export function mostRecentSlot(now: Date, timeZone: string, hour: number, minute: number): Date {
  const parts = zonedParts(now, timeZone);
  let day = { year: parts.year, month: parts.month, day: parts.day };
  let instant = zonedTimeToUtc(day.year, day.month, day.day, hour, minute, 0, timeZone);
  if (instant.getTime() > now.getTime()) {
    day = shiftCalendarDay(day.year, day.month, day.day, -1);
    instant = zonedTimeToUtc(day.year, day.month, day.day, hour, minute, 0, timeZone);
  }
  return instant;
}

export function missedPeriodLabel(now: Date, timeZone: string, hour: number, minute: number): string {
  const slot = mostRecentSlot(now, timeZone, hour, minute);
  return previousReportingPeriod(slot, timeZone).label;
}
