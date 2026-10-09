import { daysUntil, todayInJakarta } from '../common/date.util';
import { Prisma } from '../generated/prisma/client';

/** Asia/Jakarta (WIB) tidak memakai DST, selalu UTC+7. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Kunci bulan 'YYYY-MM' menurut WIB. */
export function monthKey(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Awal bulan (00:00 WIB) untuk kunci 'YYYY-MM', sebagai instant UTC. */
export function startOfMonthJakarta(key: string): Date {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1) - WIB_OFFSET_MS);
}

/** Kunci bulan berurutan naik, berakhir di bulan berjalan (WIB). */
export function buildMonthKeys(
  months: number,
  today: Date = todayInJakarta(),
): string[] {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth(); // 0-based

  return Array.from({ length: months }, (_, i) => {
    const date = new Date(Date.UTC(year, month - (months - 1) + i, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export interface DatedAmount {
  at: Date;
  amount: Prisma.Decimal;
}

/** Menjumlahkan per bulan. Bulan tanpa data bernilai 0, di luar rentang diabaikan. */
export function aggregateMonthly(
  keys: string[],
  invoiced: DatedAmount[],
  collected: DatedAmount[],
) {
  const rows = new Map(
    keys.map((key) => [
      key,
      {
        month: key,
        invoiced: new Prisma.Decimal(0),
        collected: new Prisma.Decimal(0),
      },
    ]),
  );

  for (const entry of invoiced) {
    const row = rows.get(monthKey(entry.at));
    if (row) row.invoiced = row.invoiced.add(entry.amount);
  }
  for (const entry of collected) {
    const row = rows.get(monthKey(entry.at));
    if (row) row.collected = row.collected.add(entry.amount);
  }

  return keys.map((key) => rows.get(key)!);
}

export const AGING_BUCKETS = [
  { key: 'current', label: 'Not yet due', from: -Infinity, to: 0 },
  { key: '1-30', label: '1-30 days overdue', from: 1, to: 30 },
  { key: '31-60', label: '31-60 days overdue', from: 31, to: 60 },
  { key: '61-90', label: '61-90 days overdue', from: 61, to: 90 },
  { key: '90+', label: 'Over 90 days overdue', from: 91, to: Infinity },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];

export interface OutstandingInvoice {
  dueDate: Date;
  remaining: Prisma.Decimal;
}

/** Mengelompokkan sisa tagihan berdasarkan umur keterlambatan (dari tanggal jatuh tempo). */
export function buildAging(
  entries: OutstandingInvoice[],
  today: Date = todayInJakarta(),
) {
  const buckets = AGING_BUCKETS.map((bucket) => ({
    key: bucket.key as AgingBucketKey,
    label: bucket.label as string,
    count: 0,
    amount: new Prisma.Decimal(0),
  }));

  for (const entry of entries) {
    if (entry.remaining.lte(0)) continue;

    const overdueDays = -daysUntil(entry.dueDate, today);
    const index = AGING_BUCKETS.findIndex(
      (bucket) => overdueDays >= bucket.from && overdueDays <= bucket.to,
    );
    buckets[index].count += 1;
    buckets[index].amount = buckets[index].amount.add(entry.remaining);
  }

  const total = buckets.reduce(
    (sum, bucket) => sum.add(bucket.amount),
    new Prisma.Decimal(0),
  );

  return {
    asOf: today.toISOString().slice(0, 10),
    total,
    overdueTotal: total.sub(buckets[0].amount),
    buckets,
  };
}
