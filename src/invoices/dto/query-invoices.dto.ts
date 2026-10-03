import { IsEnum, IsOptional } from 'class-validator';
import { InvoiceStatus } from '../../generated/prisma/client';

export class QueryInvoicesDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}
