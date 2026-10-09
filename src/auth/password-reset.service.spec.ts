import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FORGOT_PASSWORD_MESSAGE,
  PasswordResetService,
} from './password-reset.service';
import { hashToken } from './token.util';

const MINUTE_MS = 60 * 1000;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  const prismaMock = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    passwordResetToken: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const notificationsMock = { sendEmail: jest.fn() };
  const configMock = { get: jest.fn() };

  const user = { id: 'u1', name: 'Perseus', email: 'perseus@example.com' };

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock));
    notificationsMock.sendEmail.mockResolvedValue({ channel: 'LOG' });
    configMock.get.mockImplementation(
      (key: string) =>
        ({
          PASSWORD_RESET_TTL_MINUTES: 30,
          PASSWORD_RESET_COOLDOWN_MINUTES: 2,
          PASSWORD_RESET_URL: 'https://app.example.com/reset-password',
        })[key],
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = moduleRef.get(PasswordResetService);
  });

  describe('requestReset', () => {
    it('email tidak terdaftar: balasan sama dan tidak memproses apa pun', async () => {
      const spy = jest.spyOn(service, 'processReset').mockResolvedValue();
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await service.requestReset('tidak@ada.com');

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(spy).not.toHaveBeenCalled();
    });

    it('email terdaftar: balasan identik dan pemrosesan dijalankan', async () => {
      const spy = jest.spyOn(service, 'processReset').mockResolvedValue();
      prismaMock.user.findUnique.mockResolvedValue(user);

      const known = await service.requestReset(user.email);
      prismaMock.user.findUnique.mockResolvedValue(null);
      const unknown = await service.requestReset('tidak@ada.com');

      expect(known).toEqual(unknown);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(user);
    });

    it('kegagalan di latar belakang tidak mengubah balasan', async () => {
      jest
        .spyOn(service, 'processReset')
        .mockRejectedValue(new Error('SMTP down'));
      prismaMock.user.findUnique.mockResolvedValue(user);

      await expect(service.requestReset(user.email)).resolves.toEqual({
        message: FORGOT_PASSWORD_MESSAGE,
      });
      await flush(); // beri kesempatan catch di latar belakang berjalan
    });
  });

  describe('processReset', () => {
    it('di dalam masa jeda: tidak membuat token dan tidak mengirim email', async () => {
      prismaMock.passwordResetToken.findFirst.mockResolvedValue({ id: 't0' });

      await service.processReset(user);

      expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
      expect(notificationsMock.sendEmail).not.toHaveBeenCalled();
    });

    it('membuat token ber-hash, membatalkan yang lama, dan mengirim link', async () => {
      prismaMock.passwordResetToken.findFirst.mockResolvedValue(null);
      prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.passwordResetToken.create.mockResolvedValue({});

      await service.processReset(user);

      // Link sebelumnya dibatalkan
      expect(prismaMock.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });

      // Email berisi link dengan token asli
      const mail = notificationsMock.sendEmail.mock.calls[0][0];
      expect(mail.to).toBe(user.email);
      expect(mail.sensitive).toBe(true);
      expect(mail.text).toContain(
        'https://app.example.com/reset-password?token=',
      );
      const rawToken = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];

      // Yang disimpan hanya hash, berlaku sekitar 30 menit
      const { data } = prismaMock.passwordResetToken.create.mock.calls[0][0];
      expect(data.tokenHash).toBe(hashToken(rawToken));
      expect(data.tokenHash).not.toBe(rawToken);
      expect(data.userId).toBe('u1');
      expect(
        Math.abs(data.expiresAt.getTime() - (Date.now() + 30 * MINUTE_MS)),
      ).toBeLessThan(5000);
    });
  });

  describe('resetPassword', () => {
    const storedToken = (overrides: Record<string, unknown> = {}) => ({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10 * MINUTE_MS),
      usedAt: null,
      user: {
        name: 'Perseus',
        email: 'perseus@example.com',
        password: bcrypt.hashSync('rahasia123', 4),
      },
      ...overrides,
    });

    it('menolak token yang tidak dikenal', async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('acak', 'passwordBaru1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('menolak token yang sudah dipakai', async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(
        storedToken({ usedAt: new Date() }),
      );

      await expect(
        service.resetPassword('token', 'passwordBaru1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('menolak token yang kedaluwarsa', async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(
        storedToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.resetPassword('token', 'passwordBaru1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('menolak password baru yang sama dengan yang lama tanpa mengonsumsi token', async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(storedToken());

      await expect(
        service.resetPassword('token', 'rahasia123'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('berhasil: menyimpan hash, mengonsumsi token, mencabut sesi, dan memberi tahu pemilik', async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(storedToken());
      prismaMock.passwordResetToken.updateMany
        .mockResolvedValueOnce({ count: 1 }) // konsumsi token ini
        .mockResolvedValueOnce({ count: 0 }); // batalkan token lain
      prismaMock.user.update.mockResolvedValue({});
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.resetPassword('token-asli', 'passwordBaru1');

      expect(prismaMock.passwordResetToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashToken('token-asli') },
        }),
      );
      expect(prismaMock.passwordResetToken.updateMany).toHaveBeenNthCalledWith(
        1,
        { where: { id: 't1', usedAt: null }, data: { usedAt: expect.any(Date) } },
      );

      const { data } = prismaMock.user.update.mock.calls[0][0];
      expect(data.password).not.toBe('passwordBaru1');
      expect(await bcrypt.compare('passwordBaru1', data.password)).toBe(true);

      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      expect(result.message).toContain('Password has been reset');
      await flush();
      expect(notificationsMock.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'perseus@example.com',
          subject: 'Your password has been changed',
        }),
      );
    });

    it('kalah balapan (count 0): ditolak dan password tidak diubah', async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(storedToken());
      prismaMock.passwordResetToken.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.resetPassword('token', 'passwordBaru1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('kegagalan email pemberitahuan tidak menggagalkan reset', async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue(storedToken());
      prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.user.update.mockResolvedValue({});
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      notificationsMock.sendEmail.mockRejectedValue(new Error('SMTP down'));

      await expect(
        service.resetPassword('token', 'passwordBaru1'),
      ).resolves.toEqual({ message: expect.any(String) });
      await flush();
    });
  });
});
