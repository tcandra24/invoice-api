import { Prisma } from '../generated/prisma/client';

export function formatRupiah(value: Prisma.Decimal | number | string): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value.toString()));
}

// Nama client/deskripsi item berasal dari input user, jadi wajib di-escape
// sebelum masuk ke HTML email.
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
