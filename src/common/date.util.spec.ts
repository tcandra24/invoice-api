import { addDays, daysUntil, toDateOnly } from './date.util';

describe('date.util', () => {
  const due = new Date('2026-11-15T00:00:00.000Z');

  it('daysUntil positif sebelum jatuh tempo', () => {
    expect(daysUntil(due, new Date('2026-11-12T00:00:00.000Z'))).toBe(3);
  });

  it('daysUntil 0 pada hari jatuh tempo', () => {
    expect(daysUntil(due, new Date('2026-11-15T00:00:00.000Z'))).toBe(0);
  });

  it('daysUntil negatif setelah jatuh tempo', () => {
    expect(daysUntil(due, new Date('2026-11-22T00:00:00.000Z'))).toBe(-7);
  });

  it('daysUntil mengabaikan jam', () => {
    expect(daysUntil(due, new Date('2026-11-12T17:45:00.000Z'))).toBe(3);
  });

  it('toDateOnly membuang jam', () => {
    expect(toDateOnly(new Date('2026-11-12T17:45:00.000Z')).toISOString()).toBe(
      '2026-11-12T00:00:00.000Z',
    );
  });

  it('addDays menambah dan mengurangi hari', () => {
    expect(addDays(due, 3).toISOString()).toBe('2026-11-18T00:00:00.000Z');
    expect(addDays(due, -7).toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });
});
