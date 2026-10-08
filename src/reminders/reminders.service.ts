import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  Prisma,
  ReminderChannel,
  ReminderStage,
} from '../generated/prisma/client';
import {
  addDays,
  daysUntil,
  formatDateTimeId,
  toDateOnly,
  todayInJakarta,
} from '../common/date.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { OPEN_STATUSES, PAYABLE_STATUSES } from '../invoices/invoice-status';
import { buildInvoiceEmail } from './invoice-email';

const HOUR_MS = 60 * 60 * 1000;

// selisih hari ke jatuh tempo -> tahap reminder otomatis
const STAGE_BY_OFFSET: Record<number, ReminderStage> = {
  3: 'BEFORE_3',
  0: 'ON_DUE',
  [-3]: 'AFTER_3',
  [-7]: 'AFTER_7',
};

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private readonly manualCooldownMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.manualCooldownMs =
      Number(config.get('MANUAL_REMINDER_COOLDOWN_HOURS') ?? 24) * HOUR_MS;
  }

  // ---------- Kirim satu email + catat log ----------

  async sendNotice(invoiceId: string, stage: ReminderStage) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        client: true,
        user: true,
        items: true,
        // Pembayaran yang dibatalkan tidak ikut dihitung
        payments: { where: { voidedAt: null } },
      },
    });

    const recipient = invoice.client.email;
    if (!recipient) {
      throw new BadRequestException('Client have no email');
    }

    const paid = invoice.payments.reduce(
      (sum, p) => sum.add(p.amount),
      new Prisma.Decimal(0),
    );

    const mail = buildInvoiceEmail({
      stage,
      businessName: invoice.user.businessName ?? invoice.user.name,
      ownerEmail: invoice.user.email,
      clientName: invoice.client.name,
      number: invoice.number,
      dueDate: invoice.dueDate,
      items: invoice.items,
      discount: invoice.discount,
      tax: invoice.tax,
      total: invoice.total,
      paid,
      remaining: invoice.total.sub(paid),
      notes: invoice.notes,
    });

    let channel: ReminderChannel;
    try {
      ({ channel } = await this.notifications.sendEmail({
        to: recipient,
        replyTo: invoice.user.email,
        ...mail,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.reminderLog.create({
        data: {
          invoiceId,
          stage,
          channel: this.notifications.channel,
          status: 'FAILED',
          recipient,
          error: message.slice(0, 500),
        },
      });
      throw new BadGatewayException('Failed to send email to client');
    }

    // Baris log dikembalikan, dipakai sebagai response endpoint manual
    return this.prisma.reminderLog.create({
      data: { invoiceId, stage, channel, status: 'SENT', recipient },
    });
  }

  // ---------- Pengingat manual ----------

  /**
   * Dipicu user lewat endpoint. Aturan:
   *  - invoice milik user (kalau bukan: 404)
   *  - status SENT, PARTIALLY_PAID, atau OVERDUE
   *  - client punya email
   *  - jeda minimal sejak pengingat manual terakhir yang BERHASIL (kalau belum: 429)
   * Pengiriman yang gagal tidak menghitung jeda, jadi boleh dicoba lagi.
   */
  async sendManual(userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, userId },
      select: { id: true, status: true, client: { select: { email: true } } },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with id ${invoiceId} not found`);
    }
    if (!PAYABLE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException(
        `Invoice with status ${invoice.status} does not require a reminder`,
      );
    }
    if (!invoice.client.email) {
      throw new BadRequestException(
        'Client have no email, please complete client data first',
      );
    }

    const lastManual = await this.prisma.reminderLog.findFirst({
      where: { invoiceId, stage: 'MANUAL', status: 'SENT' },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    });
    if (lastManual) {
      const nextAllowedAt = new Date(
        lastManual.sentAt.getTime() + this.manualCooldownMs,
      );
      if (nextAllowedAt > new Date()) {
        throw new HttpException(
          `Reminder for this invoice has just been sent. Please try again after ${formatDateTimeId(nextAllowedAt)}`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return this.sendNotice(invoiceId, 'MANUAL');
  }

  // ---------- Job harian ----------

  @Cron('0 8 * * *', { name: 'invoice-reminders', timeZone: 'Asia/Jakarta' })
  async handleCron() {
    try {
      const result = await this.run();
      this.logger.log(`Cron reminder done: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(
        'Cron reminder failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Tandai overdue lalu kirim reminder.
   * userId diisi hanya saat dipicu manual (dibatasi ke data user itu sendiri).
   */
  async run(today: Date = todayInJakarta(), userId?: string) {
    const markedOverdue = await this.markOverdue(today, userId);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        ...(userId && { userId }),
        status: { in: OPEN_STATUSES },
        dueDate: { gte: addDays(today, -7), lte: addDays(today, 3) },
      },
      include: { client: { select: { email: true } } },
    });

    const result = { markedOverdue, sent: 0, failed: 0, skipped: 0 };

    for (const invoice of invoices) {
      const stage = STAGE_BY_OFFSET[daysUntil(invoice.dueDate, today)];
      if (!stage) continue;

      if (!invoice.client.email) {
        result.skipped++;
        continue;
      }

      const alreadySent = await this.prisma.reminderLog.findFirst({
        where: { invoiceId: invoice.id, stage, status: 'SENT' },
        select: { id: true },
      });
      if (alreadySent) {
        result.skipped++;
        continue;
      }

      try {
        await this.sendNotice(invoice.id, stage);
        result.sent++;
      } catch (error) {
        result.failed++;
        this.logger.error(
          `Reminder ${stage} for invoice ${invoice.number} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return result;
  }

  private async markOverdue(today: Date, userId?: string) {
    const { count } = await this.prisma.invoice.updateMany({
      where: {
        ...(userId && { userId }),
        status: { in: ['SENT', 'PARTIALLY_PAID'] },
        dueDate: { lt: today },
      },
      data: { status: 'OVERDUE' },
    });
    return count;
  }

  // ---------- Riwayat ----------

  async findLogs(userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, userId },
      select: { id: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with id ${invoiceId} not found`);
    }
    return this.prisma.reminderLog.findMany({
      where: { invoiceId },
      orderBy: { sentAt: 'desc' },
    });
  }

  // Dipakai controller untuk mengubah query asOf menjadi tanggal murni
  parseAsOf(asOf?: string): Date | undefined {
    return asOf ? toDateOnly(new Date(asOf)) : undefined;
  }
}
