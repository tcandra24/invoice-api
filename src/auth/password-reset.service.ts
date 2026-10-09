import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcryptjs';
import {
  EmailMessage,
  NotificationsService,
} from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
} from './password-reset-email';
import { generateRandomToken, hashToken } from './token.util';

const MINUTE_MS = 60 * 1000;

export const FORGOT_PASSWORD_MESSAGE =
  'If the email is registered, a password reset link has been sent.';
const INVALID_TOKEN_MESSAGE = 'Reset token is invalid or has expired';

interface ResetTarget {
  id: string;
  name: string;
  email: string;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly ttlMs: number;
  private readonly cooldownMs: number;
  private readonly resetUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.ttlMs =
      Number(config.get('PASSWORD_RESET_TTL_MINUTES') ?? 30) * MINUTE_MS;
    this.cooldownMs =
      Number(config.get('PASSWORD_RESET_COOLDOWN_MINUTES') ?? 2) * MINUTE_MS;
    this.resetUrl = String(
      config.get('PASSWORD_RESET_URL') ??
        'http://localhost:3001/reset-password',
    );
  }

  // ---------- Minta link reset ----------

  /**
   * Balasan SELALU sama, apa pun hasilnya (email terdaftar atau tidak, email
   * berhasil dikirim atau tidak), agar orang tidak bisa mengecek email mana
   * yang terdaftar. Pekerjaan berat dijalankan di latar belakang supaya waktu
   * respons juga tidak membedakan keduanya.
   */
  async requestReset(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });

    if (user) {
      void this.processReset(user).catch((error) =>
        this.logger.error(
          `Failed to process password reset for user ${user.id}`,
          error instanceof Error ? error.stack : String(error),
        ),
      );
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  /** Dipanggil di latar belakang oleh requestReset. */
  async processReset(user: ResetTarget) {
    // Jeda per akun: permintaan terlalu rapat diabaikan diam-diam
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - this.cooldownMs) },
      },
      select: { id: true },
    });
    if (recent) return;

    const rawToken = generateRandomToken();

    await this.prisma.$transaction(async (tx) => {
      // Hanya link terbaru yang berlaku
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + this.ttlMs),
        },
      });
    });

    const link = new URL(this.resetUrl);
    link.searchParams.set('token', rawToken);

    await this.notifications.sendEmail({
      to: user.email,
      ...buildPasswordResetEmail({
        name: user.name,
        resetLink: link.toString(),
        ttlMinutes: Math.round(this.ttlMs / MINUTE_MS),
      }),
      sensitive: true,
    });
  }

  // ---------- Pakai token untuk mengganti password ----------

  async resetPassword(token: string, newPassword: string) {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { name: true, email: true, password: true } },
      },
    });

    // Pesan sama untuk token tidak dikenal, sudah dipakai, dan kedaluwarsa
    if (!stored || stored.usedAt || stored.expiresAt <= new Date()) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    // Ditolak sebelum token dikonsumsi, jadi user bisa mencoba lagi
    if (await bcrypt.compare(newPassword, stored.user.password)) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    const consumed = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Atomik: hanya satu request yang bisa mengubah usedAt dari null
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) return false;

      await tx.user.update({
        where: { id: stored.userId },
        data: { password: hashed },
      });
      // Link reset lain yang masih beredar dibatalkan
      await tx.passwordResetToken.updateMany({
        where: { userId: stored.userId, usedAt: null },
        data: { usedAt: now },
      });
      // Semua sesi login dicabut
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });

    if (!consumed) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    // Pemberitahuan ke pemilik akun. Kegagalan email tidak menggagalkan reset.
    void this.safeSend({
      to: stored.user.email,
      ...buildPasswordChangedEmail({ name: stored.user.name }),
    });

    return {
      message: 'Password has been reset. Please log in with your new password.',
    };
  }

  // ---------- Pembersihan ----------

  @Cron('30 3 * * *', {
    name: 'cleanup-password-reset-tokens',
    timeZone: 'Asia/Jakarta',
  })
  async cleanupExpiredTokens() {
    try {
      const { count } = await this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      this.logger.log(`Cleanup ${count} expired password reset tokens`);
    } catch (error) {
      this.logger.error(
        'Cleanup of password reset tokens failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // ---------- Helper ----------

  private async safeSend(message: EmailMessage) {
    try {
      await this.notifications.sendEmail(message);
    } catch (error) {
      this.logger.error(
        'Failed to send password notification email',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
