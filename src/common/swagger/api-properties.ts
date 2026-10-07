import { ApiProperty } from '@nestjs/swagger';

/** Nominal uang: Prisma Decimal dikirim sebagai string di JSON. */
export const ApiDecimal = (example = '650000') =>
  ApiProperty({
    type: String,
    example,
    description: 'Monetary amount as a string (preserving decimal precision)',
  });

export const ApiDateTime = () =>
  ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-07T03:00:00.000Z',
  });

export const ApiDateTimeNullable = () =>
  ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  });

export const ApiStringNullable = (example?: string) =>
  ApiProperty({ type: String, nullable: true, example: example ?? null });
