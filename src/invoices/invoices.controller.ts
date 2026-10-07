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
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @ApiOperation({ summary: 'Create invoice (initial status DRAFT)' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List invoices (pagination, filter, search, sorting)',
  })
  findAll(@CurrentUser('id') userId: string, @Query() query: QueryInvoicesDto) {
    return this.invoicesService.findAll(userId, query);
  }

  // Harus di atas ':id', kalau tidak "summary" dianggap sebagai id
  @Get('summary')
  @ApiOperation({
    summary: 'Summary of receivables, overdue, and revenue for this month',
  })
  summary(@CurrentUser('id') userId: string) {
    return this.invoicesService.summary(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Invoice details, including items and client' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update invoice (only when DRAFT)' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove invoice (only when DRAFT)' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.remove(userId, id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send invoice to client email, status becomes SENT',
  })
  send(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.send(userId, id);
  }

  @Post(':id/void')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Void invoice (without active payments, not PAID/VOID)',
  })
  void(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.void(userId, id);
  }

  // ---------- Payment ----------

  @Post(':id/payments')
  @ApiOperation({ summary: 'Record payment (installments allowed)' })
  addPayment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.invoicesService.addPayment(userId, id, dto);
  }

  @Get(':id/payments')
  @ApiOperation({
    summary:
      'History of invoice payments (voided ones are hidden, use ?includeVoided=true to show)',
  })
  findPayments(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query() query: QueryPaymentsDto,
  ) {
    return this.invoicesService.findPayments(userId, id, query);
  }

  @Get(':id/payments/:paymentId')
  @ApiOperation({ summary: 'Detail one payment' })
  findPayment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.invoicesService.findPayment(userId, id, paymentId);
  }

  @Patch(':id/payments/:paymentId')
  @ApiOperation({
    summary:
      'Update payment (amount, method, date, notes). Invoice status will be recalculated',
  })
  updatePayment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.invoicesService.updatePayment(userId, id, paymentId, dto);
  }

  @Delete(':id/payments/:paymentId')
  @ApiOperation({
    summary:
      'Void payment (soft delete, reason optional in body). Invoice status will be recalculated',
  })
  voidPayment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDto,
  ) {
    return this.invoicesService.voidPayment(userId, id, paymentId, dto);
  }
}
