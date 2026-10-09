import { Module } from '@nestjs/common';
import { RemindersModule } from '../reminders/reminders.module';
import { InvoiceReportsController } from './invoice-reports.controller';
import { InvoiceReportsService } from './invoice-reports.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [RemindersModule],
  controllers: [InvoicesController, InvoiceReportsController],
  providers: [InvoicesService, InvoiceReportsService],
})
export class InvoicesModule {}
