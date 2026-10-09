import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryRevenueDto {
  // Jumlah bulan terakhir (termasuk bulan berjalan)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months: number = 12;
}
