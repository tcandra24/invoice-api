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
    BEFORE_3: `Reminder: invoice ${d.number} due in 3 days`,
    ON_DUE: `Invoice ${d.number} due today`,
    AFTER_3: `Invoice ${d.number} late 3 days`,
    AFTER_7: `Invoice ${d.number} late 7 days`,
  };

  const intros: Record<ReminderStage, string> = {
    INITIAL: `Here is the invoice ${d.number} for You.`,
    BEFORE_3: `Friendly reminder: invoice ${d.number} will be due in 3 days.`,
    ON_DUE: `Invoice ${d.number} is due today.`,
    AFTER_3: `Invoice ${d.number} is late 3 days.`,
    AFTER_7: `Invoice ${d.number} is late 7 days.`,
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
    'Details:',
    ...d.items.map(
      (i) =>
        `- ${i.description}: ${i.quantity} x ${formatRupiah(i.unitPrice)} = ${formatRupiah(i.amount)}`,
    ),
    '',
    ...(hasDiscount ? [`Discount: ${formatRupiah(d.discount)}`] : []),
    ...(hasTax ? [`Tax: ${formatRupiah(d.tax)}`] : []),
    `Total: ${formatRupiah(d.total)}`,
    ...(hasPaid ? [`Paid: ${formatRupiah(d.paid)}`] : []),
    `Remaining: ${formatRupiah(d.remaining)}`,
    `Due: ${due}`,
    ...(d.notes ? ['', `Note: ${d.notes}`] : []),
    '',
    'If you have already paid, please disregard this message.',
    `Questions? Reply to this email or contact ${d.ownerEmail}.`,
    '',
    'Best regards,',
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
          <th style="padding:6px 8px;text-align:right">Price</th>
          <th style="padding:6px 8px;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        ${hasDiscount ? summaryRow('Discount', formatRupiah(d.discount)) : ''}
        ${hasTax ? summaryRow('Tax', formatRupiah(d.tax)) : ''}
        ${summaryRow('Total', formatRupiah(d.total))}
        ${hasPaid ? summaryRow('Paid', formatRupiah(d.paid)) : ''}
        ${summaryRow('Remaining', formatRupiah(d.remaining), true)}
      </tfoot>
    </table>
    <p><strong>Due:</strong> ${escapeHtml(due)}</p>
    ${d.notes ? `<p><strong>Note:</strong> ${escapeHtml(d.notes)}</p>` : ''}
    <p style="color:#666;font-size:13px">If you have already paid, please disregard this message.
    Questions? Reply to this email or contact ${escapeHtml(d.ownerEmail)}.</p>
    <p>Best regards,<br>${escapeHtml(d.businessName)}</p>
  </div>`;

  return {
    subject: subjects[d.stage],
    text: textLines.join('\n'),
    html,
  };
}
