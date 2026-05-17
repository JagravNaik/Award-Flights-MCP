export function assertDateWindow(startDate: string, endDate: string): void {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Dates must be valid YYYY-MM-DD values.");
  }

  if (start > end) {
    throw new Error("startDate must be on or before endDate.");
  }
}

export function eachDateInclusive(startDate: string, endDate: string): string[] {
  assertDateWindow(startDate, endDate);

  const dates: string[] = [];
  const cursor = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  while (cursor <= end) {
    dates.push(formatDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
