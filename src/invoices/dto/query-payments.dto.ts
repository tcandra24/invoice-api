import { IsIn, IsOptional } from 'class-validator';

export class QueryPaymentsDto {
  // Default: pembayaran yang dibatalkan disembunyikan
  @IsOptional()
  @IsIn(['true', 'false'])
  includeVoided?: 'true' | 'false';
}
