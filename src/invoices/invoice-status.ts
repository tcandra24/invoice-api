import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus } from '../generated/prisma/client';

const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['SENT', 'VOID'],
  SENT: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE'],
  OVERDUE: ['PAID', 'VOID'],
  PAID: [],
  VOID: [],
};

export const PAYABLE_STATUSES: InvoiceStatus[] = [
  'SENT',
  'PARTIALLY_PAID',
  'OVERDUE',
];

export const OPEN_STATUSES: InvoiceStatus[] = [
  'SENT',
  'PARTIALLY_PAID',
  'OVERDUE',
];

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus) {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(
      `Status invoice tidak bisa berubah dari ${from} ke ${to}`,
    );
  }
}
