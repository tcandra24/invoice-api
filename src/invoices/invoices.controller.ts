import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @ApiOperation({ summary: 'Buat invoice (status awal DRAFT)' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Daftar invoice, bisa difilter dengan ?status=' })
  findAll(@CurrentUser('id') userId: string, @Query() query: QueryInvoicesDto) {
    return this.invoicesService.findAll(userId, query);
  }

  // Harus di atas ':id', kalau tidak "summary" dianggap sebagai id
  @Get('summary')
  @ApiOperation({
    summary: 'Ringkasan piutang, overdue, dan pendapatan bulan ini',
  })
  summary(@CurrentUser('id') userId: string) {
    return this.invoicesService.summary(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail invoice beserta item dan client' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Ubah invoice (hanya saat DRAFT)' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hapus invoice (hanya saat DRAFT)' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.remove(userId, id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Kirim invoice ke email client, status menjadi SENT',
  })
  send(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.send(userId, id);
  }

  @Post(':id/void')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Batalkan invoice (tanpa pembayaran, bukan PAID/VOID)',
  })
  void(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.void(userId, id);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Catat pembayaran (boleh cicilan)' })
  addPayment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.invoicesService.addPayment(userId, id, dto);
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'Riwayat pembayaran sebuah invoice' })
  findPayments(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.findPayments(userId, id);
  }
}
