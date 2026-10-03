import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateInvoiceDto) {
    const items = dto.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.quantity * item.unitPrice,
    }));

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const discount = dto.discount ?? 0;
    const tax = dto.tax ?? 0;
    const total = subtotal - discount + tax;

    const count = await this.prisma.invoice.count({
      where: { userId: dto.userId },
    });
    const number = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    return this.prisma.invoice.create({
      data: {
        userId: dto.userId,
        clientId: dto.clientId,
        number,
        dueDate: new Date(dto.dueDate),
        subtotal,
        discount,
        tax,
        total,
        notes: dto.notes,
        items: { create: items },
      },
      include: { items: true, client: true },
    });
  }

  findAll() {
    return this.prisma.invoice.findMany({
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true, client: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice dengan id ${id} tidak ditemukan`);
    }
    return invoice;
  }

  async remove(id: string) {
    const invoice = await this.findOne(id);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(
        'Hanya invoice berstatus DRAFT yang boleh dihapus',
      );
    }
    await this.prisma.invoice.delete({ where: { id } });
    return { message: `Invoice ${id} berhasil dihapus` };
  }
}
