import { Injectable, NotFoundException } from '@nestjs/common';
import { paginate, skipTake } from '../common/pagination.util';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateClientDto) {
    return this.prisma.client.create({ data: { ...dto, userId } });
  }

  async findAll(userId: string, query: QueryClientsDto) {
    const { page, limit, search } = query;

    const where: Prisma.ClientWhereInput = {
      userId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        // id sebagai pengurut kedua agar urutan antar halaman stabil
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...skipTake(page, limit),
      }),
      this.prisma.client.count({ where }),
    ]);

    return paginate(items, total, page, limit);
  }

  async findOne(userId: string, id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, userId },
    });
    if (!client) {
      throw new NotFoundException(`Client dengan id ${id} tidak ditemukan`);
    }
    return client;
  }

  async update(userId: string, id: string, dto: UpdateClientDto) {
    await this.findOne(userId, id);
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.client.delete({ where: { id } });
    return { message: `Client ${id} berhasil dihapus` };
  }
}
