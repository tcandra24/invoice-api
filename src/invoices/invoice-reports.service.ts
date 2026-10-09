import { Injectable } from '@nestjs/common';
import { todayInJakarta } from '../common/date.util';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OPEN_STATUSES } from './invoice-status';
import {
  aggregateMonthly,
  buildAging,
  buildMonthKeys,
  startOfMonthJakarta,
} from './reports.util';

@Injectable()
export class InvoiceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * invoiced  = total invoice yang pernah dikirim (tanpa VOID), menurut tanggal kirim
   * collected = pembayaran aktif (tidak dibatalkan), menurut tanggal bayar
   */
  async monthlyRevenue(
    userId: string,
    months: number,
    today: Date = todayInJakarta(),
  ) {
    const keys = buildMonthKeys(months, today);
    const from = startOfMonthJakarta(keys[0]);

    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { userId, sentAt: { gte: from }, status: { not: 'VOID' } },
        select: { sentAt: true, total: true },
      }),
      this.prisma.payment.findMany({
        where: { voidedAt: null, paidAt: { gte: from }, invoice: { userId } },
        select: { paidAt: true, amount: true },
      }),
    ]);

    return aggregateMonthly(
      keys,
      invoices.flatMap((invoice) =>
        invoice.sentAt ? [{ at: invoice.sentAt, amount: invoice.total }] : [],
      ),
      payments.map((payment) => ({
        at: payment.paidAt,
        amount: payment.amount,
      })),
    );
  }

  /** Sisa tagihan (total dikurangi pembayaran aktif) per kelompok umur keterlambatan. */
  async receivablesAging(userId: string, today: Date = todayInJakarta()) {
    const invoices = await this.prisma.invoice.findMany({
      where: { userId, status: { in: OPEN_STATUSES } },
      select: {
        total: true,
        dueDate: true,
        payments: { where: { voidedAt: null }, select: { amount: true } },
      },
    });

    return buildAging(
      invoices.map((invoice) => ({
        dueDate: invoice.dueDate,
        remaining: invoice.total.sub(
          invoice.payments.reduce(
            (sum, payment) => sum.add(payment.amount),
            new Prisma.Decimal(0),
          ),
        ),
      })),
      today,
    );
  }
}
