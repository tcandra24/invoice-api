import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ApiErrorResponses,
  ApiWrappedResponse,
} from '../common/swagger/api-responses';
import { QueryRevenueDto } from './dto/query-revenue.dto';
import {
  MonthlyRevenueItemDto,
  ReceivablesAgingResponseDto,
} from './dto/reports-response.dto';
import { InvoiceReportsService } from './invoice-reports.service';

@ApiTags('invoices')
@ApiBearerAuth()
@ApiErrorResponses(400, 401, 429)
@Controller('invoices/summary')
export class InvoiceReportsController {
  constructor(private readonly reportsService: InvoiceReportsService) {}

  @Get('revenue')
  @ApiOperation({
    summary:
      'Pendapatan per bulan (WIB): invoiced = ditagihkan, collected = diterima. Bulan kosong bernilai 0',
  })
  @ApiWrappedResponse(MonthlyRevenueItemDto, { isArray: true })
  revenue(@CurrentUser('id') userId: string, @Query() query: QueryRevenueDto) {
    return this.reportsService.monthlyRevenue(userId, query.months);
  }

  @Get('aging')
  @ApiOperation({
    summary:
      'Aging piutang: sisa tagihan per kelompok umur keterlambatan (berdasarkan tanggal jatuh tempo)',
  })
  @ApiWrappedResponse(ReceivablesAgingResponseDto)
  aging(@CurrentUser('id') userId: string) {
    return this.reportsService.receivablesAging(userId);
  }
}
