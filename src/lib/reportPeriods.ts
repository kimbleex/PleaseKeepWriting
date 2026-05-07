export type ReportPeriodType = 'WEEK' | 'MONTH';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateStr(dateStr: string): Date | null {
  if (!DATE_RE.test(dateStr)) return null;
  const date = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function getWeekStart(date: Date): Date {
  const day = date.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

export function getMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function getPeriodRange(type: ReportPeriodType, inputStart: Date) {
  const periodStart = type === 'WEEK' ? getWeekStart(inputStart) : getMonthStart(inputStart);
  const periodEnd =
    type === 'WEEK'
      ? addDays(periodStart, 6)
      : new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));

  return { periodStart, periodEnd };
}

export function formatPeriodTitle(type: ReportPeriodType, periodStart: Date, periodEnd: Date): string {
  const start = toDateStr(periodStart);
  const end = toDateStr(periodEnd);
  if (type === 'MONTH') {
    return `${periodStart.getUTCFullYear()}年${periodStart.getUTCMonth() + 1}月月报`;
  }
  return `${start} 至 ${end} 周报`;
}
