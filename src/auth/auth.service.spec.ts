import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { hashToken } from './token.util';

describe('AuthService: refresh token dan logout', () => {
  let service: AuthService;

  const prismaMock = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const jwtMock = { signAsync: jest.fn() };
  const configMock = { get: jest.fn() }; // undefined, jadi memakai nilai default

  const user = {
    id: 'u1',
    name: 'A',
    email: 'a@test.com',
    businessName: null,
    password: bcrypt.hashSync('rahasia123', 4),
  };

  const storedToken = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    userId: 'u1',
    familyId: 'fam1',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: { id: 'u1', email: 'a@test.com' },
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock));
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    jwtMock.signAsync.mockResolvedValue('access-token');

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('mengembalikan access + refresh token dan hanya menyimpan hash', async () => {
      prismaMock.user.findUnique.mockResolvedValue(user);

      const result = await service.login({
        email: user.email,
        password: 'rahasia123',
      });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.expiresIn).toBe(900);

      const data = prismaMock.refreshToken.create.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(hashToken(result.refreshToken));
      expect(data.tokenHash).not.toBe(result.refreshToken);
      expect(data.userId).toBe('u1');
      expect(data.familyId).toEqual(expect.any(String));
    });

    it('menolak password salah dan tidak membuat token', async () => {
      prismaMock.user.findUnique.mockResolvedValue(user);

      await expect(
        service.login({ email: user.email, password: 'salah-salah' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotation: mencabut token lama, membuat token baru di family yang sama', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(storedToken());

      const result = await service.refresh('raw-token');

      expect(prismaMock.refreshToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashToken('raw-token') },
        }),
      );
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 't1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      const created = prismaMock.refreshToken.create.mock.calls[0][0].data;
      expect(created.familyId).toBe('fam1');
      expect(result.refreshToken).not.toBe('raw-token');
      expect(result.accessToken).toBe('access-token');
    });

    it('menolak token yang tidak dikenal', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('acak')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('pemakaian ulang token yang sudah dicabut mencabut seluruh family', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(
        storedToken({ revokedAt: new Date() }),
      );

      await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('menolak token kedaluwarsa', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(
        storedToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('kalah balapan (updateMany count 0): family dicabut dan ditolak', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(storedToken());
      prismaMock.refreshToken.updateMany
        .mockResolvedValueOnce({ count: 0 }) // rotasi gagal
        .mockResolvedValueOnce({ count: 1 }); // pencabutan family

      await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledTimes(2);
      expect(prismaMock.refreshToken.updateMany).toHaveBeenLastCalledWith({
        where: { familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('mencabut seluruh family dari token tersebut', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({ familyId: 'fam1' });

      const result = await service.logout('raw-token');

      expect(result.message).toBe('Logout berhasil');
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('idempoten: token tidak dikenal tetap sukses tanpa mencabut apa pun', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.logout('acak')).resolves.toEqual({
        message: 'Logout berhasil',
      });
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('logoutAll', () => {
    it('mencabut semua token aktif milik user', async () => {
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.logoutAll('u1');

      expect(result.sessions).toBe(2);
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
