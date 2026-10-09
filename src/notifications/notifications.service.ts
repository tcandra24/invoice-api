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
  /** Isi berisi rahasia (misalnya token). Tidak dicetak ke log di production. */
  sensitive?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly isProduction: boolean;
  readonly channel: ReminderChannel;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
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
        'SMTP_HOST empty: email is only printed to the log (mode mock)',
      );
    }
  }

  async sendEmail(
    message: EmailMessage,
  ): Promise<{ channel: ReminderChannel }> {
    const { sensitive, ...mail } = message;

    if (!this.transporter) {
      const body =
        sensitive && this.isProduction
          ? '[content hidden: sensitive]'
          : mail.text;
      this.logger.log(
        `[MOCK EMAIL] ke=${mail.to} | subjek=${mail.subject}\n${body}`,
      );
      return { channel: 'LOG' };
    }

    await this.transporter.sendMail({ from: this.from, ...mail });
    return { channel: 'EMAIL' };
  }
}
