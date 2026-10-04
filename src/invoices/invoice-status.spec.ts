import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus } from '../generated/prisma/client';
import { PAYABLE_STATUSES, assertTransition } from './invoice-status';

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
