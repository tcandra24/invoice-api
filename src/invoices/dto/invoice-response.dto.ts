import { ApiProperty } from '@nestjs/swagger';
import { ClientResponseDto } from '../../clients/dto/client-response.dto';
import {
  ApiDateTime,
  ApiDateTimeNullable,
  ApiDecimal,
  ApiStringNullable,
} from '../../common/swagger/api-properties';
import { InvoiceStatus } from '../../generated/prisma/client';

export class InvoiceItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoiceId: string;

  @ApiProperty({ example: 'Desain logo' })
  description: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiDecimal('500000')
  unitPrice: string;

  @ApiDecimal('500000')
  amount: string;
}

export class InvoiceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  clientId: string;

  @ApiProperty({ example: 'INV-2026-0001' })
  number: string;

  @ApiProperty({ enum: InvoiceStatus, enumName: 'InvoiceStatus' })
  status: InvoiceStatus;

  @ApiDateTime()
  issueDate: string;

  @ApiDateTime()
  dueDate: string;

  @ApiDecimal('700000')
  subtotal: string;

  @ApiDecimal('50000')
  discount: string;

  @ApiDecimal('0')
  tax: string;

  @ApiDecimal('650000')
  total: string;

  @ApiStringNullable('Terima kasih')
  notes: string | null;

  @ApiDateTimeNullable()
  sentAt: string | null;

  @ApiDateTimeNullable()
  paidAt: string | null;

  @ApiDateTime()
  createdAt: string;

  @ApiDateTime()
  updatedAt: string;
}

/** Dipakai pada daftar invoice. */
export class InvoiceWithClientResponseDto extends InvoiceResponseDto {
  @ApiProperty({ type: () => ClientResponseDto })
  client: ClientResponseDto;
}

/** Dipakai pada detail, buat, ubah, kirim, dan batalkan invoice. */
export class InvoiceDetailResponseDto extends InvoiceWithClientResponseDto {
  @ApiProperty({ type: () => [InvoiceItemResponseDto] })
  items: InvoiceItemResponseDto[];
}

export class InvoiceSummaryResponseDto {
  @ApiProperty({ example: 3, description: 'Jumlah invoice yang belum lunas' })
  openInvoices: number;

  @ApiDecimal('1500000')
  totalReceivable: string;

  @ApiProperty({ example: 1 })
  overdueInvoices: number;

  @ApiDecimal('650000')
  revenueThisMonth: string;
}
