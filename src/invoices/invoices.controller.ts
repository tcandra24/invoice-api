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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUser('id') userId: string, @Query() query: QueryInvoicesDto) {
    return this.invoicesService.findAll(userId, query);
  }

  // Harus di atas ':id', kalau tidak "summary" dianggap sebagai id
  @Get('summary')
  summary(@CurrentUser('id') userId: string) {
    return this.invoicesService.summary(userId);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.remove(userId, id);
  }

  @Post(':id/send')
  @HttpCode(200)
  send(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.send(userId, id);
  }

  @Post(':id/void')
  @HttpCode(200)
  void(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.void(userId, id);
  }

  @Post(':id/payments')
  addPayment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.invoicesService.addPayment(userId, id, dto);
  }

  @Get(':id/payments')
  findPayments(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.invoicesService.findPayments(userId, id);
  }
}
