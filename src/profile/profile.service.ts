import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { PrismaService } from '../prisma/prisma.service';

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  businessName: true,
  createdAt: true,
} as const;

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async update(userId: string, dto: UpdateProfileDto) {
    if (dto.name === undefined && dto.businessName === undefined) {
      throw new BadRequestException('At least one field must be provided');
    }

    // Kalau user sudah terhapus tetapi tokennya masih berlaku, Prisma melempar
    // P2025 yang dipetakan AllExceptionsFilter menjadi 404.
    return this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name, businessName: dto.businessName },
      select: publicUserSelect,
    });
  }

  async changePassword(userId: string, dto: UpdatePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const valid = await bcrypt.compare(dto.oldPassword, user.password);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const hashed = await bcrypt.hash(dto.newPassword, 10);

    const sessions = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          password: hashed,
        },
      });

      const { count } = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return count;
    });

    return {
      message: 'Password updated. Please log in again on all devices.',
      sessions,
    };
  }
}
