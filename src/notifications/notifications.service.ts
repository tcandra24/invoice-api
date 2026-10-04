import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ReminderChannel } from '../generated/prisma/client';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  readonly channel: ReminderChannel;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.from =
      config.get<string>('MAIL_FROM') ??
      'Invoice App <no-reply@invoice-app.test>';

    if (host) {
      const user = config.get<string>('SMTP_USER');
      const pass = config.get<string>('SMTP_PASS');
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(config.get<string>('SMTP_PORT') ?? 587),
        secure: config.get<string>('SMTP_SECURE') === 'true',
        auth: user && pass ? { user, pass } : undefined,
      });
      this.channel = 'EMAIL';
    } else {
      this.transporter = null;
      this.channel = 'LOG';
      this.logger.warn(
        'SMTP_HOST kosong: email hanya dicetak ke log (mode mock)',
      );
    }
  }

  async sendEmail(
    message: EmailMessage,
  ): Promise<{ channel: ReminderChannel }> {
    if (!this.transporter) {
      this.logger.log(
        `[MOCK EMAIL] ke=${message.to} | subjek=${message.subject}\n${message.text}`,
      );
      return { channel: 'LOG' };
    }

    await this.transporter.sendMail({ from: this.from, ...message });
    return { channel: 'EMAIL' };
  }
}
