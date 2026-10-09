import { Prisma } from '../generated/prisma/client';
import {
  aggregateMonthly,
  buildAging,
  buildMonthKeys,
  monthKey,
  startOfMonthJakarta,
} from './reports.util';

const D = (v: number) => new Prisma.Decimal(v);

describe('monthKey (WIB)', () => {
  it('tengah bulan', () => {
    expect(monthKey(new Date('2026-10-15T05:00:00.000Z'))).toBe('2026-10');
  });

  it('23:59:59 WIB masih bulan yang sama', () => {
    expect(monthKey(new Date('2026-09-30T16:59:59.000Z'))).toBe('2026-09');
  });

  it('00:00 WIB sudah bulan berikutnya (UTC masih bulan lalu)', () => {
    expect(monthKey(new Date('2026-09-30T17:00:00.000Z'))).toBe('2026-10');
  });

  it('pergantian tahun', () => {
    expect(monthKey(new Date('2026-12-31T17:30:00.000Z'))).toBe('2027-01');
  });
});

describe('startOfMonthJakarta', () => {
  it('awal bulan WIB adalah 17:00 UTC hari terakhir bulan sebelumnya', () => {
    expect(startOfMonthJakarta('2026-10').toISOString()).toBe(
      '2026-09-30T17:00:00.000Z',
    );
  });
});

describe('buildMonthKeys', () => {
  const today = new Date('2026-10-09T00:00:00.000Z');

  it('berakhir di bulan berjalan dan berurutan naik', () => {
    expect(buildMonthKeys(3, today)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('melewati pergantian tahun', () => {
    expect(buildMonthKeys(3, new Date('2026-01-15T00:00:00.000Z'))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('satu bulan saja', () => {
    expect(buildMonthKeys(1, today)).toEqual(['2026-10']);
  });
});

describe('aggregateMonthly', () => {
  const keys = ['2026-08', '2026-09', '2026-10'];

  it('menjumlahkan per bulan dan mengisi bulan kosong dengan 0', () => {
    const result = aggregateMonthly(
      keys,
      [
        { at: new Date('2026-10-02T03:00:00.000Z'), amount: D(1000) },
        { at: new Date('2026-10-20T03:00:00.000Z'), amount: D(500) },
      ],
      [{ at: new Date('2026-09-10T03:00:00.000Z'), amount: D(300) }],
    );

    expect(
      result.map((row) => [row.month, row.invoiced.toString(), row.collected.toString()]),
    ).toEqual([
      ['2026-08', '0', '0'],
      ['2026-09', '0', '300'],
      ['2026-10', '1500', '0'],
    ]);
  });

  it('mengabaikan data di luar rentang', () => {
    const result = aggregateMonthly(
      keys,
      [{ at: new Date('2025-01-10T03:00:00.000Z'), amount: D(999) }],
      [{ at: new Date('2027-01-10T03:00:00.000Z'), amount: D(999) }],
    );

    expect(result.every((row) => row.invoiced.isZero() && row.collected.isZero())).toBe(true);
  });
});

describe('buildAging', () => {
  const today = new Date('2026-11-15T00:00:00.000Z');
  const due = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const entry = (iso: string, remaining = 100) => ({
    dueDate: due(iso),
    remaining: D(remaining),
  });

  it('memasukkan setiap invoice ke kelompok yang tepat (batas inklusif)', () => {
    const result = buildAging(
      [
        entry('2026-11-20'), // belum jatuh tempo
        entry('2026-11-15'), // jatuh tempo hari ini: belum terlambat
        entry('2026-11-14'), // terlambat 1 hari
        entry('2026-10-16'), // terlambat 30 hari
        entry('2026-10-15'), // terlambat 31 hari
        entry('2026-09-16'), // terlambat 60 hari
        entry('2026-09-15'), // terlambat 61 hari
        entry('2026-08-17'), // terlambat 90 hari
        entry('2026-08-16'), // terlambat 91 hari
      ],
      today,
    );

    expect(result.buckets.map((b) => [b.key, b.count, b.amount.toString()])).toEqual([
      ['current', 2, '200'],
      ['1-30', 2, '200'],
      ['31-60', 2, '200'],
      ['61-90', 2, '200'],
      ['90+', 1, '100'],
    ]);
    expect(result.total.toString()).toBe('900');
    expect(result.overdueTotal.toString()).toBe('700');
    expect(result.asOf).toBe('2026-11-15');
  });

  it('selalu mengembalikan kelima kelompok walau kosong', () => {
    const result = buildAging([], today);

    expect(result.buckets).toHaveLength(5);
    expect(result.total.isZero()).toBe(true);
    expect(result.overdueTotal.isZero()).toBe(true);
  });

  it('mengabaikan invoice yang sudah tidak punya sisa tagihan', () => {
    const result = buildAging([entry('2026-11-01', 0)], today);

    expect(result.total.isZero()).toBe(true);
    expect(result.buckets.every((b) => b.count === 0)).toBe(true);
  });
});
