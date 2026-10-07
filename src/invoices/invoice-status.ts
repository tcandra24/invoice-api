import { BadRequestException } from '@nestjs/common';
import { daysUntil, todayInJakarta } from '../common/date.util';
import { InvoiceStatus, Prisma } from '../generated/prisma/client';

// Transisi MANUAL (kirim, batalkan, cron). Perubahan status akibat
// tambah, ubah, atau batal pembayaran memakai deriveInvoiceStatus di bawah,
// yang sengaja boleh mundur (misalnya PAID kembali ke PARTIALLY_PAID).
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

// Pembayaran boleh diubah atau dibatalkan selama invoice sudah dikirim
// dan belum di-VOID.
export const PAYMENT_EDITABLE_STATUSES: InvoiceStatus[] = [
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
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

/**
 * Menentukan status invoice dari data pembayarannya.
 *  1. Total bayar >= total tagihan      -> PAID (lunas menang atas overdue)
 *  2. Belum lunas, jatuh tempo terlewat -> OVERDUE
 *  3. Belum lunas, sudah ada pembayaran -> PARTIALLY_PAID
 *  4. Belum lunas, belum ada pembayaran -> SENT
 * Jatuh tempo dianggap lewat jika tanggalnya sebelum hari ini (WIB),
 * sama seperti aturan cron.
 */
export function deriveInvoiceStatus(params: {
  total: Prisma.Decimal;
  totalPaid: Prisma.Decimal;
  dueDate: Date;
  today?: Date;
}): InvoiceStatus {
  const { total, totalPaid, dueDate, today = todayInJakarta() } = params;

  if (totalPaid.gte(total)) return 'PAID';
  if (daysUntil(dueDate, today) < 0) return 'OVERDUE';
  if (totalPaid.gt(0)) return 'PARTIALLY_PAID';
  return 'SENT';
}
