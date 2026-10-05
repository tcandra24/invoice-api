import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { InvoiceStatus } from '../../generated/prisma/client';

export const INVOICE_SORT_FIELDS = ['createdAt', 'dueDate', 'total'] as const;
export type InvoiceSortField = (typeof INVOICE_SORT_FIELDS)[number];

export class QueryInvoicesDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string; // cari di nomor invoice atau nama client

  @IsOptional()
  @IsDateString()
  dueFrom?: string; // contoh: 2026-11-01

  @IsOptional()
  @IsDateString()
  dueTo?: string;

  // Whitelist, bukan nama kolom bebas dari client
  @IsOptional()
  @IsIn(INVOICE_SORT_FIELDS)
  sortBy: InvoiceSortField = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}
