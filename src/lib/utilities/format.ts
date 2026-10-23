export const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function relativeTime(date: Date, now = new Date(), locale = "en") {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diff = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

export const formatDate = (d: Date, locale = "en-GB") => d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
export const formatNumber = (n: number, locale = "en") => new Intl.NumberFormat(locale).format(n);
export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
