import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from './profile.service';

describe('ProfileService', () => {
  let service: ProfileService;

  const prismaMock = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(ProfileService);
  });

  describe('update', () => {
    it('menolak body kosong sebelum menyentuh database', async () => {
      await expect(service.update('u1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('hanya mengirim field yang diisi', async () => {
      prismaMock.user.update.mockResolvedValue({ id: 'u1', name: 'Baru' });

      await service.update('u1', { name: 'Baru' });

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { name: 'Baru', businessName: undefined },
        }),
      );
    });

    it('null pada businessName mengosongkan nilainya', async () => {
      prismaMock.user.update.mockResolvedValue({ id: 'u1' });

      await service.update('u1', { businessName: null });

      const { data } = prismaMock.user.update.mock.calls[0][0];
      expect(data.businessName).toBeNull();
    });

    it('tidak pernah meminta kolom password', async () => {
      prismaMock.user.update.mockResolvedValue({ id: 'u1' });

      await service.update('u1', { name: 'Baru' });

      const { select } = prismaMock.user.update.mock.calls[0][0];
      expect(select).toBeDefined();
      expect(select.password).toBeUndefined();
    });
  });

  describe('changePassword', () => {
    const stored = { password: bcrypt.hashSync('rahasia123', 4) };

    it('user tidak ditemukan dibalas 404', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('u1', {
          oldPassword: 'rahasia123',
          newPassword: 'passwordBaru1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('password lama salah dibalas 400 (bukan 401) dan tidak mengubah apa pun', async () => {
      prismaMock.user.findUnique.mockResolvedValue(stored);

      await expect(
        service.changePassword('u1', {
          oldPassword: 'salah-salah',
          newPassword: 'passwordBaru1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('menolak password baru yang sama dengan yang lama', async () => {
      prismaMock.user.findUnique.mockResolvedValue(stored);

      await expect(
        service.changePassword('u1', {
          oldPassword: 'rahasia123',
          newPassword: 'rahasia123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('menyimpan hash baru dan mencabut semua sesi', async () => {
      prismaMock.user.findUnique.mockResolvedValue(stored);
      prismaMock.user.update.mockResolvedValue({});
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.changePassword('u1', {
        oldPassword: 'rahasia123',
        newPassword: 'passwordBaru1',
      });

      const { data } = prismaMock.user.update.mock.calls[0][0];
      expect(data.password).not.toBe('passwordBaru1');
      expect(await bcrypt.compare('passwordBaru1', data.password)).toBe(true);

      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.sessions).toBe(2);
      expect(Object.keys(result)).not.toContain('password');
    });
  });
});
