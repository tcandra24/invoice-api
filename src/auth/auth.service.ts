import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { generateRefreshToken, hashToken } from './token.util';

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  businessName: true,
  createdAt: true,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // masa berlaku access token, dalam detik
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.accessTtlSeconds = Number(config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);
    this.refreshTtlMs =
      Number(config.get('REFRESH_TOKEN_TTL_DAYS') ?? 7) * DAY_MS;
  }

  // ---------- Register, login, profil ----------

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashed,
        businessName: dto.businessName,
      },
      select: publicUserSelect,
    });
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Pesan sengaja sama untuk email salah maupun password salah,
    // supaya orang tidak bisa mengecek email mana yang terdaftar.
    const valid = user && (await bcrypt.compare(dto.password, user.password));
    if (!user || !valid) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    // Login membuka sesi baru = family baru
    const tokens = await this.createSession(this.prisma, user, randomUUID());

    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // ---------- Refresh token ----------

  async refresh(rawToken: string): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!stored) {
      throw new UnauthorizedException('Refresh token is invalid');
    }

    // Token yang sudah dicabut dipakai lagi: kemungkinan dicuri.
    // Seluruh sesi dalam family dicabut, pemilik asli harus login ulang.
    // Pencabutan ini sengaja dilakukan DI LUAR transaksi, supaya tidak ikut
    // dibatalkan (rollback) oleh exception yang dilempar setelahnya.
    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException(
        'Refresh token has been used or revoked, please log in again',
      );
    }

    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    // Rotation: cabut token lama dan buat token baru dalam satu transaksi
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Atomik: hanya satu request yang bisa mengubah revokedAt dari null.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) return null; // kalah balapan dengan request lain

      return this.createSession(tx, stored.user, stored.familyId);
    });

    if (!rotated) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException(
        'Refresh token has been used or revoked, please log in again',
      );
    }
    return rotated;
  }

  // ---------- Logout ----------

  /** Mengakhiri satu sesi. Idempoten: token tidak dikenal tetap dibalas sukses. */
  async logout(rawToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { familyId: true },
    });
    if (stored) {
      await this.revokeFamily(stored.familyId);
    }
    return { message: 'Logout successful' };
  }

  /** Mengakhiri semua sesi milik user (semua perangkat). */
  async logoutAll(userId: string) {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return {
      message: 'All sessions have been terminated successfully',
      sessions: count,
    };
  }

  // ---------- Pembersihan ----------

  @Cron('0 3 * * *', {
    name: 'cleanup-refresh-tokens',
    timeZone: 'Asia/Jakarta',
  })
  async cleanupExpiredTokens() {
    try {
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      this.logger.log(`Cleanup ${count} expired refresh tokens`);
    } catch (error) {
      this.logger.error(
        'Cleanup of refresh tokens failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // ---------- Helper ----------

  private async createSession(
    db: Prisma.TransactionClient,
    user: { id: string; email: string },
    familyId: string,
  ): Promise<AuthTokens> {
    const refreshToken = generateRefreshToken();

    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
