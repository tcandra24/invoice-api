import { Prisma, ReminderStage } from '../generated/prisma/client';
import { formatDateId } from '../common/date.util';
import { escapeHtml, formatRupiah } from '../common/format.util';

export interface InvoiceEmailData {
  stage: ReminderStage;
  businessName: string;
  ownerEmail: string;
  clientName: string;
  number: string;
  dueDate: Date;
  items: {
    description: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    amount: Prisma.Decimal;
  }[];
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  remaining: Prisma.Decimal;
  notes?: string | null;
}

export function buildInvoiceEmail(d: InvoiceEmailData) {
  const subjects: Record<ReminderStage, string> = {
    INITIAL: `Invoice ${d.number} dari ${d.businessName}`,
    BEFORE_3: `Pengingat: invoice ${d.number} jatuh tempo 3 hari lagi`,
    ON_DUE: `Invoice ${d.number} jatuh tempo hari ini`,
    AFTER_3: `Invoice ${d.number} terlambat 3 hari`,
    AFTER_7: `Invoice ${d.number} terlambat 7 hari`,
  };

  const intros: Record<ReminderStage, string> = {
    INITIAL: `Berikut invoice ${d.number} untuk Anda.`,
    BEFORE_3: `Pengingat ramah: invoice ${d.number} akan jatuh tempo dalam 3 hari.`,
    ON_DUE: `Invoice ${d.number} jatuh tempo hari ini.`,
    AFTER_3: `Invoice ${d.number} sudah melewati jatuh tempo 3 hari.`,
    AFTER_7: `Invoice ${d.number} sudah melewati jatuh tempo 7 hari.`,
  };

  const due = formatDateId(d.dueDate);
  const hasDiscount = !d.discount.isZero();
  const hasTax = !d.tax.isZero();
  const hasPaid = !d.paid.isZero();

  // ----- Versi teks -----
  const textLines = [
    `Halo ${d.clientName},`,
    '',
    intros[d.stage],
    '',
    'Rincian:',
    ...d.items.map(
      (i) =>
        `- ${i.description}: ${i.quantity} x ${formatRupiah(i.unitPrice)} = ${formatRupiah(i.amount)}`,
    ),
    '',
    ...(hasDiscount ? [`Diskon: ${formatRupiah(d.discount)}`] : []),
    ...(hasTax ? [`Pajak: ${formatRupiah(d.tax)}`] : []),
    `Total: ${formatRupiah(d.total)}`,
    ...(hasPaid ? [`Sudah dibayar: ${formatRupiah(d.paid)}`] : []),
    `Sisa tagihan: ${formatRupiah(d.remaining)}`,
    `Jatuh tempo: ${due}`,
    ...(d.notes ? ['', `Catatan: ${d.notes}`] : []),
    '',
    'Jika Anda sudah membayar, abaikan pesan ini.',
    `Pertanyaan? Balas email ini atau hubungi ${d.ownerEmail}.`,
    '',
    'Salam,',
    d.businessName,
  ];

  // ----- Versi HTML -----
  const rows = d.items
    .map(
      (i) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(i.description)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${formatRupiah(i.unitPrice)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${formatRupiah(i.amount)}</td>
      </tr>`,
    )
    .join('');

  const summaryRow = (label: string, value: string, bold = false) =>
    `<tr>
      <td colspan="3" style="padding:4px 8px;text-align:right;${bold ? 'font-weight:bold;' : ''}">${label}</td>
      <td style="padding:4px 8px;text-align:right;${bold ? 'font-weight:bold;' : ''}">${value}</td>
    </tr>`;

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
    <p>Halo ${escapeHtml(d.clientName)},</p>
    <p>${escapeHtml(intros[d.stage])}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:6px 8px;text-align:left">Item</th>
          <th style="padding:6px 8px">Qty</th>
          <th style="padding:6px 8px;text-align:right">Harga</th>
          <th style="padding:6px 8px;text-align:right">Jumlah</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        ${hasDiscount ? summaryRow('Diskon', formatRupiah(d.discount)) : ''}
        ${hasTax ? summaryRow('Pajak', formatRupiah(d.tax)) : ''}
        ${summaryRow('Total', formatRupiah(d.total))}
        ${hasPaid ? summaryRow('Sudah dibayar', formatRupiah(d.paid)) : ''}
        ${summaryRow('Sisa tagihan', formatRupiah(d.remaining), true)}
      </tfoot>
    </table>
    <p><strong>Jatuh tempo:</strong> ${escapeHtml(due)}</p>
    ${d.notes ? `<p><strong>Catatan:</strong> ${escapeHtml(d.notes)}</p>` : ''}
    <p style="color:#666;font-size:13px">Jika Anda sudah membayar, abaikan pesan ini.
    Pertanyaan? Balas email ini atau hubungi ${escapeHtml(d.ownerEmail)}.</p>
    <p>Salam,<br>${escapeHtml(d.businessName)}</p>
  </div>`;

  return {
    subject: subjects[d.stage],
    text: textLines.join('\n'),
    html,
  };
}
