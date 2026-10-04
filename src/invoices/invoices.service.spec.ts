import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from '../reminders/reminders.service';
import { InvoicesService } from './invoices.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv1',
    userId: 'u1',
    status: 'DRAFT',
    dueDate: new Date(Date.now() + 7 * DAY_MS),
    items: [],
    client: { id: 'c1', name: 'PT Maju', email: 'maju@example.com' },
    ...overrides,
  };
}

describe('InvoicesService.send', () => {
  let service: InvoicesService;

  const prismaMock = {
    invoice: { findFirst: jest.fn(), update: jest.fn() },
  };
  const remindersMock = { sendNotice: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RemindersService, useValue: remindersMock },
      ],
    }).compile();

    service = moduleRef.get(InvoicesService);
  });

  it('mengirim email lalu mengubah status menjadi SENT', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(makeInvoice());
    prismaMock.invoice.update.mockResolvedValue({ id: 'inv1', status: 'SENT' });

    const result = await service.send('u1', 'inv1');

    expect(remindersMock.sendNotice).toHaveBeenCalledWith('inv1', 'INITIAL');
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv1' },
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
    // Email dikirim lebih dulu, baru status diubah
    expect(remindersMock.sendNotice.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.invoice.update.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({ id: 'inv1', status: 'SENT' });
  });

  it('menolak kalau client tidak punya email', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({ client: { id: 'c1', name: 'PT Maju', email: null } }),
    );

    await expect(service.send('u1', 'inv1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(remindersMock.sendNotice).not.toHaveBeenCalled();
    expect(prismaMock.invoice.update).not.toHaveBeenCalled();
  });

  it('status tetap DRAFT kalau pengiriman email gagal', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(makeInvoice());
    remindersMock.sendNotice.mockRejectedValue(new Error('SMTP down'));

    await expect(service.send('u1', 'inv1')).rejects.toThrow('SMTP down');
    expect(prismaMock.invoice.update).not.toHaveBeenCalled();
  });

  it('menolak invoice yang bukan DRAFT', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({ status: 'PAID' }),
    );

    await expect(service.send('u1', 'inv1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(remindersMock.sendNotice).not.toHaveBeenCalled();
  });

  it('menolak kalau jatuh tempo sudah lewat', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(
      makeInvoice({ dueDate: new Date(Date.now() - 5 * DAY_MS) }),
    );

    await expect(service.send('u1', 'inv1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(remindersMock.sendNotice).not.toHaveBeenCalled();
  });
});
