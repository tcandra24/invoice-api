import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateTime,
  ApiDateTimeNullable,
  ApiDecimal,
  ApiStringNullable,
} from '../../common/swagger/api-properties';
import { InvoiceStatus } from '../../generated/prisma/client';

export class PaymentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoiceId: string;

  @ApiDecimal('200000')
  amount: string;

  @ApiStringNullable('transfer')
  method: string | null;

  @ApiDateTime()
  paidAt: string;

  @ApiStringNullable('DP 30 persen')
  note: string | null;

  @ApiDateTimeNullable()
  voidedAt: string | null;

  @ApiStringNullable('salah input nominal')
  voidReason: string | null;

  @ApiDateTime()
  createdAt: string;

  @ApiDateTime()
  updatedAt: string;
}

/** Ringkasan invoice setelah tambah, ubah, atau batal pembayaran. */
export class PaymentInvoiceSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'INV-2026-0001' })
  number: string;

  @ApiProperty({ enum: InvoiceStatus, enumName: 'InvoiceStatus' })
  status: InvoiceStatus;

  @ApiDecimal('650000')
  total: string;

  @ApiDecimal('200000')
  totalPaid: string;

  @ApiDecimal('450000')
  remaining: string;
}

export class PaymentResultResponseDto {
  @ApiProperty({ type: () => PaymentResponseDto })
  payment: PaymentResponseDto;

  @ApiProperty({ type: () => PaymentInvoiceSummaryDto })
  invoice: PaymentInvoiceSummaryDto;
}
