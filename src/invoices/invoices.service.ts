import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { daysUntil } from '../common/date.util';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from '../reminders/reminders.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { calculateInvoice } from './invoice-calculator';
import {
  OPEN_STATUSES,
  PAYABLE_STATUSES,
  assertTransition,
} from './invoice-status';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersService,
  ) {}

  // ---------- Helper ----------

  private async assertClientOwned(userId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, userId },
    });
    if (!client) {
      throw new NotFoundException('Client tidak ditemukan');
    }
  }

  private async generateNumber(userId: string) {
    const prefix = `INV-${new Date().getFullYear()}-`;
    const last = await this.prisma.invoice.findFirst({
      where: { userId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const next = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  private assertDiscount(subtotal: Prisma.Decimal, discount: Prisma.Decimal) {
    if (discount.gt(subtotal)) {
      throw new BadRequestException('Diskon tidak boleh melebihi subtotal');
    }
  }

  // ---------- CRUD ----------

  async create(userId: string, dto: CreateInvoiceDto) {
    await this.assertClientOwned(userId, dto.clientId);

    const calc = calculateInvoice(dto.items, dto.discount, dto.tax);
    this.assertDiscount(calc.subtotal, calc.discount);

    const number = await this.generateNumber(userId);

    return this.prisma.invoice.create({
      data: {
        userId,
        clientId: dto.clientId,
        number,
        dueDate: new Date(dto.dueDate),
        subtotal: calc.subtotal,
        discount: calc.discount,
        tax: calc.tax,
        total: calc.total,
        notes: dto.notes,
        items: { create: calc.lines },
      },
      include: { items: true, client: true },
    });
  }

  findAll(userId: string, query: QueryInvoicesDto) {
    return this.prisma.invoice.findMany({
      where: { userId, ...(query.status && { status: query.status }) },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, userId },
      include: { items: true, client: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice dengan id ${id} tidak ditemukan`);
    }
    return invoice;
  }

  async update(userId: string, id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.findOne(userId, id);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(
        'Hanya invoice berstatus DRAFT yang boleh diubah',
      );
    }

    if (dto.clientId && dto.clientId !== invoice.clientId) {
      await this.assertClientOwned(userId, dto.clientId);
    }

    // Kalau items tidak dikirim, pakai item yang sudah ada
    const calc = calculateInvoice(
      dto.items ?? invoice.items,
      dto.discount ?? invoice.discount,
      dto.tax ?? invoice.tax,
    );
    this.assertDiscount(calc.subtotal, calc.discount);

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      }
      return tx.invoice.update({
        where: { id },
        data: {
          clientId: dto.clientId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          notes: dto.notes,
          subtotal: calc.subtotal,
          discount: calc.discount,
          tax: calc.tax,
          total: calc.total,
          items: dto.items ? { create: calc.lines } : undefined,
        },
        include: { items: true, client: true },
      });
    });
  }

  async remove(userId: string, id: string) {
    const invoice = await this.findOne(userId, id);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(
        'Hanya invoice berstatus DRAFT yang boleh dihapus',
      );
    }
    await this.prisma.invoice.delete({ where: { id } });
    return { message: `Invoice ${id} berhasil dihapus` };
  }

  // ---------- Perubahan status ----------

  async send(userId: string, id: string) {
    const invoice = await this.findOne(userId, id);
    assertTransition(invoice.status, 'SENT');

    if (daysUntil(invoice.dueDate) < 0) {
      throw new BadRequestException(
        'Tanggal jatuh tempo sudah lewat, ubah dueDate sebelum mengirim',
      );
    }
    if (!invoice.client.email) {
      throw new BadRequestException(
        'Client belum punya email, lengkapi data client terlebih dahulu',
      );
    }

    // Email dikirim dulu. Kalau gagal, exception berhenti di sini
    // dan status invoice tetap DRAFT.
    await this.reminders.sendNotice(id, 'INITIAL');

    return this.prisma.invoice.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
      include: { items: true, client: true },
    });
  }

  async void(userId: string, id: string) {
    const invoice = await this.findOne(userId, id);
    assertTransition(invoice.status, 'VOID');

    const paymentCount = await this.prisma.payment.count({
      where: { invoiceId: id },
    });
    if (paymentCount > 0) {
      throw new BadRequestException(
        'Invoice yang sudah punya pembayaran tidak bisa dibatalkan',
      );
    }

    return this.prisma.invoice.update({
      where: { id },
      data: { status: 'VOID' },
      include: { items: true, client: true },
    });
  }

  // ---------- Pembayaran ----------

  async addPayment(userId: string, id: string, dto: CreatePaymentDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findFirst({ where: { id, userId } });
        if (!invoice) {
          throw new NotFoundException(
            `Invoice dengan id ${id} tidak ditemukan`,
          );
        }
        if (!PAYABLE_STATUSES.includes(invoice.status)) {
          throw new BadRequestException(
            `Invoice berstatus ${invoice.status} tidak bisa menerima pembayaran`,
          );
        }

        const agg = await tx.payment.aggregate({
          where: { invoiceId: id },
          _sum: { amount: true },
        });
        const alreadyPaid = agg._sum.amount ?? new Prisma.Decimal(0);
        const remaining = invoice.total.sub(alreadyPaid);
        const amount = new Prisma.Decimal(dto.amount);

        if (amount.gt(remaining)) {
          throw new BadRequestException(
            `Pembayaran melebihi sisa tagihan (sisa: ${remaining.toFixed(2)})`,
          );
        }

        const payment = await tx.payment.create({
          data: {
            invoiceId: id,
            amount,
            method: dto.method,
            paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
            note: dto.note,
          },
        });

        const totalPaid = alreadyPaid.add(amount);
        const fullyPaid = totalPaid.gte(invoice.total);

        let status = invoice.status;
        if (fullyPaid) {
          status = 'PAID';
        } else if (invoice.status === 'SENT') {
          status = 'PARTIALLY_PAID';
        }

        if (status !== invoice.status) {
          assertTransition(invoice.status, status);
          await tx.invoice.update({
            where: { id },
            data: { status, paidAt: fullyPaid ? payment.paidAt : null },
          });
        }

        return {
          payment,
          invoice: {
            id,
            number: invoice.number,
            status,
            total: invoice.total,
            totalPaid,
            remaining: invoice.total.sub(totalPaid),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findPayments(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.payment.findMany({
      where: { invoiceId: id },
      orderBy: { paidAt: 'desc' },
    });
  }

  // ---------- Ringkasan ----------

  async summary(userId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const zero = new Prisma.Decimal(0);

    const [openTotal, openPaid, overdueCount, monthRevenue] = await Promise.all(
      [
        this.prisma.invoice.aggregate({
          where: { userId, status: { in: OPEN_STATUSES } },
          _sum: { total: true },
          _count: true,
        }),
        this.prisma.payment.aggregate({
          where: { invoice: { userId, status: { in: OPEN_STATUSES } } },
          _sum: { amount: true },
        }),
        this.prisma.invoice.count({ where: { userId, status: 'OVERDUE' } }),
        this.prisma.payment.aggregate({
          where: { invoice: { userId }, paidAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
      ],
    );

    return {
      openInvoices: openTotal._count,
      totalReceivable: (openTotal._sum.total ?? zero).sub(
        openPaid._sum.amount ?? zero,
      ),
      overdueInvoices: overdueCount,
      revenueThisMonth: monthRevenue._sum.amount ?? zero,
    };
  }
}
