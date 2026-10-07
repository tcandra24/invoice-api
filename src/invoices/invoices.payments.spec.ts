import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from '../reminders/reminders.service';
import { InvoicesService } from './invoices.service';

const D = (v: number | string) => new Prisma.Decimal(v);
const DAY_MS = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 30 * DAY_MS);
const past = () => new Date(Date.now() - 30 * DAY_MS);

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv1',
    userId: 'u1',
    number: 'INV-2026-0001',
    status: 'PAID',
    total: D(1000),
    dueDate: future(),
    paidAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    invoiceId: 'inv1',
    amount: D(400),
    paidAt: new Date('2026-10-01T00:00:00.000Z'),
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

describe('InvoicesService: pembayaran', () => {
  let service: InvoicesService;

  const prismaMock = {
    invoice: { findFirst: jest.fn(), update: jest.fn() },
    payment: {
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const remindersMock = { sendNotice: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock));
    prismaMock.invoice.update.mockResolvedValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RemindersService, useValue: remindersMock },
      ],
    }).compile();

    service = moduleRef.get(InvoicesService);
  });

  describe('addPayment', () => {
    it('hanya menjumlahkan pembayaran aktif dan memperbarui status', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(
        makeInvoice({ status: 'SENT', paidAt: null }),
      );
      prismaMock.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: null } }) // pengecekan sisa
        .mockResolvedValueOnce({
          _sum: { amount: D(300) },
          _max: { paidAt: new Date() },
        }); // hitung ulang
      prismaMock.payment.create.mockResolvedValue(makePayment({ amount: D(300) }));

      const result = await service.addPayment('u1', 'inv1', { amount: 300 });

      expect(prismaMock.payment.aggregate.mock.calls[0][0].where).toEqual({
        invoiceId: 'inv1',
        voidedAt: null,
      });
      expect(result.invoice.status).toBe('PARTIALLY_PAID');
      expect(prismaMock.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'PARTIALLY_PAID', paidAt: null },
      });
    });
  });

  describe('updatePayment', () => {
    it('menolak body kosong sebelum menyentuh database', async () => {
      await expect(
        service.updatePayment('u1', 'inv1', 'p1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('menolak nominal yang membuat total bayar melebihi tagihan', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(makeInvoice());
      prismaMock.payment.findFirst.mockResolvedValue(makePayment());
      // pembayaran aktif lainnya = 600, jadi nominal maksimal = 400
      prismaMock.payment.aggregate.mockResolvedValueOnce({
        _sum: { amount: D(600) },
      });

      await expect(
        service.updatePayment('u1', 'inv1', 'p1', { amount: 500 }),
      ).rejects.toThrow(/melebihi/);
      expect(prismaMock.payment.update).not.toHaveBeenCalled();
    });

    it('PAID turun ke PARTIALLY_PAID saat nominal dikurangi', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(makeInvoice());
      prismaMock.payment.findFirst.mockResolvedValue(makePayment());
      prismaMock.payment.aggregate
        .mockResolvedValueOnce({ _sum: { amount: D(600) } }) // lainnya
        .mockResolvedValueOnce({
          _sum: { amount: D(900) },
          _max: { paidAt: new Date() },
        }); // total setelah diubah
      prismaMock.payment.update.mockResolvedValue(makePayment({ amount: D(300) }));

      const result = await service.updatePayment('u1', 'inv1', 'p1', {
        amount: 300,
      });

      expect(result.invoice.status).toBe('PARTIALLY_PAID');
      expect(result.invoice.remaining.toString()).toBe('100');
      expect(prismaMock.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'PARTIALLY_PAID', paidAt: null },
      });
    });

    it('tidak menulis ulang invoice kalau status dan paidAt tidak berubah', async () => {
      const paidAt = new Date('2026-10-01T00:00:00.000Z');
      prismaMock.invoice.findFirst.mockResolvedValue(makeInvoice({ paidAt }));
      prismaMock.payment.findFirst.mockResolvedValue(makePayment());
      prismaMock.payment.update.mockResolvedValue(
        makePayment({ note: 'koreksi' }),
      );
      prismaMock.payment.aggregate.mockResolvedValueOnce({
        _sum: { amount: D(1000) },
        _max: { paidAt: new Date(paidAt) },
      });

      const result = await service.updatePayment('u1', 'inv1', 'p1', {
        note: 'koreksi',
      });

      expect(result.invoice.status).toBe('PAID');
      expect(prismaMock.invoice.update).not.toHaveBeenCalled();
    });

    it('pembayaran milik user lain dibalas 404', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePayment('u2', 'inv1', 'p1', { note: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('menolak invoice berstatus VOID', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(
        makeInvoice({ status: 'VOID' }),
      );

      await expect(
        service.updatePayment('u1', 'inv1', 'p1', { note: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('pembayaran tidak ditemukan dibalas 404', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(makeInvoice());
      prismaMock.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePayment('u1', 'inv1', 'p1', { note: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('menolak pembayaran yang sudah dibatalkan', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(makeInvoice());
      prismaMock.payment.findFirst.mockResolvedValue(
        makePayment({ voidedAt: new Date() }),
      );

      await expect(
        service.updatePayment('u1', 'inv1', 'p1', { note: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('voidPayment', () => {
    it('membatalkan satu-satunya pembayaran mengembalikan status ke SENT', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(
        makeInvoice({ status: 'PARTIALLY_PAID', paidAt: null }),
      );
      prismaMock.payment.findFirst.mockResolvedValue(makePayment());
      prismaMock.payment.update.mockResolvedValue(
        makePayment({ voidedAt: new Date(), voidReason: 'salah input' }),
      );
      prismaMock.payment.aggregate.mockResolvedValueOnce({
        _sum: { amount: null },
        _max: { paidAt: null },
      });

      const result = await service.voidPayment('u1', 'inv1', 'p1', {
        reason: 'salah input',
      });

      expect(prismaMock.payment.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { voidedAt: expect.any(Date), voidReason: 'salah input' },
      });
      expect(result.invoice.status).toBe('SENT');
      expect(result.invoice.remaining.toString()).toBe('1000');
      expect(prismaMock.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'SENT', paidAt: null },
      });
    });

    it('kembali ke OVERDUE kalau sudah lewat jatuh tempo', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(
        makeInvoice({ status: 'PAID', dueDate: past() }),
      );
      prismaMock.payment.findFirst.mockResolvedValue(makePayment());
      prismaMock.payment.update.mockResolvedValue(
        makePayment({ voidedAt: new Date() }),
      );
      prismaMock.payment.aggregate.mockResolvedValueOnce({
        _sum: { amount: null },
        _max: { paidAt: null },
      });

      const result = await service.voidPayment('u1', 'inv1', 'p1', {});

      expect(result.invoice.status).toBe('OVERDUE');
      expect(prismaMock.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv1' },
        data: { status: 'OVERDUE', paidAt: null },
      });
    });

    it('PAID tetap PARTIALLY_PAID kalau masih ada pembayaran aktif lain', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(makeInvoice());
      prismaMock.payment.findFirst.mockResolvedValue(makePayment());
      prismaMock.payment.update.mockResolvedValue(
        makePayment({ voidedAt: new Date() }),
      );
      prismaMock.payment.aggregate.mockResolvedValueOnce({
        _sum: { amount: D(600) },
        _max: { paidAt: new Date() },
      });

      const result = await service.voidPayment('u1', 'inv1', 'p1', {});

      expect(result.invoice.status).toBe('PARTIALLY_PAID');
      expect(result.invoice.remaining.toString()).toBe('400');
    });
  });
});
