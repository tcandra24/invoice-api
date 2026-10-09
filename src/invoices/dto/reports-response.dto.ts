import { ApiProperty } from '@nestjs/swagger';
import { ApiDecimal } from '../../common/swagger/api-properties';

export class MonthlyRevenueItemDto {
  @ApiProperty({
    example: '2026-10',
    description: 'Bulan menurut WIB (YYYY-MM)',
  })
  month: string;

  @ApiDecimal('1500000')
  invoiced: string;

  @ApiDecimal('400000')
  collected: string;
}

export class AgingBucketDto {
  @ApiProperty({ enum: ['current', '1-30', '31-60', '61-90', '90+'] })
  key: string;

  @ApiProperty({ example: '1-30 days overdue' })
  label: string;

  @ApiProperty({ example: 2, description: 'Jumlah invoice di kelompok ini' })
  count: number;

  @ApiDecimal('500000')
  amount: string;
}

export class ReceivablesAgingResponseDto {
  @ApiProperty({
    example: '2026-10-09',
    description: 'Tanggal acuan (hari ini menurut WIB)',
  })
  asOf: string;

  @ApiDecimal('1100000')
  total: string;

  @ApiDecimal('500000')
  overdueTotal: string;

  @ApiProperty({ type: () => [AgingBucketDto] })
  buckets: AgingBucketDto[];
}
