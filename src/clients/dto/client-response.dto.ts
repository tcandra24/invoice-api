import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateTime,
  ApiStringNullable,
} from '../../common/swagger/api-properties';

export class ClientResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ example: 'PT Maju Jaya' })
  name: string;

  @ApiStringNullable('maju@example.com')
  email: string | null;

  @ApiStringNullable('081234567890')
  phone: string | null;

  @ApiStringNullable('Jl. Contoh No. 1, Jakarta')
  address: string | null;

  @ApiDateTime()
  createdAt: string;

  @ApiDateTime()
  updatedAt: string;
}
