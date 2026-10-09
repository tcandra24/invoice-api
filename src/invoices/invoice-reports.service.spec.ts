import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceReportsService } from './invoice-reports.service';

const D = (v: number) => new Prisma.Decimal(v);

describe('InvoiceReportsService', () => {
  let service: InvoiceReportsService;

  const prismaMock = {
    invoice: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
  };

  const today = new Date('2026-10-09T00:00:00.000Z');

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoiceReportsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(InvoiceReportsService);
  });

  describe('monthlyRevenue', () => {
    it('hanya data milik user, tanpa invoice VOID dan pembayaran yang dibatalkan', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([]);
      prismaMock.payment.findMany.mockResolvedValue([]);

      await service.monthlyRevenue('u1', 3, today);

      const invoiceWhere = prismaMock.invoice.findMany.mock.calls[0][0].where;
      expect(invoiceWhere.userId).toBe('u1');
      expect(invoiceWhere.status).toEqual({ not: 'VOID' });
      // Awal bulan terjauh (Agustus 2026) menurut WIB
      expect(invoiceWhere.sentAt.gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');

      const paymentWhere = prismaMock.payment.findMany.mock.calls[0][0].where;
      expect(paymentWhere.voidedAt).toBeNull();
      expect(paymentWhere.invoice).toEqual({ userId: 'u1' });
    });

    it('mengembalikan satu baris per bulan, termasuk yang kosong', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([
        { sentAt: new Date('2026-10-02T03:00:00.000Z'), total: D(1000) },
      ]);
      prismaMock.payment.findMany.mockResolvedValue([
        { paidAt: new Date('2026-09-20T03:00:00.000Z'), amount: D(400) },
      ]);

      const result = await service.monthlyRevenue('u1', 3, today);

      expect(result.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
      expect(result[1].collected.toString()).toBe('400');
      expect(result[2].invoiced.toString()).toBe('1000');
      expect(result[0].invoiced.isZero()).toBe(true);
    });
  });

  describe('receivablesAging', () => {
    it('hanya invoice terbuka milik user, sisa dihitung dari pembayaran aktif', async () => {
      prismaMock.invoice.findMany.mockResolvedValue([
        {
          total: D(1000),
          dueDate: new Date('2026-10-01T00:00:00.000Z'), // terlambat 8 hari
          payments: [{ amount: D(300) }, { amount: D(200) }],
        },
      ]);

      const result = await service.receivablesAging('u1', today);

      const { where, select } = prismaMock.invoice.findMany.mock.calls[0][0];
      expect(where.userId).toBe('u1');
      expect(where.status.in).toEqual(['SENT', 'PARTIALLY_PAID', 'OVERDUE']);
      expect(select.payments.where).toEqual({ voidedAt: null });

      const bucket = result.buckets.find((b) => b.key === '1-30')!;
      expect(bucket.count).toBe(1);
      expect(bucket.amount.toString()).toBe('500');
      expect(result.overdueTotal.toString()).toBe('500');
    });
  });
});
