import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '../generated/prisma/client';
import {
  PAYABLE_STATUSES,
  PAYMENT_EDITABLE_STATUSES,
  assertTransition,
  deriveInvoiceStatus,
} from './invoice-status';

describe('assertTransition', () => {
  const valid: [InvoiceStatus, InvoiceStatus][] = [
    ['DRAFT', 'SENT'],
    ['DRAFT', 'VOID'],
    ['SENT', 'PARTIALLY_PAID'],
    ['SENT', 'PAID'],
    ['SENT', 'OVERDUE'],
    ['PARTIALLY_PAID', 'PAID'],
    ['OVERDUE', 'PAID'],
  ];

  it.each(valid)('mengizinkan %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const invalid: [InvoiceStatus, InvoiceStatus][] = [
    ['DRAFT', 'PAID'],
    ['PAID', 'SENT'],
    ['PAID', 'VOID'],
    ['VOID', 'SENT'],
    ['PARTIALLY_PAID', 'VOID'],
  ];

  it.each(invalid)('menolak %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(BadRequestException);
  });
});

describe('PAYABLE_STATUSES', () => {
  it('tidak menerima pembayaran untuk DRAFT, PAID, dan VOID', () => {
    expect(PAYABLE_STATUSES).not.toContain('DRAFT');
    expect(PAYABLE_STATUSES).not.toContain('PAID');
    expect(PAYABLE_STATUSES).not.toContain('VOID');
  });
});

describe('PAYMENT_EDITABLE_STATUSES', () => {
  it('pembayaran bisa diubah selain pada DRAFT dan VOID', () => {
    expect(PAYMENT_EDITABLE_STATUSES).toContain('PAID');
    expect(PAYMENT_EDITABLE_STATUSES).not.toContain('DRAFT');
    expect(PAYMENT_EDITABLE_STATUSES).not.toContain('VOID');
  });
});

describe('deriveInvoiceStatus', () => {
  const D = (v: number) => new Prisma.Decimal(v);
  const today = new Date('2026-11-15T00:00:00.000Z');
  const future = new Date('2026-11-20T00:00:00.000Z');
  const past = new Date('2026-11-10T00:00:00.000Z');

  const cases: [string, number, number, Date, InvoiceStatus][] = [
    ['lunas, jatuh tempo belum lewat', 100, 100, future, 'PAID'],
    ['dibayar melebihi total', 100, 150, future, 'PAID'],
    ['lunas walau sudah lewat jatuh tempo', 100, 100, past, 'PAID'],
    ['sebagian, belum jatuh tempo', 100, 40, future, 'PARTIALLY_PAID'],
    ['sebagian, sudah lewat jatuh tempo', 100, 40, past, 'OVERDUE'],
    ['belum dibayar, belum jatuh tempo', 100, 0, future, 'SENT'],
    ['belum dibayar, sudah lewat jatuh tempo', 100, 0, past, 'OVERDUE'],
    ['tepat di hari jatuh tempo belum dianggap lewat', 100, 0, today, 'SENT'],
  ];

  it.each(cases)('%s', (_name, total, paid, dueDate, expected) => {
    expect(
      deriveInvoiceStatus({
        total: D(total),
        totalPaid: D(paid),
        dueDate,
        today,
      }),
    ).toBe(expected);
  });
});
