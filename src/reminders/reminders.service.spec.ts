import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from './reminders.service';

const HOUR_MS = 60 * 60 * 1000;

describe('RemindersService.sendManual', () => {
  let service: RemindersService;
  let sendNoticeSpy: jest.SpyInstance;

  const prismaMock = {
    invoice: { findFirst: jest.fn() },
    reminderLog: { findFirst: jest.fn() },
  };
  const notificationsMock = { sendEmail: jest.fn(), channel: 'LOG' };
  const configMock = { get: jest.fn() };

  const invoice = (overrides: Record<string, unknown> = {}) => ({
    id: 'inv1',
    status: 'SENT',
    client: { email: 'maju@example.com' },
    ...overrides,
  });

  const sentLog = {
    id: 'log1',
    invoiceId: 'inv1',
    stage: 'MANUAL',
    channel: 'LOG',
    status: 'SENT',
    recipient: 'maju@example.com',
    error: null,
    sentAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    configMock.get.mockImplementation((key: string) =>
      key === 'MANUAL_REMINDER_COOLDOWN_HOURS' ? 24 : undefined,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = moduleRef.get(RemindersService);
    sendNoticeSpy = jest
      .spyOn(service, 'sendNotice')
      .mockResolvedValue(sentLog as never);
  });

  it('mengirim pengingat MANUAL dan mengembalikan baris log', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(invoice());
    prismaMock.reminderLog.findFirst.mockResolvedValue(null);

    const result = await service.sendManual('u1', 'inv1');

    expect(sendNoticeSpy).toHaveBeenCalledWith('inv1', 'MANUAL');
    expect(result).toBe(sentLog);
  });

  it('invoice dicari berdasarkan id dan pemilik (user lain dibalas 404)', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(null);

    await expect(service.sendManual('u2', 'inv1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaMock.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv1', userId: 'u2' } }),
    );
    expect(sendNoticeSpy).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'PAID', 'VOID'])(
    'menolak invoice berstatus %s',
    async (status) => {
      prismaMock.invoice.findFirst.mockResolvedValue(invoice({ status }));

      await expect(service.sendManual('u1', 'inv1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(sendNoticeSpy).not.toHaveBeenCalled();
    },
  );

  it.each(['SENT', 'PARTIALLY_PAID', 'OVERDUE'])(
    'mengizinkan invoice berstatus %s',
    async (status) => {
      prismaMock.invoice.findFirst.mockResolvedValue(invoice({ status }));
      prismaMock.reminderLog.findFirst.mockResolvedValue(null);

      await expect(service.sendManual('u1', 'inv1')).resolves.toBe(sentLog);
    },
  );

  it('menolak kalau client tidak punya email', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(
      invoice({ client: { email: null } }),
    );

    await expect(service.sendManual('u1', 'inv1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sendNoticeSpy).not.toHaveBeenCalled();
  });

  it('membalas 429 kalau masih dalam masa jeda', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(invoice());
    prismaMock.reminderLog.findFirst.mockResolvedValue({
      sentAt: new Date(Date.now() - 2 * HOUR_MS),
    });

    const error = await service.sendManual('u1', 'inv1').catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(error.message).toContain('Coba lagi setelah');
    expect(sendNoticeSpy).not.toHaveBeenCalled();
  });

  it('mengizinkan lagi setelah masa jeda lewat', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(invoice());
    prismaMock.reminderLog.findFirst.mockResolvedValue({
      sentAt: new Date(Date.now() - 25 * HOUR_MS),
    });

    await expect(service.sendManual('u1', 'inv1')).resolves.toBe(sentLog);
    expect(sendNoticeSpy).toHaveBeenCalledWith('inv1', 'MANUAL');
  });

  it('jeda hanya dihitung dari pengingat MANUAL yang berhasil dikirim', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(invoice());
    prismaMock.reminderLog.findFirst.mockResolvedValue(null);

    await service.sendManual('u1', 'inv1');

    expect(prismaMock.reminderLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { invoiceId: 'inv1', stage: 'MANUAL', status: 'SENT' },
      }),
    );
  });
});
