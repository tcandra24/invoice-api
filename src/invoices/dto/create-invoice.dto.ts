export class CreateInvoiceItemDto {
  description: string;
  quantity: number;
  unitPrice: number;
}

export class CreateInvoiceDto {
  // Sementara lewat body, diganti dari JWT di hari 4.
  userId: string;
  clientId: string;
  dueDate: string; // format ISO, contoh: "2026-11-15"
  discount?: number;
  tax?: number;
  notes?: string;
  items: CreateInvoiceItemDto[];
}
