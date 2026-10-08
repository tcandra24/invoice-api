import { Prisma, ReminderStage } from '../generated/prisma/client';
import { buildInvoiceEmail } from './invoice-email';

const D = (v: number) => new Prisma.Decimal(v);

const base = {
  businessName: 'Perseus Studio',
  ownerEmail: 'perseus@example.com',
  clientName: 'PT Maju',
  number: 'INV-2026-0001',
  dueDate: new Date('2026-11-15T00:00:00.000Z'),
  items: [
    {
      description: 'Desain logo',
      quantity: 1,
      unitPrice: D(500000),
      amount: D(500000),
    },
  ],
  discount: D(0),
  tax: D(0),
  total: D(500000),
  paid: D(200000),
  remaining: D(300000),
  notes: null,
};

describe('buildInvoiceEmail', () => {
  it('tahap MANUAL: subjek dan isi memuat nomor, jatuh tempo, dan sisa tagihan', () => {
    const mail = buildInvoiceEmail({ ...base, stage: 'MANUAL' });

    expect(mail.subject).toBe('Pengingat: invoice INV-2026-0001');
    expect(mail.text).toContain('INV-2026-0001');
    expect(mail.text).toContain('November 2026');
    expect(mail.text).toContain('Sisa tagihan');
    expect(mail.html).toContain('PT Maju');
  });

  it('setiap tahap punya subjek yang berbeda', () => {
    const stages: ReminderStage[] = [
      'INITIAL',
      'BEFORE_3',
      'ON_DUE',
      'AFTER_3',
      'AFTER_7',
      'MANUAL',
    ];
    const subjects = stages.map(
      (stage) => buildInvoiceEmail({ ...base, stage }).subject,
    );

    expect(new Set(subjects).size).toBe(stages.length);
  });

  it('nama client di-escape di versi HTML', () => {
    const mail = buildInvoiceEmail({
      ...base,
      clientName: '<script>alert(1)</script>',
      stage: 'MANUAL',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
