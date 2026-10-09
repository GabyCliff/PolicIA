/**
 * Display formatting for the cockpit.
 *
 * Every formatter pins the locale and the UTC time zone: the same value must
 * render identically on the server and on the client (React would otherwise
 * flag a hydration mismatch) and on every host.
 */

const LOCALE = "en-US";

const DAY_FORMATTER = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const DAY_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const TIME_FORMATTER = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** `Oct 14` from an ISO day (`2026-10-14`). */
export function formatDay(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? day : DAY_FORMATTER.format(parsed);
}

/** `Oct 14, 2026` from an ISO day. */
export function formatDayWithYear(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? day : DAY_WITH_YEAR_FORMATTER.format(parsed);
}

/** `Oct 14, 09:30 UTC` from an ISO instant. */
export function formatInstant(instant: string): string {
  const parsed = Date.parse(instant);
  return Number.isNaN(parsed) ? instant : `${TIME_FORMATTER.format(parsed)} UTC`;
}

/** `62%` from a 0..1 ratio. */
export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown currency code: never let formatting break a page.
    return `${Math.round(amount).toLocaleString(LOCALE)} ${currency}`;
  }
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Whole days from `fromIso` to `toDay`, negative when the day is in the past. */
export function daysUntil(fromIso: string, toDay: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/** `in 3 days` / `today` / `4 days ago`, from a whole-day distance. */
export function formatDayDistance(days: number): string {
  if (days === 0) return "today";
  const magnitude = Math.abs(days);
  const unit = magnitude === 1 ? "day" : "days";
  return days > 0 ? `in ${magnitude} ${unit}` : `${magnitude} ${unit} ago`;
}

/** `2 hours ago`, coarse, from an ISO instant to an ISO instant. */
export function formatAgo(instant: string, now: string): string {
  const then = Date.parse(instant);
  const reference = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(reference)) return formatInstant(instant);
  const minutes = Math.max(0, Math.round((reference - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

const TITLE_CASE_EXCEPTIONS: Readonly<Record<string, string>> = {
  wip: "WIP",
  pr: "PR",
  eta: "ETA",
};

/** `sprint_goal_risk` -> `Sprint goal risk`. */
export function humanizeKey(key: string): string {
  const words = key.split(/[_\-\s]+/).filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((word, index) => {
      const special = TITLE_CASE_EXCEPTIONS[word.toLowerCase()];
      if (special) return special;
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(" ");
}
