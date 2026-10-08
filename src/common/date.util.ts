const DAY_MS = 24 * 60 * 60 * 1000;

/** Tanggal hari ini menurut WIB, dinyatakan sebagai 00:00 UTC (tanpa jam). */
export function todayInJakarta(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
  }).format(new Date());
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function toDateOnly(date: Date): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Selisih hari ke jatuh tempo: positif = belum jatuh tempo, negatif = terlambat. */
export function daysUntil(due: Date, today: Date = todayInJakarta()): number {
  return Math.round(
    (toDateOnly(due).getTime() - toDateOnly(today).getTime()) / DAY_MS,
  );
}

export function formatDateId(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(toDateOnly(date));
}

/** Tanggal dan jam dalam WIB, untuk pesan ke user. */
export function formatDateTimeId(date: Date): string {
  const text = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date);
  return `${text} WIB`;
}
